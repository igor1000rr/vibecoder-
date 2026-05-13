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
 * Разделение ответственности:
 *   - stdio-сервера → через IVibecoderMcpProcessService (main-side child_process)
 *   - HTTP/SSE remote сервера → прямой fetch из renderer
 *
 * Если main-side канал не зарегистрирован (например build без electron-sandbox
 * contribution), stdio-серверы вернут статус 'error' с понятным сообщением.
 */

import { createDecorator, optional } from '../../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { VibecoderTool } from '../llm/llmProvider.js';
import { IVibecoderMcpProcessService, VibecoderMcpProcessStatus } from '../../common/mcpProcess.js';

export const IVibecoderMcpService = createDecorator<IVibecoderMcpService>('vibecoderMcpService');

export interface VibecoderMcpStdioServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
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

	configure(config: VibecoderMcpServersConfig): Promise<void>;
	getServerStatuses(): ReadonlyMap<string, VibecoderMcpServerStatus>;
	getAllTools(): VibecoderTool[];
	callTool(qualifiedName: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }>;
	stopAll(): Promise<void>;
}

/**
 * Реализация MCP-сервиса.
 *
 * Stdio-серверы делегируются IVibecoderMcpProcessService (main-side через IPC).
 * HTTP-серверы запускаются прямо в renderer.
 *
 * Если IVibecoderMcpProcessService недоступен (нет electron-sandbox build или
 * main channel не зарегистрирован) — stdio-серверы помечаются 'error' но HTTP
 * продолжают работать.
 */
export class VibecoderMcpService extends Disposable implements IVibecoderMcpService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeServers = this._register(new Emitter<void>());
	readonly onDidChangeServers: Event<void> = this._onDidChangeServers.event;

	private readonly serverStatuses = new Map<string, VibecoderMcpServerStatus>();
	private readonly stdioServerIds = new Set<string>();

	constructor(
		@optional(IVibecoderMcpProcessService) private readonly mcpProcessService: IVibecoderMcpProcessService | undefined,
	) {
		super();

		// Подписываемся на изменения статусов stdio-серверов от main
		if (this.mcpProcessService) {
			this._register(this.mcpProcessService.onDidChangeStatus(event => {
				this.applyStdioStatus(event.id, event.status);
				this._onDidChangeServers.fire();
			}));
		}
	}

	async configure(config: VibecoderMcpServersConfig): Promise<void> {
		await this.stopAll();

		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			if ('command' in serverConfig) {
				// stdio MCP
				if (!this.mcpProcessService) {
					this.serverStatuses.set(name, {
						state: 'error',
						error: 'stdio MCP недоступен: main-side канал не зарегистрирован (см. инструкцию в репо)',
					});
					continue;
				}
				this.stdioServerIds.add(name);
				this.serverStatuses.set(name, { state: 'starting' });
				this.mcpProcessService.startStdio({
					id: name,
					command: serverConfig.command,
					args: serverConfig.args ?? [],
					env: serverConfig.env,
					cwd: serverConfig.cwd,
				}).then(status => {
					this.applyStdioStatus(name, status);
					this._onDidChangeServers.fire();
				}).catch(err => {
					this.serverStatuses.set(name, { state: 'error', error: err?.message ?? String(err) });
					this._onDidChangeServers.fire();
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

	private applyStdioStatus(name: string, status: VibecoderMcpProcessStatus): void {
		switch (status.state) {
			case 'stopped':
				this.serverStatuses.set(name, { state: 'stopped' });
				break;
			case 'starting':
				this.serverStatuses.set(name, { state: 'starting' });
				break;
			case 'running':
				this.serverStatuses.set(name, {
					state: 'running',
					tools: status.tools.map(t => ({
						serverName: name,
						toolName: t.name,
						description: t.description,
						inputSchema: t.inputSchema,
					})),
				});
				break;
			case 'error':
				this.serverStatuses.set(name, { state: 'error', error: status.error });
				break;
		}
	}

	/**
	 * HTTP/SSE MCP: пока заглушка с HEAD-проверкой.
	 * Полноценный JSON-RPC handshake для HTTP MCP будет в следующей итерации.
	 */
	private async connectHttpServer(name: string, config: VibecoderMcpHttpServerConfig): Promise<void> {
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

		// MVP: помечаем running без реального tools/list (нужен MCP JSON-RPC over HTTP).
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

		// stdio → через main-side service
		if (this.stdioServerIds.has(serverName) && this.mcpProcessService) {
			try {
				const result = await this.mcpProcessService.callTool(serverName, toolName, args);
				return { content: result.content, isError: result.isError };
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				return { content: `MCP tools/call ошибка (${serverName}/${toolName}): ${message}`, isError: true };
			}
		}

		// HTTP — пока заглушка (нужен полноценный MCP HTTP-протокол)
		return {
			content: `MCP HTTP tools/call ещё не реализован (server=${serverName}, tool=${toolName}). Будет в следующей итерации.`,
			isError: true,
		};
	}

	async stopAll(): Promise<void> {
		if (this.mcpProcessService) {
			await this.mcpProcessService.stopAll().catch(() => { /* игнор */ });
		}
		this.serverStatuses.clear();
		this.stdioServerIds.clear();
		this._onDidChangeServers.fire();
	}
}
