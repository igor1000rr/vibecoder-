/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MCP (Model Context Protocol) клиент Vibecoder.
 *
 * Управляет подключениями к MCP-серверам (stdio или HTTP/SSE):
 *   1. Автоматически загружает .vibecoder/mcp.json при старте workspace
 *   2. Перезагружает при изменении файла (file watcher)
 *   3. stdio-серверы → через main-side IVibecoderMcpProcessService (child_process)
 *   4. HTTP/SSE серверы → JSON-RPC handshake (initialize → tools/list) + tools/call
 *
 * Конфигурация совместима с Claude Desktop / Cursor mcp.json.
 *
 * Если IVibecoderMcpProcessService недоступен (не electron-sandbox build),
 * stdio помечаются 'error', но HTTP продолжают работать.
 */

import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IFileService, FileChangeType, FileChangesEvent } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
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
	reloadFromWorkspace(): Promise<void>;
	getServerStatuses(): ReadonlyMap<string, VibecoderMcpServerStatus>;
	getAllTools(): VibecoderTool[];
	callTool(qualifiedName: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }>;
	stopAll(): Promise<void>;
}

// Константы протокола MCP (совпадают с mcpProcessMainService.ts)
const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_CLIENT_INFO = { name: 'vibecoder', version: '0.2.0' };
const MCP_HTTP_TIMEOUT_MS = 30_000;

/**
 * Для каждого HTTP MCP-сервера держим JSON-RPC state: следующий id запроса,
 * заголовки, URL. tools/list делается один раз при подключении, потом кэш.
 */
interface HttpServerState {
	url: string;
	headers: Record<string, string>;
	nextRequestId: number;
}

