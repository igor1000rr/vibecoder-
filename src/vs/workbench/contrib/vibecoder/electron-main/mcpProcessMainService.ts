/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Main-side реализация IVibecoderMcpProcessService.
 *
 * Запускает MCP-серверы как child processes через child_process.spawn,
 * общается с ними по протоколу JSON-RPC 2.0 поверх stdin/stdout
 * (newline-delimited JSON).
 *
 * Жизненный цикл одного сервера:
 *   1. startStdio(config) → spawn child process
 *   2. Подписка на stdout (с буферизацией для частичных строк)
 *   3. JSON-RPC handshake:
 *      - initialize {protocolVersion, capabilities, clientInfo}
 *      - notifications/initialized (notification без id)
 *      - tools/list → получаем каталог инструментов
 *   4. Сервер становится 'running' с tools[]
 *   5. callTool(id, name, args) → JSON-RPC request tools/call → ответ
 *   6. stop(id) → SIGTERM → wait 3s → SIGKILL если живой
 *
 * Регистрация channel: см. mcpProcess.contribution.ts (вызывается из main entry).
 *
 * Windows nuance: npx → npx.cmd (см. resolveCommandForPlatform).
 */

import { spawn, ChildProcess } from 'child_process';
import { isWindows } from '../../../../../base/common/platform.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import {
	IVibecoderMcpProcessService,
	VibecoderMcpStdioConfig,
	VibecoderMcpProcessStatus,
	VibecoderMcpProcessStatusEvent,
	VibecoderMcpCallResult,
	VibecoderMcpProcessToolInfo,
} from '../common/mcpProcess.js';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'vibecoder', version: '0.2.0' };
const TOOL_CALL_TIMEOUT_MS = 60_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const KILL_GRACE_PERIOD_MS = 3_000;

interface PendingRequest {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeoutHandle: NodeJS.Timeout;
}

/**
 * Один запущенный MCP-сервер: процесс, буфер stdout, pending requests, статус.
 */
class McpServerInstance {
	private process: ChildProcess | undefined;
	private nextRequestId = 1;
	private stdoutBuffer = '';
	private readonly pending = new Map<number, PendingRequest>();
	private status: VibecoderMcpProcessStatus = { state: 'stopped' };

	constructor(
		readonly id: string,
		readonly config: VibecoderMcpStdioConfig,
		private readonly logService: ILogService,
		private readonly onStatusChanged: (event: VibecoderMcpProcessStatusEvent) => void,
	) { }

	getStatus(): VibecoderMcpProcessStatus {
		return this.status;
	}

	private setStatus(next: VibecoderMcpProcessStatus): void {
		this.status = next;
		this.onStatusChanged({ id: this.id, status: next });
	}

	async start(): Promise<VibecoderMcpProcessStatus> {
		if (this.process) {
			this.logService.warn(`[Vibecoder MCP] ${this.id}: уже запущен, рестарт`);
			await this.stop();
		}

		this.setStatus({ state: 'starting' });

		const command = resolveCommandForPlatform(this.config.command);
		const env = buildEnv(this.config.env);

		this.logService.info(`[Vibecoder MCP] ${this.id}: spawn '${command}' ${this.config.args.join(' ')}`);

		try {
			this.process = spawn(command, [...this.config.args], {
				env,
				cwd: this.config.cwd,
				stdio: ['pipe', 'pipe', 'pipe'],
				shell: false,
				windowsHide: true,
			});
		} catch (e) {
			const error = `spawn failed: ${(e as Error).message}`;
			this.logService.error(`[Vibecoder MCP] ${this.id}: ${error}`);
			this.setStatus({ state: 'error', error });
			return this.status;
		}

		const child = this.process;
		if (!child.pid) {
			const error = 'процесс запустился но pid пустой';
			this.setStatus({ state: 'error', error });
			return this.status;
		}

		// Подписки на события процесса
		child.stdout?.setEncoding('utf-8');
		child.stderr?.setEncoding('utf-8');

		child.stdout?.on('data', (chunk: string) => this.handleStdoutData(chunk));
		child.stderr?.on('data', (chunk: string) => {
			this.logService.warn(`[Vibecoder MCP] ${this.id} stderr: ${chunk.trim()}`);
		});

		child.on('error', err => {
			this.logService.error(`[Vibecoder MCP] ${this.id}: process error: ${err.message}`);
			this.setStatus({ state: 'error', error: err.message });
			this.rejectAllPending(new Error(`Процесс ${this.id} упал: ${err.message}`));
		});

		child.on('exit', (code, signal) => {
			this.logService.info(`[Vibecoder MCP] ${this.id}: exited code=${code} signal=${signal}`);
			this.process = undefined;
			this.rejectAllPending(new Error(`Процесс ${this.id} завершился (code=${code})`));
			if (this.status.state !== 'error') {
				this.setStatus({ state: 'stopped' });
			}
		});

		// Handshake
		try {
			await this.performHandshake();
			const tools = await this.fetchToolList();
			this.setStatus({ state: 'running', pid: child.pid, tools });
		} catch (e) {
			const error = (e as Error).message;
			this.logService.error(`[Vibecoder MCP] ${this.id}: handshake failed: ${error}`);
			this.setStatus({ state: 'error', error });
			await this.stop();
		}

		return this.status;
	}

