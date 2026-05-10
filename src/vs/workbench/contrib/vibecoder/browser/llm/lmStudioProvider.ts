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
 * Провайдер LM Studio.
 *
 * LM Studio экспортирует OpenAI-compatible API на http://localhost:1234/v1.
 * Поэтому мы используем стандартный fetch к /chat/completions со стримингом
 * через Server-Sent Events.
 *
 * Документация LM Studio API: https://lmstudio.ai/docs/local-server
 */
export class LMStudioProvider implements IVibecoderLLMProvider {
	readonly id: VibecoderProviderId = 'lmstudio';
	readonly displayName = 'LM Studio (local)';
	readonly capabilities: VibecoderProviderCapabilities = {
		supportsStreaming: true,
		supportsTools: true, // зависит от загруженной модели, но API поддерживает
		supportsVision: false, // некоторые модели умеют, добавим определение позже
		requiresApiKey: false,
		isLocal: true,
	};

	private endpoint: string;

	constructor(endpoint: string = 'http://localhost:1234/v1') {
		// Нормализуем endpoint: убираем trailing slash
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	setEndpoint(endpoint: string): void {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	async checkAvailability(): Promise<{ available: boolean; error?: string }> {
		try {
			const response = await fetch(`${this.endpoint}/models`, {
				method: 'GET',
				signal: AbortSignal.timeout(2000),
			});
			if (!response.ok) {
				return { available: false, error: `HTTP ${response.status}` };
			}
			return { available: true };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { available: false, error: message };
		}
	}

	async listModels(): Promise<VibecoderModelInfo[]> {
		const response = await fetch(`${this.endpoint}/models`, { method: 'GET' });
		if (!response.ok) {
			throw new VibecoderLLMError(
				`Не удалось получить список моделей LM Studio: HTTP ${response.status}`,
				this.id,
				'unavailable'
			);
		}
		const data = await response.json() as { data: Array<{ id: string }> };
		return (data.data ?? []).map(m => ({
			id: m.id,
			displayName: m.id,
			// LM Studio пока не возвращает контекст в /models; узнаётся через /v1/internal/model
			supportsTools: true,
		}));
	}

	async *chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk> {
		const body = {
			model: request.model,
			messages: request.messages,
			temperature: request.temperature ?? 0.7,
			max_tokens: request.maxTokens ?? -1,
			stream: true,
			...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
		};

		let response: Response;
		try {
			response = await fetch(`${this.endpoint}/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: request.signal,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield {
				type: 'error',
				error: { message: `LM Studio недоступна: ${message}` },
			};
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			yield {
				type: 'error',
				error: {
					message: `LM Studio HTTP ${response.status}: ${text}`,
					code: String(response.status),
				},
			};
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (!response.body) {
			yield { type: 'error', error: { message: 'Пустой ответ от LM Studio' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		// Парсим SSE-стрим: строки "data: {json}\n\n", в конце "data: [DONE]"
		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let buffer = '';
		let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';

		try {
			while (true) {
				if (request.signal?.aborted) {
					yield { type: 'finish', finishReason: 'stop' };
					return;
				}
				const { value, done } = await reader.read();
				if (done) {
					break;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? ''; // последняя (возможно неполная) строка возвращается в буфер

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data:')) { continue; }
					const payload = trimmed.slice(5).trim();
					if (payload === '[DONE]') { continue; }

					let parsed: any;
					try {
						parsed = JSON.parse(payload);
					} catch {
						continue; // битый чанк, игнорируем
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
		} finally {
			reader.releaseLock();
		}

		yield { type: 'finish', finishReason };
	}
}
