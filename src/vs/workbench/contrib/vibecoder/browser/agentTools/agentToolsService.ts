/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vibecoder Agent Tools Service.
 *
 * Объединяет fsTools + shellTools в единый registry с:
 *   1. Регистрацией всех tools в формате VibecoderTool (как MCP) для toolLoop
 *   2. Confirm dialog для dangerous tools (write/edit/delete/exec)
 *   3. Auto-approve для safe tools (read/list/search)
 *   4. Session-level "allow always" памятью чтобы не спамить confirm в рамках чата
 *
 * Архитектура совместимая с MCP — toolLoop вызывает getAllTools() и callTool()
 * на этом сервисе так же как на mcpService. Имена tools начинаются с "agent__"
 * — отличает от MCP servers.
 *
 * Confirm dialog показывает:
 *   - read/list — нет диалога (safe)
 *   - mkdir — confirm с предпросмотром пути
 *   - write_file — confirm с предпросмотром (path + первые N симв content)
 *   - edit_file — confirm с diff (old → new)
 *   - delete_file — confirm с явным "DELETE" подтверждением
 *   - run_command — confirm с показом команды + cwd
 *
 * Кнопки: [Allow once] [Allow always for this session] [Deny]
 */

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITerminalService } from '../../../../contrib/terminal/browser/terminal.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { VibecoderTool } from '../llm/llmProvider.js';
import { FsTools, AgentToolResult } from './fsTools.js';
import { ShellTools } from './shellTools.js';

export const IVibecoderAgentToolsService = createDecorator<IVibecoderAgentToolsService>('vibecoderAgentToolsService');

export interface IVibecoderAgentToolsService {
	readonly _serviceBrand: undefined;

	/** Возвращает все agent tools в формате VibecoderTool (для добавления в LLM request) */
	getAllTools(): VibecoderTool[];

	/**
	 * Выполнить tool по имени. Для dangerous tools покажет confirm dialog
	 * (если в этой сессии юзер ещё не сказал "always allow").
	 */
	callTool(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult>;

	/** Сбросить "allow always" решения текущей сессии. */
	resetSessionApprovals(): void;

	/** Проверить является ли tool agent tool (начинается с "agent__"). */
	isAgentTool(toolName: string): boolean;
}

export class VibecoderAgentToolsService extends Disposable implements IVibecoderAgentToolsService {
	readonly _serviceBrand: undefined;

	private readonly fsTools: FsTools;
	private readonly shellTools: ShellTools;

	/** В рамках этой сессии разрешённые tools (юзер нажал "Allow always for this session") */
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
	}

	isAgentTool(toolName: string): boolean {
		return toolName.startsWith('agent__');
	}

	getAllTools(): VibecoderTool[] {
		return [
			...this.fsTools.getToolDefinitions(),
			...this.shellTools.getToolDefinitions(),
		];
	}

	resetSessionApprovals(): void {
		this.sessionApprovals.clear();
	}

	/**
	 * Категория tool: safe/medium/dangerous.
	 */
	private getCategory(toolName: string): 'safe' | 'medium' | 'dangerous' {
		if (FsTools.getToolNames().includes(toolName)) {
			return FsTools.getToolCategory(toolName);
		}
		if (ShellTools.getToolNames().includes(toolName)) {
			return ShellTools.getToolCategory(toolName);
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
			case 'allow_once':
				return this.dispatchTool(toolName, args);
			case 'allow_always':
				this.sessionApprovals.add(toolName);
				return this.dispatchTool(toolName, args);
			case 'deny':
				return {
					content: `❌ Юзер запретил выполнение ${toolName}. Спроси что делать дальше — не повторяй этот вызов автоматически.`,
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
		return { content: `agentToolsService: неизвестный tool ${toolName}`, isError: true };
	}

	/**
	 * Показать confirm dialog для dangerous/medium tool.
	 */
	private async showConfirmDialog(
		toolName: string,
		args: Record<string, unknown>
	): Promise<'allow_once' | 'allow_always' | 'deny'> {
		const { title, message, detail } = this.formatConfirmDialog(toolName, args);

		const result = await this.dialogService.prompt<'allow_once' | 'allow_always' | 'deny'>({
			type: 'warning',
			message,
			detail,
			buttons: [
				{ label: 'Разрешить один раз', run: () => 'allow_once' },
				{ label: 'Разрешать всегда (сессия)', run: () => 'allow_always' },
			],
			cancelButton: { label: 'Запретить', run: () => 'deny' },
		});

		return result.result ?? 'deny';
	}

	/**
	 * Готовит текст для confirm dialog: title, message, detail (с предпросмотром).
	 */
	private formatConfirmDialog(toolName: string, args: Record<string, unknown>): { title: string; message: string; detail: string } {
		const a = args as Record<string, unknown>;
		switch (toolName) {
			case 'agent__write_file': {
				const path = String(a.path ?? '(?)');
				const content = String(a.content ?? '');
				const preview = content.length > 400
					? content.slice(0, 400) + `\n... (всего ${content.length} симв, ${content.split('\n').length} строк)`
					: content;
				return {
					title: 'Записать файл',
					message: `NIT хочет записать файл:\n${path}`,
					detail: `Содержимое (превью):\n\n${preview}`,
				};
			}
			case 'agent__edit_file': {
				const path = String(a.path ?? '(?)');
				const oldText = String(a.old_text ?? '');
				const newText = String(a.new_text ?? '');
				const oldPreview = oldText.length > 200 ? oldText.slice(0, 200) + '\n...' : oldText;
				const newPreview = newText.length > 200 ? newText.slice(0, 200) + '\n...' : newText;
				return {
					title: 'Изменить файл',
					message: `NIT хочет изменить файл:\n${path}`,
					detail: `БЫЛО:\n${oldPreview}\n\n──────────\n\nСТАНЕТ:\n${newPreview}`,
				};
			}
			case 'agent__delete_file': {
				const path = String(a.path ?? '(?)');
				const recursive = a.recursive === true;
				return {
					title: 'Удалить файл',
					message: `NIT хочет УДАЛИТЬ:\n${path}`,
					detail: recursive
						? '⚠ Рекурсивное удаление — будут стёрты все вложенные файлы и папки. БЕЗ КОРЗИНЫ.'
						: '⚠ Файл будет удалён БЕЗ корзины.',
				};
			}
			case 'agent__mkdir': {
				const path = String(a.path ?? '(?)');
				return {
					title: 'Создать директорию',
					message: `NIT хочет создать директорию:\n${path}`,
					detail: 'Промежуточные директории создадутся рекурсивно.',
				};
			}
			case 'agent__run_command': {
				const command = String(a.command ?? '(?)');
				const cwd = a.cwd ? String(a.cwd) : '(workspace root)';
				const timeout = a.timeout_ms ? `${a.timeout_ms}ms` : '60000ms';
				return {
					title: 'Запустить команду',
					message: `NIT хочет запустить:\n${command}`,
					detail: `cwd: ${cwd}\ntimeout: ${timeout}\n\n⚠ Команда выполнится в видимом терминале. Может изменить систему — проверь её внимательно.`,
				};
			}
			default:
				return {
					title: 'Подтверждение',
					message: `NIT хочет выполнить ${toolName}`,
					detail: `Параметры:\n${JSON.stringify(args, null, 2).slice(0, 1000)}`,
				};
		}
	}
}
