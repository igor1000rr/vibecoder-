/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VibecoderProviderId } from '../../common/vibecoder.js';
import { VibecoderModelInfo, VibecoderProviderCapabilities } from './llmProvider.js';
import { OpenAICompatibleProvider } from './openAICompatibleProvider.js';

/**
 * Polza.ai — российский OpenAI-compatible агрегатор LLM-моделей.
 * Один API-ключ — доступ к моделям OpenAI, Anthropic, Google, YandexGPT, GigaChat и др.
 * Работает без VPN из РФ/РБ.
 *
 * https://polza.ai/
 * API: https://api.polza.ai/api/v1 (OpenAI-compatible, Bearer auth)
 */
export class PolzaProvider extends OpenAICompatibleProvider {
	readonly id: VibecoderProviderId = 'polza';
	readonly displayName = 'Polza.ai';
	readonly capabilities: VibecoderProviderCapabilities = {
		supportsStreaming: true,
		supportsTools: true,
		supportsVision: true,
		requiresApiKey: true,
		isLocal: false,
	};

	constructor(apiKey: string = '', endpoint: string = 'https://api.polza.ai/api/v1') {
		super(endpoint, apiKey, {
			// Аналитические заголовки — необязательны для polza.ai, но полезны для идентификации клиента
			'X-Title': 'Vibecoder',
		});
	}

	async listModels(): Promise<VibecoderModelInfo[]> {
		// Polza.ai OpenAI-compatible: GET /models возвращает { data: [{ id, ... }] }
		try {
			const response = await fetch(`${this.endpoint}/models`, {
				method: 'GET',
				headers: this.buildHeaders(),
			});
			if (!response.ok) {
				return this.getFallbackModels();
			}
			const data = await response.json() as {
				data: Array<{
					id: string;
					name?: string;
					context_length?: number;
					context_window?: number;
				}>;
			};
			const models = data.data ?? [];
			if (models.length === 0) {
				return this.getFallbackModels();
			}
			return models.map(m => ({
				id: m.id,
				displayName: m.name ?? m.id,
				contextWindow: m.context_length ?? m.context_window,
				supportsTools: true,
				supportsVision: false,
			}));
		} catch {
			return this.getFallbackModels();
		}
	}

	/**
	 * Fallback-список если API временно не отвечает или ключ ещё не задан.
	 * Реальный набор моделей подтянется при следующем listModels() с ключом.
	 */
	private getFallbackModels(): VibecoderModelInfo[] {
		return [
			{ id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128_000, supportsTools: true, supportsVision: true },
			{ id: 'gpt-4o-mini', displayName: 'GPT-4o mini', contextWindow: 128_000, supportsTools: true },
			{ id: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet', contextWindow: 200_000, supportsTools: true, supportsVision: true },
			{ id: 'claude-3-5-haiku', displayName: 'Claude 3.5 Haiku', contextWindow: 200_000, supportsTools: true },
			{ id: 'deepseek-chat', displayName: 'DeepSeek Chat', contextWindow: 64_000, supportsTools: true },
			{ id: 'deepseek-coder', displayName: 'DeepSeek Coder', contextWindow: 64_000, supportsTools: true },
		];
	}
}
