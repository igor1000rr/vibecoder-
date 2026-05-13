/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { VibecoderConfigKeys, VIBECODER_POLZA_DEFAULT_URL, VibecoderProviderId } from '../../common/vibecoder.js';
import {
	IVibecoderLLMProvider,
	VibecoderChatChunk,
	VibecoderChatRequest,
	VibecoderLLMError,
	VibecoderModelInfo,
} from './llmProvider.js';
import { LMStudioProvider } from './lmStudioProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { OpenAIProvider } from './openAIProvider.js';
import { GeminiProvider } from './geminiProvider.js';
import { OpenRouterProvider } from './openRouterProvider.js';
import { PolzaProvider } from './polzaProvider.js';

export const IVibecoderLLMRouter = createDecorator<IVibecoderLLMRouter>('vibecoderLLMRouter');

/**
 * Центральный сервис, через который весь Vibecoder-код общается с LLM-провайдерами.
 *
 * Отвечает за:
 *   - регистрацию провайдеров (LM Studio, Anthropic, OpenAI, Gemini, OpenRouter, Polza.ai)
 *   - подгрузку API-ключей из SecretStorage
 *   - применение режима прокси (direct / vibecoder / custom URL) для облачных провайдеров
 *   - выбор активного провайдера/модели по конфигурации или явному hint'у
 *   - роутинг запросов
 */
export interface IVibecoderLLMRouter {
	readonly _serviceBrand: undefined;

	getProvider(id: VibecoderProviderId): IVibecoderLLMProvider | undefined;
	getAllProviders(): readonly IVibecoderLLMProvider[];
	getAvailableProviders(): Promise<readonly IVibecoderLLMProvider[]>;
	listAllModels(): Promise<Array<{ provider: VibecoderProviderId; model: VibecoderModelInfo }>>;
	chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk>;

	/** Установить API-ключ для провайдера и сохранить в SecretStorage */
	setApiKey(providerId: VibecoderProviderId, apiKey: string): Promise<void>;

	/** Получить API-ключ из SecretStorage (или undefined) */
	getApiKey(providerId: VibecoderProviderId): Promise<string | undefined>;

	/** Удалить API-ключ */
	deleteApiKey(providerId: VibecoderProviderId): Promise<void>;
}

/**
 * Ключ для хранения API-key провайдера в SecretStorage.
 */
function secretKey(providerId: VibecoderProviderId): string {
	return `vibecoder.apiKey.${providerId}`;
}

/** Режим прокси: direct (напрямую в провайдера), vibecoder (через proxy.vibecoder.dev), custom URL */
type ProxyMode = 'direct' | 'vibecoder' | 'custom';

const VIBECODER_PROXY_URL = 'https://proxy.vibecoder.dev';

export class VibecoderLLMRouter extends Disposable implements IVibecoderLLMRouter {
	readonly _serviceBrand: undefined;

	private readonly providers = new Map<VibecoderProviderId, IVibecoderLLMProvider>();

