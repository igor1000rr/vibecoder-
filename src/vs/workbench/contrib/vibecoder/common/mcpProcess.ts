/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Common interface для MCP-process сервиса.
 *
 * Главная задача: запускать stdio-MCP-серверы (типа `npx -y @modelcontextprotocol/server-github`)
 * как child processes в Electron main, потому что sandboxed renderer не имеет
 * прямого доступа к child_process API.
 *
 * Сервис общается с MCP-серверами по протоколу JSON-RPC 2.0 через stdin/stdout
 * (newline-delimited JSON). Делает handshake (initialize + notifications/initialized),
 * tools/list для получения каталога, tools/call для вызовов.
 *
 * Renderer общается с main-side через IPC channel 'vibecoderMcpProcess' (ProxyChannel).
 * См. также:
 *  - electron-main/mcpProcessMainService.ts — main-side реализация
 *  - electron-sandbox/mcpProcessRendererService.ts — renderer-side proxy
 *  - browser/mcp/mcpService.ts — высокоуровневый сервис который объединяет stdio (через этот канал) и HTTP MCP
 */

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Имя IPC канала между renderer и main. Должно совпадать на обеих сторонах.
 */
export const VIBECODER_MCP_PROCESS_CHANNEL = 'vibecoderMcpProcess';

/**
 * Конфигурация одного stdio MCP-сервера для запуска.
 */
export interface VibecoderMcpStdioConfig {
	/** Уникальный id сервера, например 'github', 'supabase' */
	readonly id: string;
	/** Исполняемый файл, например 'npx', 'node', 'python' */
	readonly command: string;
	/** Аргументы команды */
	readonly args: readonly string[];
	/** Дополнительные env-переменные (мерджатся с process.env) */
	readonly env?: Readonly<Record<string, string>>;
	/** Текущая рабочая директория (если нужна) */
	readonly cwd?: string;
}

/**
 * Информация о tool'е MCP-сервера, полученная через tools/list.
 */
export interface VibecoderMcpProcessToolInfo {
	readonly name: string;
	readonly description: string;
	/** JSON Schema input */
	readonly inputSchema: Record<string, unknown>;
}

/**
 * Статус MCP-серверного процесса.
 */
export type VibecoderMcpProcessStatus =
	| { readonly state: 'stopped' }
	| { readonly state: 'starting' }
	| { readonly state: 'running'; readonly pid: number; readonly tools: readonly VibecoderMcpProcessToolInfo[] }
	| { readonly state: 'error'; readonly error: string };

/**
 * Событие изменения статуса.
 */
export interface VibecoderMcpProcessStatusEvent {
	readonly id: string;
	readonly status: VibecoderMcpProcessStatus;
}

/**
 * Результат вызова tools/call.
 */
export interface VibecoderMcpCallResult {
	/** Строковый результат вызова (JSON-stringified content blocks для MCP) */
	readonly content: string;
	/** Был ли вызов помечен сервером как ошибка */
	readonly isError: boolean;
}

/**
 * Основной интерфейс. В renderer резолвится через ProxyChannel, в main —
 * через прямую реализацию VibecoderMcpProcessMainService.
 */
export interface IVibecoderMcpProcessService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeStatus: Event<VibecoderMcpProcessStatusEvent>;

	/**
	 * Запустить stdio MCP-сервер. Делает spawn + initialize handshake + tools/list.
	 * После успеха статус становится 'running' с tools[].
	 *
	 * Идемпотентен: если сервер уже running с теми же параметрами — no-op.
	 * Если параметры изменились — старый процесс убивается, новый запускается.
	 */
	startStdio(config: VibecoderMcpStdioConfig): Promise<VibecoderMcpProcessStatus>;

	/**
	 * Остановить сервер по id. Шлёт SIGTERM, ждёт до 3 секунд, потом SIGKILL.
	 */
	stop(id: string): Promise<void>;

	/**
	 * Остановить все серверы (используется при window reload / app quit).
	 */
	stopAll(): Promise<void>;

	/**
	 * Получить текущий статус сервера.
	 */
	getStatus(id: string): Promise<VibecoderMcpProcessStatus>;

	/**
	 * Получить статусы всех известных серверов.
	 */
	getAllStatuses(): Promise<Readonly<Record<string, VibecoderMcpProcessStatus>>>;

	/**
	 * Вызвать tool на сервере. Сервер должен быть в состоянии 'running'.
	 * Возвращает результат вызова или ошибку.
	 *
	 * Timeout: 60 секунд (большинство MCP-операций укладываются).
	 */
	callTool(id: string, toolName: string, args: Record<string, unknown>): Promise<VibecoderMcpCallResult>;
}

export const IVibecoderMcpProcessService = createDecorator<IVibecoderMcpProcessService>('vibecoderMcpProcessService');
