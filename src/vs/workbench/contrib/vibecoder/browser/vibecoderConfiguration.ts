/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';
import { VibecoderConfigKeys } from '../common/vibecoder.js';

/**
 * Регистрация конфигурационных ключей Vibecoder.
 * Ключи попадают в Settings UI (Preferences → Settings → Vibecoder)
 * и доступны в settings.json как "vibecoder.*".
 */
export function registerVibecoderConfiguration(): void {
	const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);

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
