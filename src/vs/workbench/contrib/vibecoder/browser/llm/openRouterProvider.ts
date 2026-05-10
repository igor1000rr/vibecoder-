/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VibecoderProviderId } from '../../common/vibecoder.js';
import { VibecoderModelInfo, VibecoderProviderCapabilities } from './llmProvider.js';
import { OpenAICompatibleProvider } from './openAICompatibleProvider.js';

/**
 * OpenRouter - агрегатор LLM-провайдеров с единым OpenAI-совместимым API.
 * Один API-ключ - доступ к десяткам моделей (Claude, GPT, Gemini, Llama, и т.д.).
 *
 * https://openrouter.ai/docs
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
	readonly id: VibecoderProviderId = 'openrouter';
	readonly displayName = 'OpenRouter';
	readonly capabilities: VibecoderProviderCapabilities = {
		supportsStreaming: true,
		supportsTools: true,
		supportsVision: true,
		requiresApiKey: true,
		isLocal: false,
	};

	constructor(apiKey: string = '', endpoint: string = 'https://openrouter.ai/api/v1') {
		super(endpoint, apiKey, {
			// OpenRouter рекомендует ставить эти заголовки для аналитики
			'HTTP-Referer': 'https://github.com/igor1000rr/vibecoder-',
			'X-Title': 'Vibecoder',
		});
	}

	async listModels(): Promise<VibecoderModelInfo[]> {
		// OpenRouter возвращает богатый список с метаданными
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
					name: string;
					context_length?: number;
					architecture?: { input_modalities?: string[] };
					supported_parameters?: string[];
				}>;
			};
			return (data.data ?? []).map(m => ({
				id: m.id,
				displayName: m.name ?? m.id,
				contextWindow: m.context_length,
				supportsTools: m.supported_parameters?.includes('tools') ?? true,
				supportsVision: m.architecture?.input_modalities?.includes('image') ?? false,
			}));
		} catch {
			return this.getFallbackModels();
		}
	}

	private getFallbackModels(): VibecoderModelInfo[] {
		return [
			{ id: 'anthropic/claude-opus-4.7', displayName: 'Claude Opus 4.7', contextWindow: 200_000, supportsTools: true, supportsVision: true },
			{ id: 'anthropic/claude-sonnet-4.6', displayName: 'Claude Sonnet 4.6', contextWindow: 200_000, supportsTools: true, supportsVision: true },
			{ id: 'openai/gpt-5', displayName: 'GPT-5', contextWindow: 200_000, supportsTools: true, supportsVision: true },
			{ id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 2_000_000, supportsTools: true, supportsVision: true },
			{ id: 'qwen/qwen-3-coder-30b-a3b', displayName: 'Qwen 3 Coder 30B-A3B', contextWindow: 256_000, supportsTools: true },
		];
	}
}
