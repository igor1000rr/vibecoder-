/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shell tool для Vibecoder Agent.
 *
 * run_command — запускает команду в ВИДИМОМ терминале VS Code:
 *   1. Создаёт новый Terminal через ITerminalService
 *   2. Юзер видит процесс в Terminal panel, может kill через UI
 *   3. Захватываем output через onData listener
 *   4. Возвращаем когда процесс завершился (exit code) или по таймауту
 *
 * Реализация:
 *   - createTerminal({ name: 'NIT: <cmd>' }) — отдельный терминал на каждый вызов
 *   - terminal.sendText(command, addNewLine: true) — отправляет команду
 *   - onData → буферизуем для возврата в LLM
 *   - onExit → разрешаем promise с exit code и буфером
 *   - timeout по умолчанию 60 сек, max 300 сек
 *
 * Terminal остаётся открытым после выполнения — юзер может посмотреть.
 * Старые терминалы NIT не закрываются автоматически (юзер сам решает).
 *
 * Ограничения output:
 *   - max 10000 симв output для LLM (обрезается, юзер видит весь в терминале)
 *   - после exit ждём 200ms на финальные данные из буфера xterm
 */

import { ITerminalService, ITerminalInstance } from '../../../../contrib/terminal/browser/terminal.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { VibecoderTool } from '../llm/llmProvider.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const HARD_TIMEOUT_MS = 300_000;
const OUTPUT_MAX_CHARS = 10_000;

export interface AgentToolResult {
	readonly content: string;
	readonly isError: boolean;
}

export class ShellTools {
	constructor(
		private readonly terminalService: ITerminalService,
		private readonly workspaceService: IWorkspaceContextService,
	) { }

	async runCommand(args: { command?: string; cwd?: string; timeout_ms?: number }): Promise<AgentToolResult> {
		if (typeof args.command !== 'string' || !args.command.trim()) {
			return { content: 'run_command: параметр "command" обязателен', isError: true };
		}

		const command = args.command.trim();
		const timeoutMs = Math.min(
			Math.max(1000, args.timeout_ms ?? DEFAULT_TIMEOUT_MS),
			HARD_TIMEOUT_MS
		);

		// Определяем cwd
		let cwd: URI | undefined;
		if (args.cwd && args.cwd.trim()) {
			const cwdStr = args.cwd.trim();
			const isWindowsAbs = /^[a-zA-Z]:[\\/]/.test(cwdStr);
			const isUnixAbs = cwdStr.startsWith('/');
			if (isWindowsAbs || isUnixAbs) {
				cwd = URI.file(cwdStr);
			} else {
				const folders = this.workspaceService.getWorkspace().folders;
				if (folders.length > 0) {
					cwd = URI.joinPath(folders[0].uri, cwdStr);
				}
			}
		} else {
			const folders = this.workspaceService.getWorkspace().folders;
			if (folders.length > 0) {
				cwd = folders[0].uri;
			}
		}

		let terminal: ITerminalInstance;
		try {
			// Имя терминала — обрезанная команда для удобства юзера
			const shortCmd = command.length > 40 ? command.slice(0, 37) + '...' : command;
			terminal = await this.terminalService.createTerminal({
				config: {
					name: `NIT: ${shortCmd}`,
					cwd,
					hideFromUser: false,
				},
			});
		} catch (e) {
			return { content: `run_command: не удалось создать терминал: ${(e as Error).message}`, isError: true };
		}

		// Делаем терминал видимым
		try {
			await this.terminalService.setActiveInstance(terminal);
			await this.terminalService.revealActiveTerminal();
		} catch {
			// не критично
		}

		// Буфер для output
		let buffer = '';
		let bufferTruncated = false;
		const outputDisposable = terminal.onData((data: string) => {
			if (bufferTruncated) { return; }
			buffer += data;
			if (buffer.length > OUTPUT_MAX_CHARS * 3) {
				// Держим в 3 раза больше чем отдадим LLM — на случай ANSI escape codes
				bufferTruncated = true;
			}
		});

		// Promise который разрешится при exit или timeout
		const result = await new Promise<{ exitCode: number | undefined; timedOut: boolean }>(resolve => {
			let resolved = false;
			const finalize = (exitCode: number | undefined, timedOut: boolean) => {
				if (resolved) { return; }
				resolved = true;
				// Даём 200ms чтобы дочитать финальные данные из xterm buffer
				setTimeout(() => {
					outputDisposable.dispose();
					resolve({ exitCode, timedOut });
				}, 200);
			};

			const exitDisposable = terminal.onExit(exitCode => {
				exitDisposable.dispose();
				finalize(typeof exitCode === 'number' ? exitCode : exitCode?.code, false);
			});

			const timeoutHandle = setTimeout(() => {
				exitDisposable.dispose();
				// Не убиваем процесс — пусть юзер сам решит через UI терминала
				finalize(undefined, true);
			}, timeoutMs);

			// На случай если процесс завершится до timeout — очистим
			terminal.onExit(() => clearTimeout(timeoutHandle));

			// Отправляем команду
			terminal.sendText(command, true);
		});

		// Очищаем ANSI escape codes для читабельности LLM
		const cleaned = this.stripAnsi(buffer).trim();
		const truncated = cleaned.length > OUTPUT_MAX_CHARS;
		const outputForLlm = truncated
			? cleaned.slice(0, OUTPUT_MAX_CHARS) + `\n\n[... обрезано: показано ${OUTPUT_MAX_CHARS} из ${cleaned.length} симв. Полный вывод — в терминале NIT.]`
			: cleaned;

		if (result.timedOut) {
			return {
				content: `⏱ Команда не завершилась за ${timeoutMs}ms.\nКоманда: ${command}\nЧастичный вывод:\n${outputForLlm}\n\n[Процесс ВСЁ ЕЩЁ запущен в терминале NIT — закрой его руками если надо.]`,
				isError: true,
			};
		}

		const status = result.exitCode === 0
			? `✅ exit ${result.exitCode}`
			: result.exitCode === undefined
				? '⚠ exit code unknown'
				: `❌ exit ${result.exitCode}`;

		return {
			content: `${status} · ${command}\n\n${outputForLlm || '(пустой вывод)'}`,
			isError: result.exitCode !== 0 && result.exitCode !== undefined,
		};
	}