	async stop(): Promise<void> {
		this.rejectAllPending(new Error('сервер останавливается'));

		const child = this.process;
		if (!child) {
			this.setStatus({ state: 'stopped' });
			return;
		}

		// Сначала SIGTERM, потом если не закрылся — SIGKILL
		try {
			child.kill('SIGTERM');
		} catch (e) {
			this.logService.warn(`[Vibecoder MCP] ${this.id}: SIGTERM failed: ${(e as Error).message}`);
		}

		await new Promise<void>(resolve => {
			const onExit = () => {
				clearTimeout(killTimer);
				resolve();
			};
			child.once('exit', onExit);
			const killTimer = setTimeout(() => {
				child.off('exit', onExit);
				try { child.kill('SIGKILL'); } catch { /* ignore */ }
				resolve();
			}, KILL_GRACE_PERIOD_MS);
		});

		this.process = undefined;
		this.setStatus({ state: 'stopped' });
	}

	async callTool(toolName: string, args: Record<string, unknown>): Promise<VibecoderMcpCallResult> {
		if (this.status.state !== 'running') {
			throw new Error(`Сервер ${this.id} не в состоянии running (текущее: ${this.status.state})`);
		}
		const result = await this.sendRequest('tools/call', {
			name: toolName,
			arguments: args,
		}, TOOL_CALL_TIMEOUT_MS) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

		// MCP возвращает content как массив content blocks. Конкатенируем text-блоки.
		let content = '';
		if (Array.isArray(result.content)) {
			for (const block of result.content) {
				if (block.type === 'text' && typeof block.text === 'string') {
					content += block.text;
				}
			}
		}
		// Если content пустой но есть исходный объект — JSON-stringify его (для image/resource блоков)
		if (!content && Array.isArray(result.content) && result.content.length > 0) {
			content = JSON.stringify(result.content);
		}
		return {
			content: content || JSON.stringify(result),
			isError: result.isError === true,
		};
	}

	// ── JSON-RPC внутрянка ──────────────────────────────────────

	private async performHandshake(): Promise<void> {
		const initResult = await this.sendRequest('initialize', {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: CLIENT_INFO,
		}, HANDSHAKE_TIMEOUT_MS);
		this.logService.info(`[Vibecoder MCP] ${this.id}: initialized, server=${JSON.stringify((initResult as { serverInfo?: unknown }).serverInfo)}`);

		// Notification без id — не ждём ответа
		this.sendNotification('notifications/initialized', {});
	}

	private async fetchToolList(): Promise<VibecoderMcpProcessToolInfo[]> {
		const result = await this.sendRequest('tools/list', {}, HANDSHAKE_TIMEOUT_MS) as {
			tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
		};
		const tools = result.tools ?? [];
		return tools.map(t => ({
			name: t.name,
			description: t.description ?? '',
			inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
		}));
	}

	private sendRequest(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
		const id = this.nextRequestId++;
		const message = { jsonrpc: '2.0', id, method, params };
		return new Promise<unknown>((resolve, reject) => {
			const timeoutHandle = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timeout (${timeoutMs}ms) для ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timeoutHandle });
			this.writeMessage(message);
		});
	}

	private sendNotification(method: string, params: Record<string, unknown>): void {
		this.writeMessage({ jsonrpc: '2.0', method, params });
	}

	private writeMessage(message: unknown): void {
		const child = this.process;
		if (!child?.stdin || !child.stdin.writable) {
			this.logService.warn(`[Vibecoder MCP] ${this.id}: stdin недоступен`);
			return;
		}
		try {
			child.stdin.write(JSON.stringify(message) + '\n', 'utf-8');
		} catch (e) {
			this.logService.error(`[Vibecoder MCP] ${this.id}: write failed: ${(e as Error).message}`);
		}
	}

	private handleStdoutData(chunk: string): void {
		this.stdoutBuffer += chunk;
		let newlineIdx: number;
		while ((newlineIdx = this.stdoutBuffer.indexOf('\n')) !== -1) {
			const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
			if (!line) { continue; }
			this.handleJsonLine(line);
		}
	}

	private handleJsonLine(line: string): void {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch (e) {
			this.logService.warn(`[Vibecoder MCP] ${this.id}: invalid JSON: ${line.slice(0, 200)}`);
			return;
		}

		// Response: имеет id и (result или error)
		if (typeof msg.id === 'number') {
			const pending = this.pending.get(msg.id);
			if (!pending) {
				this.logService.warn(`[Vibecoder MCP] ${this.id}: response для неизвестного id=${msg.id}`);
				return;
			}
			this.pending.delete(msg.id);
			clearTimeout(pending.timeoutHandle);
			if (msg.error) {
				pending.reject(new Error(msg.error.message ?? 'JSON-RPC error'));
			} else {
				pending.resolve(msg.result);
			}
			return;
		}

		// Notification от сервера (без id) — пока игнорируем (логируем для дебага)
		if (typeof msg.method === 'string') {
			this.logService.trace(`[Vibecoder MCP] ${this.id}: notification ${msg.method}`);
			return;
		}

		this.logService.warn(`[Vibecoder MCP] ${this.id}: неожиданное сообщение: ${line.slice(0, 200)}`);
	}

	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timeoutHandle);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

