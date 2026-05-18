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
 *
 * Имена tools начинаются с "agent__" — отличает от MCP servers.
 */

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITerminalService } from '../../../../contrib/terminal/browser/terminal.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { VibecoderTool } from '../llm/llmProvider.js';
import { FsTools, AgentToolResult } from './fsTools.js';
import { ShellTools } from './shellTools.js';
import { GoalTools, GoalState } from './goalTools.js';

export const IVibecoderAgentToolsService = createDecorator<IVibecoderAgentToolsService>('vibecoderAgentToolsService');

export interface IVibecoderAgentToolsService {
	readonly _serviceBrand: undefined;

	/** Реактивный stream изменений текущего Goal (UI подписывается для рендера чек-листа) */
	readonly onDidChangeGoal: Event<GoalState | null>;

	/** Возвращает все agent tools в формате VibecoderTool (для добавления в LLM request) */
	getAllTools(): VibecoderTool[];

	/** Выполнить tool по имени. Для dangerous tools покажет confirm dialog. */
	callTool(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult>;

	/** Сбросить session approvals + текущий Goal. Вызывается при новом чате. */
	resetSessionApprovals(): void;

	/** Проверить является ли tool agent tool (начинается с "agent__"). */
	isAgentTool(toolName: string): boolean;

	/** Текущая цель (null если нет активной). */
	getCurrentGoal(): GoalState | null;
}

export class VibecoderAgentToolsService extends Disposable implements IVibecoderAgentToolsService {
	readonly _serviceBrand: undefined;

	private readonly fsTools: FsTools;
	private readonly shellTools: ShellTools;
	private readonly goalTools: GoalTools;
	readonly onDidChangeGoal: Event<GoalState | null>;

	/** В рамках этой сессии разрешённые tools (юзер нажал "Apply always") */
	private readonly sessionApprovals = new Set<string>();

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@ITerminalService terminalService: ITerminalService,
		@IDialogService private readonly dialogService: IDialogService,
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

	async callTool(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult> {
		if (!this.isAgentTool(toolName)) {
			return { content: `agentToolsService: ${toolName} — не agent tool`, isError: true };
		}

		const category = this.getCategory(toolName);

		// Safe tools — без confirm
		if (category === 'safe') {
			return this.dispatchTool(toolName, args);
		}

		// Если уже разрешён в этой сессии — без confirm
		if (this.sessionApprovals.has(toolName)) {
			return this.dispatchTool(toolName, args);
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
				const preview = content.length > 600
					? content.slice(0, 600) + `\n\n... (всего ${content.length} симв, ${lines} строк)`
					: content;
				return {
					message: `📝 Записать файл (перезапишет существующий):\n${path}`,
					detail: `Содержимое (превью):\n\n${preview}`,
				};
			}
			case 'agent__edit_file': {
				const path = String(a.path ?? '(?)');
				const oldText = String(a.old_text ?? '');
				const newText = String(a.new_text ?? '');
				const oldPreview = oldText.length > 300
					? oldText.slice(0, 300) + `\n... (${oldText.length} симв.)`
					: oldText;
				const newPreview = newText.length > 300
					? newText.slice(0, 300) + `\n... (${newText.length} симв.)`
					: newText;
				const delta = newText.length - oldText.length;
				const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
				return {
					message: `✏ Изменить файл:\n${path}`,
					detail: `Δ ${deltaStr} симв.\n\n── БЫЛО ──\n${oldPreview}\n\n── СТАНЕТ ──\n${newPreview}`,
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
