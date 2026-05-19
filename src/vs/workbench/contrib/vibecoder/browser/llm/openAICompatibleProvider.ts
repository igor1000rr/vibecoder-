/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VibecoderProviderId } from '../../common/vibecoder.js';
import {
	IVibecoderLLMProvider,
	VibecoderChatChunk,
	VibecoderChatRequest,
	VibecoderLLMError,
	VibecoderModelInfo,
	VibecoderProviderCapabilities,
} from './llmProvider.js';

/**
 * Базовый класс для OpenAI-совместимых провайдеров.
 *
 * Поддерживает endpoint /chat/completions со стримингом через SSE
 * и /models для списка моделей. LM Studio тоже OpenAI-совместима,
 * но имеет свои особенности (timeout, отсутствие auth), поэтому
 * выделена в отдельный класс LMStudioProvider.
 *
 * Используется для: OpenAI напрямую, OpenRouter, любого совместимого
 * прокси (включая наш vibecoder-proxy для Anthropic/Gemini).
 */
export abstract class OpenAICompatibleProvider implements IVibecoderLLMProvider {
	abstract readonly id: VibecoderProviderId;
	abstract readonly displayName: string;
	abstract readonly capabilities: VibecoderProviderCapabilities;

	constructor(
		protected endpoint: string,
		protected apiKey: string,
		protected extraHeaders: Record<string, string> = {}
	) {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	setEndpoint(endpoint: string): void {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	setApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	protected buildHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${this.apiKey}`,
			...this.extraHeaders,
		};
	}

	/**
	 * Захардкоженный или дефолтный список моделей провайдера.
	 * Конкретные провайдеры переопределяют этот метод.
	 */
	abstract listModels(): Promise<VibecoderModelInfo[]>;

	async checkAvailability(): Promise<{ available: boolean; error?: string }> {
		if (!this.apiKey) {
			return { available: false, error: 'API key не задан' };
		}
		try {
			const response = await fetch(`${this.endpoint}/models`, {
				method: 'GET',
				headers: this.buildHeaders(),
				signal: AbortSignal.timeout(5000),
			});
			if (response.status === 401 || response.status === 403) {
				return { available: false, error: 'Неверный API key' };
			}
			if (!response.ok) {
				return { available: false, error: `HTTP ${response.status}` };
			}
			return { available: true };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { available: false, error: message };
		}
	}

	async *chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk> {
		if (!this.apiKey) {
			yield { type: 'error', error: { message: `${this.displayName}: API key не задан`, code: 'auth' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		const body = {
			model: request.model,
			messages: request.messages,
			temperature: request.temperature ?? 0.7,
			...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
			stream: true,
			...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
		};

		let response: Response;
		try {
			response = await fetch(`${this.endpoint}/chat/completions`, {
				method: 'POST',
				headers: this.buildHeaders(),
				body: JSON.stringify(body),
				signal: request.signal,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: 'error', error: { message: `${this.displayName}: сетевая ошибка: ${message}`, code: 'network' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (response.status === 401 || response.status === 403) {
			const text = await response.text().catch(() => '');
			yield { type: 'error', error: { message: `${this.displayName}: неверный API key (${text})`, code: 'auth' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (response.status === 429) {
			const retryAfter = response.headers.get('retry-after');
			yield { type: 'error', error: { message: `${this.displayName}: rate limit (retry-after: ${retryAfter ?? '?'}s)`, code: 'rate_limit' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			yield { type: 'error', error: { message: `${this.displayName} HTTP ${response.status}: ${text}` } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (!response.body) {
			yield { type: 'error', error: { message: `${this.displayName}: пустой ответ` } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let buffer = '';
		let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';

		// Отслеживаем какие tool_call индексы уже видели — для первой дельты
		// каждого индекса yield'им tool_call_start, для последующих — tool_call_delta.
		// Без этого toolLoop не знает что нужно создать новый pending slot.
		const seenToolIndices = new Set<number>();

		try {
			while (true) {
				if (request.signal?.aborted) {
					yield { type: 'finish', finishReason: 'stop' };
					return;
				}
				const { value, done } = await reader.read();
				if (done) { break; }
				buffer += decoder.decode(value, { stream: true });
				// Нормализуем \r\n → \n (некоторые прокси шлют CRLF)
				buffer = buffer.replace(/\r\n/g, '\n');
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data:')) { continue; }
					const payload = trimmed.slice(5).trim();
					if (payload === '[DONE]') { continue; }

					let parsed: any;
					try {
						parsed = JSON.parse(payload);
					} catch {
						continue;
					}

					const choice = parsed.choices?.[0];
					if (!choice) { continue; }

					if (choice.finish_reason) {
						finishReason = choice.finish_reason;
					}

					const delta = choice.delta;
					if (!delta) { continue; }

					if (typeof delta.content === 'string' && delta.content.length > 0) {
						yield { type: 'text', text: delta.content };
					}

					if (Array.isArray(delta.tool_calls)) {
						for (const tc of delta.tool_calls) {
							// index — позиция tool_call в массиве (OpenAI streaming spec).
							// Если index не пришёл (нестандартный сервер) — fallback 0.
							const index = typeof tc.index === 'number' ? tc.index : 0;
							const isFirstForIndex = !seenToolIndices.has(index);

							if (isFirstForIndex) {
								seenToolIndices.add(index);
								yield {
									type: 'tool_call_start',
									toolCall: {
										id: tc.id,
										type: 'function',
										function: {
											name: tc.function?.name ?? '',
											arguments: tc.function?.arguments ?? '',
										},
									},
								};
							} else {
								yield {
									type: 'tool_call_delta',
									toolCall: {
										id: tc.id,
										type: 'function',
										function: {
											name: tc.function?.name ?? '',
											arguments: tc.function?.arguments ?? '',
										},
									},
								};
							}
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		yield { type: 'finish', finishReason };
	}

	/**
	 * Получить список моделей через /models endpoint (стандарт OpenAI).
	 * Конкретные провайдеры могут переопределить если /models не отдаёт
	 * полезный список.
	 */
	protected async fetchModelsFromEndpoint(): Promise<string[]> {
		const response = await fetch(`${this.endpoint}/models`, {
			method: 'GET',
			headers: this.buildHeaders(),
		});
		if (!response.ok) {
			throw new VibecoderLLMError(
				`${this.displayName}: HTTP ${response.status}`,
				this.id,
				'unavailable'
			);
		}
		const data = await response.json() as { data: Array<{ id: string }> };
		return (data.data ?? []).map(m => m.id);
	}
}
