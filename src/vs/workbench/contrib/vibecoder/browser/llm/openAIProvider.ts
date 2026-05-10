/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VibecoderProviderId } from '../../common/vibecoder.js';
import { VibecoderModelInfo, VibecoderProviderCapabilities } from './llmProvider.js';
import { OpenAICompatibleProvider } from './openAICompatibleProvider.js';

/**
 * Известные модели OpenAI (на ~май 2026).
 * Списки моделей у провайдеров надо периодически обновлять.
 */
const KNOWN_OPENAI_MODELS: VibecoderModelInfo[] = [
	{ id: 'gpt-5', displayName: 'GPT-5', contextWindow: 200_000, supportsTools: true, supportsVision: true },
	{ id: 'gpt-5-mini', displayName: 'GPT-5 Mini', contextWindow: 200_000, supportsTools: true, supportsVision: true },
	{ id: 'gpt-4.1', displayName: 'GPT-4.1', contextWindow: 1_000_000, supportsTools: true, supportsVision: true },
	{ id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128_000, supportsTools: true, supportsVision: true },
	{ id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', contextWindow: 128_000, supportsTools: true, supportsVision: true },
	{ id: 'o3', displayName: 'o3 (reasoning)', contextWindow: 200_000, supportsTools: true },
	{ id: 'o3-mini', displayName: 'o3 Mini', contextWindow: 200_000, supportsTools: true },
];

export class OpenAIProvider extends OpenAICompatibleProvider {
	readonly id: VibecoderProviderId = 'openai';
	readonly displayName = 'OpenAI';
	readonly capabilities: VibecoderProviderCapabilities = {
		supportsStreaming: true,
		supportsTools: true,
		supportsVision: true,
		requiresApiKey: true,
		isLocal: false,
	};

	constructor(apiKey: string = '', endpoint: string = 'https://api.openai.com/v1') {
		super(endpoint, apiKey);
	}

	async listModels(): Promise<VibecoderModelInfo[]> {
		// Сначала пытаемся вытянуть live-список через /models, fallback на захардкоженные.
		try {
			const ids = await this.fetchModelsFromEndpoint();
			// Фильтруем шум (whisper, embeddings, image gen, tts)
			const chatIds = ids.filter(id =>
				(id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4'))
				&& !id.includes('audio') && !id.includes('realtime') && !id.includes('search')
			);
			if (chatIds.length === 0) {
				return KNOWN_OPENAI_MODELS;
			}
			// Обогащаем известными метаданными где можем
			return chatIds.map(id => {
				const known = KNOWN_OPENAI_MODELS.find(m => m.id === id);
				return known ?? { id, displayName: id, supportsTools: true };
			});
		} catch {
			return KNOWN_OPENAI_MODELS;
		}
	}
}
