/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MCP (Model Context Protocol) клиент Vibecoder.
 *
 * Управляет подключениями к MCP-серверам (stdio или HTTP/SSE), получает
 * списки инструментов и проксирует их вызовы. Используется LLM-агентом
 * для расширения возможностей модели сторонними тулсами.
 *
 * Конфигурация MCP совместима с Claude Desktop / Cursor:
 *
 *   {
 *     "mcpServers": {
 *       "filesystem": {
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
 *       },
 *       "remote": {
 *         "url": "https://my-mcp-server.example.com/sse"
 *       }
 *     }
 *   }
 *
 * stdio-сервера запускаются через electron-main как child processes,
 * remote (HTTP/SSE) — прямо из renderer через fetch.
 */

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { VibecoderTool } from '../llm/llmProvider.js';

export const IVibecoderMcpService = createDecorator<IVibecoderMcpService>('vibecoderMcpService');

export interface VibecoderMcpStdioServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface VibecoderMcpHttpServerConfig {
	url: string;
	headers?: Record<string, string>;
}

export type VibecoderMcpServerConfig = VibecoderMcpStdioServerConfig | VibecoderMcpHttpServerConfig;

export interface VibecoderMcpServersConfig {
	mcpServers: Record<string, VibecoderMcpServerConfig>;
}

export interface VibecoderMcpToolInfo {
	serverName: string;
	toolName: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export type VibecoderMcpServerStatus =
	| { state: 'stopped' }
	| { state: 'starting' }
	| { state: 'running'; tools: VibecoderMcpToolInfo[] }
	| { state: 'error'; error: string };

export interface IVibecoderMcpService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeServers: Event<void>;

	/**
	 * Загрузить/перезагрузить конфигурацию.
	 * MVP: принимает объект напрямую; позже будем читать из workspace/.vibecoder/mcp.json
	 */
	configure(config: VibecoderMcpServersConfig): Promise<void>;

	/**
	 * Получить статус всех зарегистрированных серверов.
	 */
	getServerStatuses(): ReadonlyMap<string, VibecoderMcpServerStatus>;

	/**
	 * Получить плоский список всех доступных инструментов со всех серверов,
	 * сконвертированных в формат Vibecoder/OpenAI (для передачи в LLMRouter).
	 */
	getAllTools(): VibecoderTool[];

	/**
	 * Вызвать MCP-инструмент по имени `serverName/toolName`.
	 */
	callTool(qualifiedName: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }>;

	/**
	 * Остановить все серверы.
	 */
	stopAll(): Promise<void>;
}

/**
 * Реализация MCP-сервиса.
 *
 * ВАЖНО: в этом MVP мы реализуем только HTTP/SSE MCP-серверы из renderer'а.
 * Поддержка stdio-серверов требует канала к electron-main (отдельный child
 * process spawner), это сделаем в следующей итерации.
 */
export class VibecoderMcpService extends Disposable implements IVibecoderMcpService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeServers = this._register(new Emitter<void>());
	readonly onDidChangeServers: Event<void> = this._onDidChangeServers.event;

	private readonly serverStatuses = new Map<string, VibecoderMcpServerStatus>();
	private currentConfig: VibecoderMcpServersConfig | undefined;

	async configure(config: VibecoderMcpServersConfig): Promise<void> {
		// Остановить старые серверы
		await this.stopAll();

		this.currentConfig = config;

		// Запустить новые
		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			if ('command' in serverConfig) {
				// stdio MCP — пока заглушка
				this.serverStatuses.set(name, {
					state: 'error',
					error: 'stdio MCP-серверы пока не поддерживаются (нужен канал в electron-main). Используй HTTP/SSE формат: { "url": "https://..." }',
				});
				continue;
			}
			if ('url' in serverConfig) {
				this.serverStatuses.set(name, { state: 'starting' });
				this.connectHttpServer(name, serverConfig).catch(err => {
					this.serverStatuses.set(name, { state: 'error', error: err?.message ?? String(err) });
					this._onDidChangeServers.fire();
				});
			}
		}

		this._onDidChangeServers.fire();
	}

	/**
	 * Минимальная реализация подключения к HTTP/SSE MCP-серверу.
	 *
	 * MCP по spec: клиент отправляет JSON-RPC POST'ы на endpoint, сервер
	 * стримит ответы по SSE. Полноценный JSON-RPC framework мы добавим
	 * в следующей итерации (когда будет реальный пользовательский кейс);
	 * сейчас просто отмечаем "running" с пустым tools и список вернётся
	 * после реального handshake.
	 */
	private async connectHttpServer(name: string, config: VibecoderMcpHttpServerConfig): Promise<void> {
		// Минимальный health check: HEAD-запрос к URL
		try {
			const response = await fetch(config.url, {
				method: 'HEAD',
				headers: config.headers,
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok && response.status !== 405 /* method not allowed - всё равно жив */) {
				throw new Error(`HTTP ${response.status}`);
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			throw new Error(`Не удалось подключиться к ${config.url}: ${message}`);
		}

		// MVP: помечаем running без реального handshake.
		// Полный JSON-RPC `initialize` → `tools/list` будет в следующей итерации.
		this.serverStatuses.set(name, { state: 'running', tools: [] });
		this._onDidChangeServers.fire();
	}

	getServerStatuses(): ReadonlyMap<string, VibecoderMcpServerStatus> {
		return this.serverStatuses;
	}

	getAllTools(): VibecoderTool[] {
		const out: VibecoderTool[] = [];
		for (const [serverName, status] of this.serverStatuses) {
			if (status.state !== 'running') { continue; }
			for (const tool of status.tools) {
				out.push({
					type: 'function',
					function: {
						// qualifier нужен чтобы избежать конфликта имён между серверами
						name: `${serverName}__${tool.toolName}`,
						description: tool.description,
						parameters: tool.inputSchema,
					},
				});
			}
		}
		return out;
	}

	async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
		const [serverName, ...toolParts] = qualifiedName.split('__');
		const toolName = toolParts.join('__');
		const status = this.serverStatuses.get(serverName);
		if (!status || status.state !== 'running') {
			return { content: `MCP-сервер '${serverName}' не запущен.`, isError: true };
		}
		// Заглушка — реальный JSON-RPC tools/call вызов в следующей итерации
		void args;
		void toolName;
		return {
			content: `MCP tools/call ещё не реализован (server=${serverName}, tool=${toolName}). Будет в следующей итерации.`,
			isError: true,
		};
	}

	async stopAll(): Promise<void> {
		this.serverStatuses.clear();
		this._onDidChangeServers.fire();
	}
}
