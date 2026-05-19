/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vibecoder Agent Tools Service.
 *
 * Объединяет fsTools + shellTools + goalTools в единый registry:
 *   1. getAllTools() — 11 tools (7 fs + 1 shell + 3 goal) для toolLoop
 *   2. confirm dialog для dangerous tools с кнопками Apply / Apply always / Reject
 *   3. auto-approve для safe (read/list/search/goal)
 *   4. session-level "Apply always" чтобы не спамить confirm в рамках чата
 *   5. реактивный Goal state — UI подписывается на onDidChangeGoal
 *   6. YOLO mode (в конфиге) — bypass всех confirm dialogs
 *   7. Visible diff editor (vscode.diff) для edit_file/write_file ПЕРЕД confirm
 *      (CRLF-tolerant через findUniqueWithCrlfFallback — иначе на Windows
 *       diff preview просто не показывался бы)
 *
 * Имена tools начинаются с "agent__" — отличает от MCP servers.
 */

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ITerminalService } from '../../../../contrib/terminal/browser/terminal.js';
import { IUntitledTextEditorService } from '../../../../services/untitled/common/untitledTextEditorService.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { isAbsolute as isAbsolutePosix } from '../../../../../base/common/path.js';
import { VibecoderTool } from '../llm/llmProvider.js';
import { VibecoderConfigKeys } from '../../common/vibecoder.js';
import { FsTools, AgentToolResult, findUniqueWithCrlfFallback } from './fsTools.js';
import { ShellTools } from './shellTools.js';
import { GoalTools, GoalState } from './goalTools.js';

export const IVibecoderAgentToolsService = createDecorator<IVibecoderAgentToolsService>('vibecoderAgentToolsService');

export interface IVibecoderAgentToolsService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeGoal: Event<GoalState | null>;
	getAllTools(): VibecoderTool[];
	callTool(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult>;
	resetSessionApprovals(): void;
	isAgentTool(toolName: string): boolean;
	getCurrentGoal(): GoalState | null;
}

export class VibecoderAgentToolsService extends Disposable implements IVibecoderAgentToolsService {
	readonly _serviceBrand: undefined;

	private readonly fsTools: FsTools;
	private readonly shellTools: ShellTools;
	private readonly goalTools: GoalTools;
	readonly onDidChangeGoal: Event<GoalState | null>;