	constructor(
		@ISecretStorageService private readonly secretStorage: ISecretStorageService,
		@IConfigurationService private readonly configService: IConfigurationService,
	) {
		super();

		// Зарегистрировать всех провайдеров с дефолтными endpoint.
		// Endpoint и API-ключи подгрузим асинхронно ниже.
		this.providers.set('lmstudio', new LMStudioProvider());
		this.providers.set('anthropic', new AnthropicProvider());
		this.providers.set('openai', new OpenAIProvider());
		this.providers.set('gemini', new GeminiProvider());
		this.providers.set('openrouter', new OpenRouterProvider());
		this.providers.set('polza', new PolzaProvider());

		// Применить текущую конфигурацию (proxy mode + LM Studio endpoint + API keys)
		this.reconfigure().catch(err => console.error('[Vibecoder] reconfigure failed:', err));

		// Подписаться на изменения конфигурации
		this._register(this.configService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(VibecoderConfigKeys.ProxyMode) ||
				e.affectsConfiguration(VibecoderConfigKeys.ProxyCustomUrl) ||
				e.affectsConfiguration(VibecoderConfigKeys.LmStudioEndpoint) ||
				e.affectsConfiguration(VibecoderConfigKeys.PolzaEndpoint)
			) {
				this.reconfigure().catch(err => console.error('[Vibecoder] reconfigure failed:', err));
			}
		}));
	}

	/**
	 * Применяет настройки прокси и endpoint'ов ко всем провайдерам.
	 * Также подтягивает API-ключи из SecretStorage.
	 *
	 * Polza.ai — российский, его не нужно гнать через proxy.vibecoder.dev,
	 * он доступен напрямую из РФ/РБ. Поэтому proxyBase к нему НЕ применяется.
	 */
	private async reconfigure(): Promise<void> {
		const proxyMode = this.configService.getValue<ProxyMode>(VibecoderConfigKeys.ProxyMode) ?? 'direct';
		const customProxyUrl = this.configService.getValue<string>(VibecoderConfigKeys.ProxyCustomUrl);
		const lmStudioEndpoint = this.configService.getValue<string>(VibecoderConfigKeys.LmStudioEndpoint) ?? 'http://localhost:1234/v1';
		const polzaEndpoint = this.configService.getValue<string>(VibecoderConfigKeys.PolzaEndpoint) ?? VIBECODER_POLZA_DEFAULT_URL;

		// LM Studio - всегда напрямую (она же локальная)
		const lmstudio = this.providers.get('lmstudio') as LMStudioProvider | undefined;
		lmstudio?.setEndpoint(lmStudioEndpoint);

		// Polza.ai - всегда напрямую (российский, не нуждается в proxy)
		const polza = this.providers.get('polza') as PolzaProvider | undefined;
		polza?.setEndpoint(polzaEndpoint);

		// Облачные провайдеры (Anthropic / OpenAI / Gemini / OpenRouter): применяем proxy mode
		const proxyBase = proxyMode === 'direct'
			? null
			: proxyMode === 'custom'
				? (customProxyUrl?.replace(/\/$/, '') ?? null)
				: VIBECODER_PROXY_URL;

		const anthropic = this.providers.get('anthropic') as AnthropicProvider | undefined;
		anthropic?.setEndpoint(proxyBase ? `${proxyBase}/anthropic` : 'https://api.anthropic.com');

		const openai = this.providers.get('openai') as OpenAIProvider | undefined;
		openai?.setEndpoint(proxyBase ? `${proxyBase}/openai/v1` : 'https://api.openai.com/v1');

		const gemini = this.providers.get('gemini') as GeminiProvider | undefined;
		gemini?.setEndpoint(proxyBase ? `${proxyBase}/gemini` : 'https://generativelanguage.googleapis.com');

		const openrouter = this.providers.get('openrouter') as OpenRouterProvider | undefined;
		openrouter?.setEndpoint(proxyBase ? `${proxyBase}/openrouter/v1` : 'https://openrouter.ai/api/v1');

		// Подгрузить API-ключи параллельно
		await Promise.all((['anthropic', 'openai', 'gemini', 'openrouter', 'polza'] as const).map(async id => {
			const key = await this.getApiKey(id);
			if (key) {
				const provider = this.providers.get(id) as any;
				if (provider && typeof provider.setApiKey === 'function') {
					provider.setApiKey(key);
				}
			}
		}));
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

	async setApiKey(providerId: VibecoderProviderId, apiKey: string): Promise<void> {
		await this.secretStorage.set(secretKey(providerId), apiKey);
		// Сразу применить к live-провайдеру
		const provider = this.providers.get(providerId) as any;
		if (provider && typeof provider.setApiKey === 'function') {
			provider.setApiKey(apiKey);
		}
	}

	async getApiKey(providerId: VibecoderProviderId): Promise<string | undefined> {
		const val = await this.secretStorage.get(secretKey(providerId));
		return val || undefined;
	}

	async deleteApiKey(providerId: VibecoderProviderId): Promise<void> {
		await this.secretStorage.delete(secretKey(providerId));
		const provider = this.providers.get(providerId) as any;
		if (provider && typeof provider.setApiKey === 'function') {
			provider.setApiKey('');
		}
	}
}
