/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { VibecoderProviderId } from '../../common/vibecoder.js';
import {
	IVibecoderLLMProvider,
	VibecoderChatChunk,
	VibecoderChatRequest,
	VibecoderLLMError,
	VibecoderModelInfo,
} from './llmProvider.js';
import { LMStudioProvider } from './lmStudioProvider.js';

export const IVibecoderLLMRouter = createDecorator<IVibecoderLLMRouter>('vibecoderLLMRouter');

/**
 * Центральный сервис, через который весь Vibecoder-код общается с LLM-провайдерами.
 *
 * Отвечает за:
 *   - регистрацию провайдеров (LM Studio, Anthropic, OpenAI, Gemini, OpenRouter)
 *   - выбор активного провайдера/модели по конфигурации или явному hint'у
 *   - роутинг запросов в нужный провайдер
 *   - агрегацию метаданных (доступность, список моделей)
 */
export interface IVibecoderLLMRouter {
	readonly _serviceBrand: undefined;

	getProvider(id: VibecoderProviderId): IVibecoderLLMProvider | undefined;
	getAllProviders(): readonly IVibecoderLLMProvider[];
	getAvailableProviders(): Promise<readonly IVibecoderLLMProvider[]>;
	listAllModels(): Promise<Array<{ provider: VibecoderProviderId; model: VibecoderModelInfo }>>;
	chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk>;
}

/**
 * Реализация LLM-роутера.
 *
 * При создании регистрирует только LM Studio. Остальные провайдеры
 * (Anthropic, OpenAI, Gemini, OpenRouter) будут добавлены отдельно,
 * по мере реализации.
 */
export class VibecoderLLMRouter extends Disposable implements IVibecoderLLMRouter {
	readonly _serviceBrand: undefined;

	private readonly providers = new Map<VibecoderProviderId, IVibecoderLLMProvider>();

	constructor() {
		super();
		// MVP: только LM Studio. Остальные провайдеры будут добавлены позже.
		this.registerProvider(new LMStudioProvider());
	}

	registerProvider(provider: IVibecoderLLMProvider): void {
		this.providers.set(provider.id, provider);
	}

	getProvider(id: VibecoderProviderId): IVibecoderLLMProvider | undefined {
		return this.providers.get(id);
	}

	getAllProviders(): readonly IVibecoderLLMProvider[] {
		return Array.from(this.providers.values());
	}

	async getAvailableProviders(): Promise<readonly IVibecoderLLMProvider[]> {
		const checks = await Promise.all(
			this.getAllProviders().map(async p => ({
				provider: p,
				result: await p.checkAvailability(),
			}))
		);
		return checks.filter(c => c.result.available).map(c => c.provider);
	}

	async listAllModels(): Promise<Array<{ provider: VibecoderProviderId; model: VibecoderModelInfo }>> {
		const out: Array<{ provider: VibecoderProviderId; model: VibecoderModelInfo }> = [];
		for (const p of this.getAllProviders()) {
			try {
				const models = await p.listModels();
				for (const m of models) {
					out.push({ provider: p.id, model: m });
				}
			} catch {
				// провайдер недоступен - пропускаем
			}
		}
		return out;
	}

	chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk> {
		const providerId = request.providerHint ?? 'lmstudio';
		const provider = this.providers.get(providerId);
		if (!provider) {
			throw new VibecoderLLMError(
				`Провайдер '${providerId}' не зарегистрирован`,
				providerId,
				'invalid_request'
			);
		}
		return provider.chat(request);
	}
}