	/**
	 * Удаляет ANSI escape codes из строки.
	 * Покрывает SGR (\x1b[...m), курсорные команды (\x1b[...H/A/B/C/D), и OSC (\x1b]...\x07).
	 */
	private stripAnsi(text: string): string {
		// SGR + курсор + ED/EL: \x1b[ ... letter
		// eslint-disable-next-line no-control-regex
		return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
			// OSC: \x1b] ... \x07 или \x1b\
			// eslint-disable-next-line no-control-regex
			.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
			// Standalone CSI characters
			// eslint-disable-next-line no-control-regex
			.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, '');
	}

	getToolDefinitions(): VibecoderTool[] {
		return [
			{
				type: 'function',
				function: {
					name: 'agent__run_command',
					description: '[Agent] Запустить shell-команду в видимом терминале VS Code. Юзер видит процесс реал-тайм. Возвращает exit code и вывод (обрезается до 10000 симв). Default timeout 60s, max 300s. ОПАСНО — может изменить систему, запустить процессы, удалить файлы. По умолчанию работает в workspace root, передай cwd для другой папки.',
					parameters: {
						type: 'object',
						properties: {
							command: { type: 'string', description: 'Команда shell как её бы ввёл юзер (например "npm install" или "git status")' },
							cwd: { type: 'string', description: 'Рабочая директория (default = workspace root)' },
							timeout_ms: { type: 'number', description: 'Тайм-аут в миллисекундах (default 60000, max 300000)' },
						},
						required: ['command'],
					},
				},
			},
		];
	}

	static getToolCategory(toolName: string): 'safe' | 'medium' | 'dangerous' {
		if (toolName === 'agent__run_command') {
			return 'dangerous';
		}
		return 'dangerous';
	}

	async dispatch(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult> {
		if (toolName === 'agent__run_command') {
			return this.runCommand(args as Parameters<ShellTools['runCommand']>[0]);
		}
		return { content: `shellTools: неизвестный tool ${toolName}`, isError: true };
	}

	static getToolNames(): string[] {
		return ['agent__run_command'];
	}
}
