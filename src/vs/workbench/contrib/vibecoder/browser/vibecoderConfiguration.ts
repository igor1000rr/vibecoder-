/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';
import { VibecoderConfigKeys } from '../common/vibecoder.js';

/**
 * Регистрация конфигурационных ключей Vibecoder и оверрайд дефолтов
 * VS Code OSS под бренд Vibecoder.
 *
 * Дефолты применяются ко всем новым юзерам автоматически. Если юзер сам
 * поменяет настройку — её значение перевесит наш дефолт.
 */
export function registerVibecoderConfiguration(): void {
	const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);

	// ── Оверрайд чужих дефолтов под наш бренд (Cursor-style layout) ─────────
	registry.registerDefaultConfigurations([{
		overrides: {
			// Киберпанк-тема как дефолт
			'workbench.colorTheme': 'Vibecoder Cyberpunk',

			// Шрифт: моноширный с лигатурами
			'editor.fontFamily': "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
			'editor.fontLigatures': true,
			'editor.fontSize': 13,
			'editor.lineHeight': 1.6,
			'editor.cursorBlinking': 'phase',
			'editor.cursorSmoothCaretAnimation': 'on',
			'editor.smoothScrolling': true,
			'editor.minimap.enabled': false,
			'editor.minimap.renderCharacters': false,
			'editor.bracketPairColorization.enabled': true,
			'editor.guides.bracketPairs': 'active',

			// Workbench — Cursor-style: компактный, чат справа
			'workbench.list.smoothScrolling': true,
			'workbench.tree.indent': 12,
			'workbench.editor.showTabs': 'multiple',
			'workbench.editor.tabSizing': 'shrink',
			'workbench.editor.labelFormat': 'short',
			'workbench.activityBar.location': 'default',
			'workbench.sideBar.location': 'left',

			// AuxiliaryBar (правая панель) — здесь живёт NIT.
			// 'right' это и так дефолт, но фиксируем явно.
			// Открытие при старте делается в VibecoderStartupContribution.

			// Стартовая страница — наш Welcome
			'workbench.startupEditor': 'none',

			// Terminal
			'terminal.integrated.fontFamily': "'JetBrains Mono', monospace",
			'terminal.integrated.cursorBlinking': true,
			'terminal.integrated.cursorStyle': 'block',

			// Window
			'window.titleBarStyle': 'custom',
			'window.menuBarVisibility': 'compact',

			// Отключаем шумные приглашения
			'extensions.ignoreRecommendations': true,
			'workbench.tips.enabled': false,
			'telemetry.telemetryLevel': 'off',

			// Trust banner вырубаем для удобства
			'security.workspace.trust.banner': 'never',
			'security.workspace.trust.startupPrompt': 'never',
		},
	}]);

	// ── Свои настройки Vibecoder (vibecoder.*) ──────────────────────────────
	registry.registerConfiguration({
		id: 'vibecoder',
		title: localize('vibecoder.config.title', 'Vibecoder'),
		order: 1,
		type: 'object',
		properties: {
			[VibecoderConfigKeys.ProxyMode]: {
				type: 'string',
				enum: ['direct', 'vibecoder', 'custom'],
				enumDescriptions: [
					localize('vibecoder.proxy.mode.direct', 'Ходить в API провайдеров напрямую. Может не работать из санкционных регионов.'),
					localize('vibecoder.proxy.mode.vibecoder', 'Использовать встроенный прокси proxy.vibecoder.dev (Cloudflare Workers). Ключи всё равно ТВОИ.'),
					localize('vibecoder.proxy.mode.custom', 'Использовать свой self-hosted прокси (URL в vibecoder.proxy.customUrl).'),
				],
				default: 'direct',
				description: localize('vibecoder.proxy.mode.description', 'Режим работы с облачными LLM. Локальная LM Studio всегда работает напрямую.'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.ProxyCustomUrl]: {
				type: 'string',
				default: '',
				description: localize('vibecoder.proxy.customUrl.description', 'URL custom-прокси. Пример: https://my-proxy.example.com'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.LmStudioEndpoint]: {
				type: 'string',
				default: 'http://localhost:1234/v1',
				description: localize('vibecoder.lmStudio.endpoint.description', 'URL локального API-сервера LM Studio. По умолчанию http://localhost:1234/v1.'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.LmStudioComposerModel]: {
				type: 'string',
				default: '',
				description: localize('vibecoder.lmStudio.composerModel.description', 'Имя модели LM Studio для composer/chat (рекомендуется Qwen 3 Coder 30B-A3B). Пусто = первая загруженная.'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.LmStudioAutocompleteModel]: {
				type: 'string',
				default: '',
				description: localize('vibecoder.lmStudio.autocompleteModel.description', 'Маленькая быстрая модель для tab-autocomplete (Qwen 2.5 Coder 1.5B или 3B).'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.LmStudioEmbeddingModel]: {
				type: 'string',
				default: '',
				description: localize('vibecoder.lmStudio.embeddingModel.description', 'Embedding-модель для кодового индекса (nomic-embed-text-v1.5).'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.TelemetryEnabled]: {
				type: 'boolean',
				default: false,
				description: localize('vibecoder.telemetry.description', 'Анонимная телеметрия использования Vibecoder. По умолчанию выключена.'),
				scope: ConfigurationScope.APPLICATION,
			},
			'vibecoder.ui.openNitOnStartup': {
				type: 'boolean',
				default: true,
				description: localize('vibecoder.ui.openNitOnStartup.description', 'Открывать NIT-сайдбар справа при запуске Vibecoder.'),
				scope: ConfigurationScope.APPLICATION,
			},
		},
	});
}
