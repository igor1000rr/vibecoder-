/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Electron-sandbox specific Vibecoder contribution.
 *
 * Этот файл подключается ТОЛЬКО в electron build (не в web).
 * Регистрирует renderer-side прокси к main MCP-сервису.
 *
 * Подключение: импорт-side-effect должен быть добавлен в
 * src/vs/workbench/workbench.desktop.main.ts:
 *
 *   import './contrib/vibecoder/electron-sandbox/vibecoder.contribution.js';
 */

import { registerVibecoderMcpProcessRendererService } from './mcpProcessRendererService.js';

// Регистрируем при импорте этого модуля
registerVibecoderMcpProcessRendererService();
