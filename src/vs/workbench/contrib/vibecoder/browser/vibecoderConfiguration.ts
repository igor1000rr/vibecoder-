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
 * Дефолты применяются ко всем новым юзерам автоматически — без необходимости
 * выбирать тему через `Preferences: Color Theme`. Если юзер сам поменяет
 * настройку — её значение перевесит наш дефолт (стандартное поведение
 * VS Code, никто ничего не "ломает").
 */
export function registerVibecoderConfiguration(): void {
	const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);

	// ── Оверрайд чужих дефолтов под наш бренд ───────────────────────────────
	// Срабатывает только при первом запуске или для настроек, которых нет
	// в user-settings.json. Юзер всегда может перебить.
	registry.registerDefaultConfigurations([{
		overrides: {
			// Киберпанк-тема как дефолт
			'workbench.colorTheme': 'Vibecoder Cyberpunk',

			// Файловые иконки оставляем стандартные (не мешают)
			// 'workbench.iconTheme': 'vs-seti',

			// Шрифт: моноширный с лигатурами если есть JetBrains Mono на системе
			'editor.fontFamily': "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, 'Courier New', monospace",
			'editor.fontLigatures': true,
			'editor.fontSize': 13,
			'editor.lineHeight': 1.6,
			'editor.cursorBlinking': 'phase',
			'editor.cursorSmoothCaretAnimation': 'on',
			'editor.smoothScrolling': true,
			'editor.minimap.enabled': true,
			'editor.minimap.renderCharacters': false,
			'editor.bracketPairColorization.enabled': true,
			'editor.guides.bracketPairs': 'active',

			// Workbench
			'workbench.list.smoothScrolling': true,
			'workbench.tree.indent': 12,
			'workbench.editor.showTabs': 'multiple',
			'workbench.editor.tabSizing': 'shrink',
			'workbench.editor.labelFormat': 'short',
			'workbench.activityBar.location': 'default',
			'workbench.sideBar.location': 'left',

			// Стартовая страница — наш Welcome, не VS Code welcomePage
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

			// Скрываем баннер про "do you trust this folder" для удобства
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
					localize('vibecoder.proxy.mode.direct', 'Ходить в API провайдеров (Anthropic/OpenAI/Gemini) напрямую. Может не работать из санкционных регионов.'),
					localize('vibecoder.proxy.mode.vibecoder', 'Использовать встроенный прокси proxy.vibecoder.dev (Cloudflare Workers). Решает проблемы географии и CORS. Ключи всё равно ТВОИ - прокси только пересылает запросы, не хранит ключи.'),
					localize('vibecoder.proxy.mode.custom', 'Использовать свой собственный self-hosted прокси (укажи URL в vibecoder.proxy.customUrl).'),
				],
				default: 'direct',
				description: localize('vibecoder.proxy.mode.description', 'Режим работы с облачными LLM-провайдерами. Локальная LM Studio всегда работает напрямую.'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.ProxyCustomUrl]: {
				type: 'string',
				default: '',
				description: localize('vibecoder.proxy.customUrl.description', 'URL custom-прокси (используется когда proxy.mode = "custom"). Пример: https://my-proxy.example.com'),
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
				description: localize('vibecoder.lmStudio.composerModel.description', 'Имя модели LM Studio для composer/chat (рекомендуется Qwen 3 Coder 30B-A3B или сравнимая). Пусто = выбрать первую загруженную.'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.LmStudioAutocompleteModel]: {
				type: 'string',
				default: '',
				description: localize('vibecoder.lmStudio.autocompleteModel.description', 'Маленькая быстрая модель для tab-autocomplete (рекомендуется Qwen 2.5 Coder 1.5B или 3B). Пусто = автокомплит выключен.'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.LmStudioEmbeddingModel]: {
				type: 'string',
				default: '',
				description: localize('vibecoder.lmStudio.embeddingModel.description', 'Embedding-модель для кодового индекса (рекомендуется nomic-embed-text-v1.5). Пусто = индексация выключена.'),
				scope: ConfigurationScope.APPLICATION,
			},
			[VibecoderConfigKeys.TelemetryEnabled]: {
				type: 'boolean',
				default: false,
				description: localize('vibecoder.telemetry.description', 'Анонимная телеметрия использования Vibecoder. По умолчанию выключена. Никакой код, ключи, или личные данные никогда не отправляются.'),
				scope: ConfigurationScope.APPLICATION,
			},
		},
	});
}