	private readonly sessionApprovals = new Set<string>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@ITerminalService terminalService: ITerminalService,
		@IDialogService private readonly dialogService: IDialogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IUntitledTextEditorService private readonly untitledTextEditorService: IUntitledTextEditorService,
	) {
		super();
		this.fsTools = new FsTools(fileService, workspaceService);
		this.shellTools = new ShellTools(terminalService, workspaceService);
		this.goalTools = new GoalTools();
		this.onDidChangeGoal = this.goalTools.onDidChange;
	}

	isAgentTool(toolName: string): boolean {
		return toolName.startsWith('agent__');
	}

	getAllTools(): VibecoderTool[] {
		return [
			...this.fsTools.getToolDefinitions(),
			...this.shellTools.getToolDefinitions(),
			...this.goalTools.getToolDefinitions(),
		];
	}

	getCurrentGoal(): GoalState | null {
		return this.goalTools.getCurrent();
	}

	resetSessionApprovals(): void {
		this.sessionApprovals.clear();
		this.goalTools.reset();
	}

	private isYoloMode(): boolean {
		try {
			return this.configurationService.getValue<boolean>(VibecoderConfigKeys.AgentToolsYoloMode) === true;
		} catch {
			return false;
		}
	}

	private getCategory(toolName: string): 'safe' | 'medium' | 'dangerous' {
		if (FsTools.getToolNames().includes(toolName)) {
			return FsTools.getToolCategory(toolName);
		}
		if (ShellTools.getToolNames().includes(toolName)) {
			return ShellTools.getToolCategory(toolName);
		}
		if (GoalTools.getToolNames().includes(toolName)) {
			return GoalTools.getToolCategory(toolName);
		}
		return 'dangerous';
	}

	/**
	 * Локальная копия логики FsTools.resolvePath (private там).
	 * Нужна для showVisibleDiff — разрешить относительный путь до URI.
	 */
	private resolvePath(path: string): URI | undefined {
		const trimmed = path.trim();
		if (!trimmed) { return undefined; }
		const isWindowsAbs = /^[a-zA-Z]:[\\/]/.test(trimmed);
		const isUnixAbs = trimmed.startsWith('/');
		if (isWindowsAbs || isUnixAbs || isAbsolutePosix(trimmed)) {
			return URI.file(trimmed);
		}
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) { return undefined; }
		return URI.joinPath(folders[0].uri, trimmed);
	}

	async callTool(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult> {
		if (!this.isAgentTool(toolName)) {
			return { content: `agentToolsService: ${toolName} — не agent tool`, isError: true };
		}

		const category = this.getCategory(toolName);

		// Safe tools — без confirm
		if (category === 'safe') {
			return this.dispatchTool(toolName, args);
		}

		// YOLO mode — авто-одобрение ВСЕГО (юзер включил осознанно)
		if (this.isYoloMode()) {
			return this.dispatchTool(toolName, args);
		}

		// Если уже разрешён в этой сессии — без confirm
		if (this.sessionApprovals.has(toolName)) {
			return this.dispatchTool(toolName, args);
		}

		// Для edit/write — ПЕРЕД confirm показываем visible diff в редакторе.
		// Работает асинхронно — не блокируем confirm если diff не открылся.
		if (toolName === 'agent__edit_file' || toolName === 'agent__write_file') {
			this.showVisibleDiff(toolName, args).catch(e => console.warn('[Agent] showVisibleDiff failed:', e));
		}

		// Нужен confirm
		const decision = await this.showConfirmDialog(toolName, args);
		switch (decision) {
			case 'apply_once':
				return this.dispatchTool(toolName, args);
			case 'apply_always':
				this.sessionApprovals.add(toolName);
				return this.dispatchTool(toolName, args);
			case 'reject':
				return {
					content: `❌ Юзер отклонил выполнение ${toolName} (Reject). Не повторяй этот вызов автоматически — спроси что делать дальше.`,
					isError: true,
				};
		}
	}

	private async dispatchTool(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult> {
		if (FsTools.getToolNames().includes(toolName)) {
			return this.fsTools.dispatch(toolName, args);
		}
		if (ShellTools.getToolNames().includes(toolName)) {
			return this.shellTools.dispatch(toolName, args);
		}
		if (GoalTools.getToolNames().includes(toolName)) {
			return this.goalTools.dispatch(toolName, args);
		}
		return { content: `agentToolsService: неизвестный tool ${toolName}`, isError: true };
	}

	/**
	 * Открывает diff editor в редакторе для превью изменения.
	 * Не блокирует confirm dialog — вызывается параллельно.
	 * Слева — оригинал файла. Справа — untitled buffer с новым содержимым.
	 *
	 * Использует findUniqueWithCrlfFallback из fsTools для поиска old_text:
	 * на Windows файл с CRLF + old_text от LLM с LF — прямой indexOf вернёт -1
	 * и preview не показался бы, а edit_file всё равно сработал бы. Это
	 * рассогласование UX — теперь и preview, и реальная замена идут через
	 * одну функцию.
	 */
	private async showVisibleDiff(toolName: string, args: Record<string, unknown>): Promise<void> {
		const path = String(args.path ?? '').trim();
		if (!path) { return; }

		const originalUri = this.resolvePath(path);
		if (!originalUri) { return; }

		const fileName = path.split(/[/\\]/).pop() ?? 'preview';

		let originalExists = false;
		try {
			originalExists = await this.fileService.exists(originalUri);
		} catch {
			originalExists = false;
		}

		let modifiedContent: string;

		if (toolName === 'agent__write_file') {
			modifiedContent = String(args.content ?? '');
		} else if (toolName === 'agent__edit_file') {
			if (!originalExists) { return; }
			try {
				const stat = await this.fileService.stat(originalUri);
				if (stat.isDirectory) { return; }
				const content = await this.fileService.readFile(originalUri);
				const text = content.value.toString();
				const oldText = String(args.old_text ?? '');
				const newText = String(args.new_text ?? '');
				const match = findUniqueWithCrlfFallback(text, oldText, newText);
				if (!match.found) { return; }
				modifiedContent =
					match.workText.slice(0, match.index) +
					match.newTextNormalized +
					match.workText.slice(match.index + match.needleLength);
			} catch {
				return;
			}
		} else {
			return;
		}

		try {
			const previewResource = URI.from({
				scheme: 'untitled',
				path: `/vibecoder-preview-${Date.now()}-${fileName}`,
			});

			const untitled = this.untitledTextEditorService.create({
				initialValue: modifiedContent,
				untitledResource: previewResource,
			});

			if (originalExists) {
				// Side-by-side diff editor
				await this.commandService.executeCommand(
					'vscode.diff',
					originalUri,
					untitled.resource,
					`Vibecoder Preview: ${fileName} (ждёт подтверждения)`,
				);
			} else {
				// Файл не существует — просто открыть untitled buffer
				await this.commandService.executeCommand('vscode.open', untitled.resource);
			}
		} catch (e) {
			console.warn('[Agent] showVisibleDiff: не удалось открыть diff editor:', e);
		}
	}

	private async showConfirmDialog(
		toolName: string,
		args: Record<string, unknown>
	): Promise<'apply_once' | 'apply_always' | 'reject'> {
		const { message, detail } = this.formatConfirmDialog(toolName, args);

		const result = await this.dialogService.prompt<'apply_once' | 'apply_always' | 'reject'>({
			type: 'warning',
			message,
			detail,
			buttons: [
				{ label: 'Apply', run: () => 'apply_once' },
				{ label: 'Apply always (session)', run: () => 'apply_always' },
			],
			cancelButton: { label: 'Reject', run: () => 'reject' },
		});

		return result.result ?? 'reject';
	}

	private formatConfirmDialog(toolName: string, args: Record<string, unknown>): { message: string; detail: string } {
		const a = args as Record<string, unknown>;
		switch (toolName) {
			case 'agent__write_file': {
				const path = String(a.path ?? '(?)');
				const content = String(a.content ?? '');
				const lines = content.split('\n').length;
				const preview = content.length > 400
					? content.slice(0, 400) + `\n\n... (всего ${content.length} симв, ${lines} строк)`
					: content;
				return {
					message: `📝 Записать файл (перезапишет существующий):\n${path}`,
					detail: `→ Diff открыт в редакторе.\n\nСодержимое (превью):\n\n${preview}`,
				};
			}
			case 'agent__edit_file': {
				const path = String(a.path ?? '(?)');
				const oldText = String(a.old_text ?? '');
				const newText = String(a.new_text ?? '');
				const oldPreview = oldText.length > 200
					? oldText.slice(0, 200) + `\n... (${oldText.length} симв.)`
					: oldText;
				const newPreview = newText.length > 200
					? newText.slice(0, 200) + `\n... (${newText.length} симв.)`
					: newText;
				const delta = newText.length - oldText.length;
				const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
				return {
					message: `✏ Изменить файл:\n${path}`,
					detail: `→ Diff открыт в редакторе.\n\nΔ ${deltaStr} симв.\n\n── БЫЛО ──\n${oldPreview}\n\n── СТАНЕТ ──\n${newPreview}`,
				};
			}
			case 'agent__delete_file': {
				const path = String(a.path ?? '(?)');
				const recursive = a.recursive === true;
				return {
					message: `🗑 УДАЛИТЬ:\n${path}`,
					detail: recursive
						? '⚠ Рекурсивное удаление — будут стёрты ВСЕ вложенные файлы и папки. БЕЗ КОРЗИНЫ.'
						: '⚠ Файл будет удалён БЕЗ корзины. Восстановить можно только через git.',
				};
			}
			case 'agent__mkdir': {
				const path = String(a.path ?? '(?)');
				return {
					message: `📁 Создать директорию:\n${path}`,
					detail: 'Промежуточные директории создадутся рекурсивно.',
				};
			}
			case 'agent__run_command': {
				const command = String(a.command ?? '(?)');
				const cwd = a.cwd ? String(a.cwd) : '(workspace root)';
				const timeout = a.timeout_ms ? `${a.timeout_ms}ms` : '60000ms';
				return {
					message: `🖥 Запустить команду:\n${command}`,
					detail: `cwd: ${cwd}\ntimeout: ${timeout}\n\n⚠ Команда выполнится в видимом терминале. Может изменить систему — проверь её внимательно.`,
				};
			}
			default:
				return {
					message: `Подтвердить ${toolName}?`,
					detail: `Параметры:\n${JSON.stringify(args, null, 2).slice(0, 1200)}`,
				};
		}
	}
}
