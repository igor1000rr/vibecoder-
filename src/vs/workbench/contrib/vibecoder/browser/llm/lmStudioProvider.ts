/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VibecoderProviderId } from '../../common/vibecoder.js';
import {
	IVibecoderLLMProvider,
	VibecoderAvailabilityResult,
	VibecoderChatChunk,
	VibecoderChatRequest,
	VibecoderLLMError,
	VibecoderModelInfo,
	VibecoderProviderCapabilities,
} from './llmProvider.js';

/**
 * Провайдер LM Studio.
 *
 * LM Studio экспортирует OpenAI-совместимый API на http://localhost:1234/v1.
 * Используем fetch к /chat/completions со стримингом через SSE.
 *
 * Документация LM Studio API: https://lmstudio.ai/docs/local-server
 *
 * Типичные проблемы и как мы их обрабатываем:
 *  - Local Server выключен → ECONNREFUSED → подсказываем включить
 *  - Нет загруженных моделей → пустой массив /models → подсказываем загрузить
 *  - Модель ещё грузится → 503 / timeout → говорим подождать
 *  - CORS (Electron renderer) → обычно не возникает на localhost
 */
export class LMStudioProvider implements IVibecoderLLMProvider {
	readonly id: VibecoderProviderId = 'lmstudio';
	readonly displayName = 'LM Studio (local)';
	readonly capabilities: VibecoderProviderCapabilities = {
		supportsStreaming: true,
		supportsTools: true,
		supportsVision: false,
		requiresApiKey: false,
		isLocal: true,
	};

	private endpoint: string;

	constructor(endpoint: string = 'http://localhost:1234/v1') {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	getEndpoint(): string {
		return this.endpoint;
	}

	setEndpoint(endpoint: string): void {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	/**
	 * Превращает технические ошибки fetch в понятные подсказки.
	 */
	private explainError(e: unknown): string {
		const message = e instanceof Error ? e.message : String(e);
		const lower = message.toLowerCase();
		if (lower.includes('failed to fetch') || lower.includes('econnrefused') || lower.includes('refused')) {
			return `LM Studio не отвечает на ${this.endpoint}. Проверь: 1) запущена ли LM Studio, 2) включён ли Local Server (Developer → Start Server).`;
		}
		if (lower.includes('timeout') || lower.includes('aborted')) {
			return `Тайм-аут подключения к LM Studio. Модель может ещё грузиться — подожди и попробуй снова.`;
		}
		if (lower.includes('cors')) {
			return `CORS ошибка при подключении к LM Studio. Это редкость для localhost — открой Settings LM Studio и включи "Cross-Origin Resource Sharing".`;
		}
		return message;
	}

	async checkAvailability(): Promise<VibecoderAvailabilityResult> {
		try {
			const response = await fetch(`${this.endpoint}/models`, {
				method: 'GET',
				signal: AbortSignal.timeout(3000),
			});
			if (!response.ok) {
				return { available: false, error: `HTTP ${response.status}`, endpoint: this.endpoint };
			}
			return { available: true, endpoint: this.endpoint };
		} catch (e) {
			return { available: false, error: this.explainError(e), endpoint: this.endpoint };
		}
	}

	async listModels(): Promise<VibecoderModelInfo[]> {
		let response: Response;
		try {
			response = await fetch(`${this.endpoint}/models`, {
				method: 'GET',
				signal: AbortSignal.timeout(5000),
			});
		} catch (e) {
			throw new VibecoderLLMError(this.explainError(e), this.id, 'unavailable');
		}

		if (!response.ok) {
			throw new VibecoderLLMError(
				`LM Studio ответила HTTP ${response.status} на запрос моделей.`,
				this.id,
				'unavailable'
			);
		}
		const data = await response.json() as { data: Array<{ id: string }> };
		const models = (data.data ?? []).map(m => ({
			id: m.id,
			displayName: m.id,
			supportsTools: true,
		}));
		if (models.length === 0) {
			console.warn('[Vibecoder][LMStudio] /models вернул пустой список. Загрузи модель в LM Studio.');
		}
		return models;
	}

	async *chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk> {
		// Сборка body. ВАЖНО:
		//  - temperature 0.3 как дефолт для кода (низкая стохастика = меньше галлюцинаций)
		//  - max_tokens НЕ ставим (некоторые модели падают на -1)
		const body: Record<string, unknown> = {
			model: request.model,
			messages: request.messages,
			temperature: request.temperature ?? 0.3,
			stream: true,
		};
		if (request.maxTokens && request.maxTokens > 0) {
			body.max_tokens = request.maxTokens;
		}
		if (request.tools && request.tools.length > 0) {
			body.tools = request.tools;
		}

		let response: Response;
		try {
			response = await fetch(`${this.endpoint}/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: request.signal,
			});
		} catch (e) {
			yield {
				type: 'error',
				error: { message: this.explainError(e) },
			};
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			let parsedError = text;
			try {
				const errObj = JSON.parse(text);
				parsedError = errObj?.error?.message ?? errObj?.message ?? text;
			} catch { /* not JSON */ }
			yield {
				type: 'error',
				error: {
					message: `LM Studio HTTP ${response.status}: ${parsedError || '(нет тела ответа)'}`,
					code: String(response.status),
				},
			};
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (!response.body) {
			yield { type: 'error', error: { message: 'LM Studio вернула пустой response.body — это не должно происходить, попробуй ещё раз.' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		// Парсим SSE-стрим. Формат: каждая строка вида "data: {json}\n", в конце "data: [DONE]"
		// Поддерживаем и \r\n и \n.
		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let buffer = '';
		let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';

		// Отслеживаем какие tool_call индексы уже видели — для первой дельты
		// каждого индекса yield'им tool_call_start, для последующих — tool_call_delta.
		// Без этого toolLoop не знает что нужно создать новый pending slot, и все
		// аргументы tool_call'а уходят в /dev/null (баг #1: LM Studio + gemma вроде
		// бы "не вызывала tools", а на деле вызывала — мы их теряли).
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
				// Нормализуем \r\n → \n для единого разделения
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
						console.warn('[Vibecoder][LMStudio] не смог распарсить SSE-чанк:', payload.slice(0, 200));
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
}