export class VibecoderMcpService extends Disposable implements IVibecoderMcpService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeServers = this._register(new Emitter<void>());
	readonly onDidChangeServers: Event<void> = this._onDidChangeServers.event;

	private readonly serverStatuses = new Map<string, VibecoderMcpServerStatus>();
	private readonly stdioServerIds = new Set<string>();
	private readonly httpServers = new Map<string, HttpServerState>();

	/** Опциональная ссылка на main-side stdio MCP сервис */
	private readonly mcpProcessService: IVibecoderMcpProcessService | undefined;

	/** Disposable для watcher .vibecoder/mcp.json — пересоздаётся при смене workspace */
	private mcpJsonWatcher: IDisposable | undefined;

	/** Debounce для авто-reload при изменении файла */
	private reloadDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
	) {
		super();

		this.mcpProcessService = instantiationService.invokeFunction(accessor => {
			try {
				return accessor.get(IVibecoderMcpProcessService);
			} catch {
				return undefined;
			}
		});

		// Подписываемся на изменения статусов stdio-серверов от main
		if (this.mcpProcessService) {
			this._register(this.mcpProcessService.onDidChangeStatus(event => {
				this.applyStdioStatus(event.id, event.status);
				this._onDidChangeServers.fire();
			}));
		}

		// При смене workspace — пересоздать watcher и перезагрузить конфиг
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => {
			this.setupWatcher();
			this.reloadFromWorkspace().catch(err => console.warn('[Vibecoder MCP] reload failed:', err));
		}));

		// Инициализация: подключить watcher и подгрузить mcp.json текущего workspace
		this.setupWatcher();
		this.reloadFromWorkspace().catch(err => console.warn('[Vibecoder MCP] initial load failed:', err));
	}

	// ── Auto-load из .vibecoder/mcp.json ──────────────────────

	private setupWatcher(): void {
		this.mcpJsonWatcher?.dispose();
		this.mcpJsonWatcher = undefined;

		const mcpUri = this.getMcpJsonUri();
		if (!mcpUri) { return; }

		// Подписка на изменения в .vibecoder/ через FileService
		const watchDisposable = this.fileService.watch(URI.joinPath(mcpUri, '..'));
		const changeDisposable = this.fileService.onDidFilesChange(e => this.onMcpJsonChanged(e, mcpUri));

		// Комбинируем оба disposable
		this.mcpJsonWatcher = {
			dispose: () => {
				watchDisposable.dispose();
				changeDisposable.dispose();
			},
		};
	}

	private onMcpJsonChanged(event: FileChangesEvent, mcpUri: URI): void {
		// Перезагружаем только если изменился именно mcp.json
		const affected = event.changes.find(c =>
			c.resource.toString() === mcpUri.toString() &&
			(c.type === FileChangeType.UPDATED || c.type === FileChangeType.ADDED || c.type === FileChangeType.DELETED)
		);
		if (!affected) { return; }

		// Debounce — VS Code/OS может фаирить несколько ивентов на одно сохранение
		if (this.reloadDebounceTimer) { clearTimeout(this.reloadDebounceTimer); }
		this.reloadDebounceTimer = setTimeout(() => {
			this.reloadDebounceTimer = undefined;
			console.log('[Vibecoder MCP] mcp.json изменён, перезагружаю...');
			this.reloadFromWorkspace().catch(err => console.warn('[Vibecoder MCP] reload error:', err));
		}, 500);
	}

	async reloadFromWorkspace(): Promise<void> {
		const mcpUri = this.getMcpJsonUri();
		if (!mcpUri) {
			// Нет workspace — просто очищаем серверы
			await this.stopAll();
			return;
		}

		let config: VibecoderMcpServersConfig;
		try {
			const exists = await this.fileService.exists(mcpUri);
			if (!exists) {
				await this.stopAll();
				return;
			}
			const content = await this.fileService.readFile(mcpUri);
			const parsed = JSON.parse(content.value.toString());
			if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
				await this.stopAll();
				return;
			}
			config = parsed as VibecoderMcpServersConfig;
		} catch (e) {
			console.warn('[Vibecoder MCP] не удалось прочитать mcp.json:', e);
			await this.stopAll();
			return;
		}

		const serverCount = Object.keys(config.mcpServers).length;
		if (serverCount > 0) {
			console.log(`[Vibecoder MCP] загружено ${serverCount} серверов из mcp.json`);
		}

		await this.configure(config);
	}

	private getMcpJsonUri(): URI | undefined {
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) { return undefined; }
		return URI.joinPath(folders[0].uri, '.vibecoder', 'mcp.json');
	}

	// ── configure ─────────────────────────────────────────────

	async configure(config: VibecoderMcpServersConfig): Promise<void> {
		await this.stopAll();

		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			if ('command' in serverConfig) {
				if (!this.mcpProcessService) {
					this.serverStatuses.set(name, {
						state: 'error',
						error: 'stdio MCP недоступен: main-side канал не зарегистрирован',
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
				this.connectHttpServer(name, serverConfig).then(() => {
					this._onDidChangeServers.fire();
				}).catch(err => {
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

	// ── HTTP MCP полноценный JSON-RPC ──────────────────────────

	/**
	 * Подключение к HTTP MCP-серверу:
	 *   1. POST initialize {protocolVersion, capabilities, clientInfo}
	 *   2. POST notifications/initialized (без id)
	 *   3. POST tools/list → получаем каталог
	 * Сервер должен принимать POST JSON-RPC 2.0 на тот же URL.
	 */
	private async connectHttpServer(name: string, config: VibecoderMcpHttpServerConfig): Promise<void> {
		const state: HttpServerState = {
			url: config.url,
			headers: { 'Content-Type': 'application/json', ...config.headers },
			nextRequestId: 1,
		};
		this.httpServers.set(name, state);

		// 1. initialize
		try {
			await this.httpRpc(state, 'initialize', {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: MCP_CLIENT_INFO,
			});
		} catch (e) {
			throw new Error(`initialize failed для ${config.url}: ${(e as Error).message}`);
		}

		// 2. notifications/initialized (notification — без ожидания ответа)
		this.httpRpcNotify(state, 'notifications/initialized', {}).catch(() => { /* игнор */ });

		// 3. tools/list
		let tools: VibecoderMcpToolInfo[] = [];
		try {
			const result = await this.httpRpc(state, 'tools/list', {}) as {
				tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
			};
			tools = (result.tools ?? []).map(t => ({
				serverName: name,
				toolName: t.name,
				description: t.description ?? '',
				inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
			}));
		} catch (e) {
			// tools/list упал, но сервер жив (initialize прошёл). Помечаем running с пустым списком.
			console.warn(`[Vibecoder MCP] ${name} tools/list failed: ${(e as Error).message}`);
		}

		this.serverStatuses.set(name, { state: 'running', tools });
	}

	/**
	 * Отправить JSON-RPC request (с id и ожиданием response).
	 */
	private async httpRpc(state: HttpServerState, method: string, params: Record<string, unknown>): Promise<unknown> {
		const id = state.nextRequestId++;
		const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

		const response = await fetch(state.url, {
			method: 'POST',
			headers: state.headers,
			body,
			signal: AbortSignal.timeout(MCP_HTTP_TIMEOUT_MS),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		// MCP HTTP может отвечать SSE (Content-Type: text/event-stream) или JSON.
		// Streamable HTTP transport: одно сообщение приходит как SSE event 'message'.
		const contentType = response.headers.get('content-type') ?? '';
		let rpcResponse: { id?: number; result?: unknown; error?: { message?: string } };

		if (contentType.includes('text/event-stream')) {
			const text = await response.text();
			// Парсим первый SSE-event с данными вида "data: {...}"
			const match = text.match(/^data:\s*(.+?)$/m);
			if (!match) {
				throw new Error('SSE response не содержит data');
			}
			rpcResponse = JSON.parse(match[1]);
		} else {
			rpcResponse = await response.json();
		}

		if (rpcResponse.error) {
			throw new Error(rpcResponse.error.message ?? 'JSON-RPC error');
		}
		return rpcResponse.result;
	}

	/**
	 * Отправить JSON-RPC notification (без id, без ожидания response).
	 */
	private async httpRpcNotify(state: HttpServerState, method: string, params: Record<string, unknown>): Promise<void> {
		const body = JSON.stringify({ jsonrpc: '2.0', method, params });
		await fetch(state.url, {
			method: 'POST',
			headers: state.headers,
			body,
			signal: AbortSignal.timeout(5000),
		}).catch(() => { /* игнор */ });
	}

	// ── Геттеры и tools ───────────────────────────────────────

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
						description: `[MCP/${serverName}] ${tool.description}`,
						parameters: tool.inputSchema,
					},
				});
			}
		}
		return out;
	}

	async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
		const sepIdx = qualifiedName.indexOf('__');
		if (sepIdx === -1) {
			return { content: `Неверный формат tool name '${qualifiedName}'. Ожидается '<server>__<tool>'.`, isError: true };
		}
		const serverName = qualifiedName.slice(0, sepIdx);
		const toolName = qualifiedName.slice(sepIdx + 2);

		const status = this.serverStatuses.get(serverName);
		if (!status || status.state !== 'running') {
			return { content: `MCP-сервер '${serverName}' не запущен.`, isError: true };
		}

		// stdio → main
		if (this.stdioServerIds.has(serverName) && this.mcpProcessService) {
			try {
				const result = await this.mcpProcessService.callTool(serverName, toolName, args);
				return { content: result.content, isError: result.isError };
			} catch (e) {
				return {
					content: `MCP tools/call ошибка (${serverName}/${toolName}): ${(e as Error).message}`,
					isError: true,
				};
			}
		}

		// HTTP → fetch
		const httpState = this.httpServers.get(serverName);
		if (httpState) {
			try {
				const result = await this.httpRpc(httpState, 'tools/call', {
					name: toolName,
					arguments: args,
				}) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

				let content = '';
				if (Array.isArray(result.content)) {
					for (const block of result.content) {
						if (block.type === 'text' && typeof block.text === 'string') {
							content += block.text;
						}
					}
				}
				if (!content && Array.isArray(result.content) && result.content.length > 0) {
					content = JSON.stringify(result.content);
				}
				return {
					content: content || JSON.stringify(result),
					isError: result.isError === true,
				};
			} catch (e) {
				return {
					content: `MCP HTTP tools/call ошибка (${serverName}/${toolName}): ${(e as Error).message}`,
					isError: true,
				};
			}
		}

		return { content: `MCP server '${serverName}' не имеет обработчика (ни stdio, ни HTTP)`, isError: true };
	}

	async stopAll(): Promise<void> {
		if (this.mcpProcessService) {
			await this.mcpProcessService.stopAll().catch(() => { /* игнор */ });
		}
		this.serverStatuses.clear();
		this.stdioServerIds.clear();
		this.httpServers.clear();
		this._onDidChangeServers.fire();
	}

	override dispose(): void {
		this.mcpJsonWatcher?.dispose();
		if (this.reloadDebounceTimer) { clearTimeout(this.reloadDebounceTimer); }
		super.dispose();
	}
}
