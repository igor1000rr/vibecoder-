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
 * Регистрация singleton — в browser/vibecoder.contribution.ts (electron-sandbox only).
 *
 * Если main-side канал не зарегистрирован (например, если build не подключил
 * mcpProcess.contribution в main entry) — вызовы будут падать с понятной ошибкой
 * "Channel 'vibecoderMcpProcess' not found", которую можно показать в UI.
 */

import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { IVibecoderMcpProcessService, VIBECODER_MCP_PROCESS_CHANNEL } from '../../common/mcpProcess.js';

/**
 * Регистрирует renderer-side прокси к main MCP-сервису.
 *
 * Должна вызываться ОДИН РАЗ при инициализации workbench в electron-sandbox.
 * После этого `IVibecoderMcpProcessService` доступен через DI.
 */
export function registerVibecoderMcpProcessRendererService(): void {
	registerSingleton(
		IVibecoderMcpProcessService,
		class VibecoderMcpProcessProxy {
			declare readonly _serviceBrand: undefined;

			static readonly $useInstantiationFactory = true;

			constructor(@IMainProcessService mainProcessService: IMainProcessService) {
				const channel = mainProcessService.getChannel(VIBECODER_MCP_PROCESS_CHANNEL);
				return ProxyChannel.toService<IVibecoderMcpProcessService>(channel);
			}
		} as any,
		InstantiationType.Delayed,
	);
}