/**
 * Главный сервис. Управляет коллекцией McpServerInstance, эмитит события статуса.
 */
export class VibecoderMcpProcessMainService extends Disposable implements IVibecoderMcpProcessService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<VibecoderMcpProcessStatusEvent>());
	readonly onDidChangeStatus: Event<VibecoderMcpProcessStatusEvent> = this._onDidChangeStatus.event;

	private readonly servers = new Map<string, McpServerInstance>();

	constructor(@ILogService private readonly logService: ILogService) {
		super();
	}

	async startStdio(config: VibecoderMcpStdioConfig): Promise<VibecoderMcpProcessStatus> {
		// Идемпотентность: если уже запущен с теми же параметрами — вернуть статус
		const existing = this.servers.get(config.id);
		if (existing && configsEqual(existing.config, config) && existing.getStatus().state === 'running') {
			return existing.getStatus();
		}
		// Если запущен с другими параметрами — рестарт
		if (existing) {
			await existing.stop();
			this.servers.delete(config.id);
		}

		const instance = new McpServerInstance(config.id, config, this.logService, event => this._onDidChangeStatus.fire(event));
		this.servers.set(config.id, instance);
		return await instance.start();
	}

	async stop(id: string): Promise<void> {
		const instance = this.servers.get(id);
		if (!instance) { return; }
		await instance.stop();
		this.servers.delete(id);
	}

	async stopAll(): Promise<void> {
		const ids = Array.from(this.servers.keys());
		await Promise.all(ids.map(id => this.stop(id)));
	}

	async getStatus(id: string): Promise<VibecoderMcpProcessStatus> {
		const instance = this.servers.get(id);
		return instance?.getStatus() ?? { state: 'stopped' };
	}

	async getAllStatuses(): Promise<Readonly<Record<string, VibecoderMcpProcessStatus>>> {
		const out: Record<string, VibecoderMcpProcessStatus> = {};
		for (const [id, instance] of this.servers) {
			out[id] = instance.getStatus();
		}
		return out;
	}

	async callTool(id: string, toolName: string, args: Record<string, unknown>): Promise<VibecoderMcpCallResult> {
		const instance = this.servers.get(id);
		if (!instance) {
			throw new Error(`Сервер ${id} не зарегистрирован`);
		}
		return await instance.callTool(toolName, args);
	}

	override dispose(): void {
		void this.stopAll();
		super.dispose();
	}
}

// ── Хелперы ─────────────────────────────────────────────────────

/**
 * На Windows `npx` — это `.cmd` файл, который spawn без shell не находит.
 * Добавляем суффикс если команда без расширения и платформа Windows.
 */
function resolveCommandForPlatform(command: string): string {
	if (!isWindows) { return command; }
	if (/\.(exe|cmd|bat|com)$/i.test(command)) { return command; }
	// Известные npm-команды на Windows — это .cmd
	if (['npx', 'npm', 'pnpm', 'yarn'].includes(command.toLowerCase())) {
		return `${command}.cmd`;
	}
	return command;
}

function buildEnv(extra: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	if (extra) {
		for (const [key, value] of Object.entries(extra)) {
			env[key] = value;
		}
	}
	return env;
}

function configsEqual(a: VibecoderMcpStdioConfig, b: VibecoderMcpStdioConfig): boolean {
	if (a.command !== b.command) { return false; }
	if (a.cwd !== b.cwd) { return false; }
	if (a.args.length !== b.args.length) { return false; }
	for (let i = 0; i < a.args.length; i++) {
		if (a.args[i] !== b.args[i]) { return false; }
	}
	const aEnvKeys = Object.keys(a.env ?? {}).sort();
	const bEnvKeys = Object.keys(b.env ?? {}).sort();
	if (aEnvKeys.length !== bEnvKeys.length) { return false; }
	for (let i = 0; i < aEnvKeys.length; i++) {
		if (aEnvKeys[i] !== bEnvKeys[i]) { return false; }
		if ((a.env ?? {})[aEnvKeys[i]] !== (b.env ?? {})[bEnvKeys[i]]) { return false; }
	}
	return true;
}
