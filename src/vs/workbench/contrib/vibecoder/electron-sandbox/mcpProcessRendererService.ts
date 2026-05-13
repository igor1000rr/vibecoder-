/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Renderer-side proxy для IVibecoderMcpProcessService.
 *
 * Подключается к main-side сервису через IMainProcessService.getChannel(...)
 * и ProxyChannel.toService — типобезопасный RPC к main.
 *
 * Использует паттерн делегирования: класс получает IMainProcessService через DI,
 * создаёт proxy через ProxyChannel.toService и хранит его в поле. Все методы
 * интерфейса делегируются proxy. Это работает в TS strict mode (в отличие от
 * `return proxy` из конструктора).
 *
 * Регистрация singleton — в electron-sandbox/vibecoder.contribution.ts.
 */

import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { Event } from '../../../../../base/common/event.js';
import {
	IVibecoderMcpProcessService,
	VIBECODER_MCP_PROCESS_CHANNEL,
	VibecoderMcpStdioConfig,
	VibecoderMcpProcessStatus,
	VibecoderMcpProcessStatusEvent,
	VibecoderMcpCallResult,
} from '../../common/mcpProcess.js';

/**
 * Renderer-side класс. Делегирует все вызовы proxy, созданному из канала IPC.
 *
 * Паттерн: VS Code OSS использует ProxyChannel.toService напрямую через
 * `ProxyChannel.toService<T>(channel)` — он возвращает объект который проксирует
 * методы. Мы хранили бы его в поле и делегировали, но проще: ProxyChannel.toService
 * умеет работать как замена интерфейса целиком, потому что Proxy перехватывает все
 * property accesses. Поэтому достаточно один раз создать proxy и хранить в поле.
 */
class VibecoderMcpProcessRendererService implements IVibecoderMcpProcessService {
	declare readonly _serviceBrand: undefined;

	private readonly proxy: IVibecoderMcpProcessService;

	readonly onDidChangeStatus: Event<VibecoderMcpProcessStatusEvent>;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		const channel = mainProcessService.getChannel(VIBECODER_MCP_PROCESS_CHANNEL);
		this.proxy = ProxyChannel.toService<IVibecoderMcpProcessService>(channel);
		// Event привязываем сразу, чтобы свойство было доступно при подписке
		this.onDidChangeStatus = this.proxy.onDidChangeStatus;
	}

	startStdio(config: VibecoderMcpStdioConfig): Promise<VibecoderMcpProcessStatus> {
		return this.proxy.startStdio(config);
	}

	stop(id: string): Promise<void> {
		return this.proxy.stop(id);
	}

	stopAll(): Promise<void> {
		return this.proxy.stopAll();
	}

	getStatus(id: string): Promise<VibecoderMcpProcessStatus> {
		return this.proxy.getStatus(id);
	}

	getAllStatuses(): Promise<Readonly<Record<string, VibecoderMcpProcessStatus>>> {
		return this.proxy.getAllStatuses();
	}

	callTool(id: string, toolName: string, args: Record<string, unknown>): Promise<VibecoderMcpCallResult> {
		return this.proxy.callTool(id, toolName, args);
	}
}

/**
 * Регистрирует renderer-side singleton.
 *
 * Должна вызываться ОДИН РАЗ при инициализации workbench в electron-sandbox.
 */
export function registerVibecoderMcpProcessRendererService(): void {
	registerSingleton(
		IVibecoderMcpProcessService,
		VibecoderMcpProcessRendererService,
		InstantiationType.Delayed,
	);
}
