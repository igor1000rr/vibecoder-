/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VibecoderProviderId } from '../../common/vibecoder.js';
import {
	IVibecoderLLMProvider,
	VibecoderChatChunk,
	VibecoderChatMessage,
	VibecoderChatRequest,
	VibecoderModelInfo,
	VibecoderProviderCapabilities,
	VibecoderTool,
} from './llmProvider.js';

/**
 * Известные модели Anthropic (на ~май 2026).
 */
const KNOWN_ANTHROPIC_MODELS: VibecoderModelInfo[] = [
	{ id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', contextWindow: 200_000, supportsTools: true, supportsVision: true },
	{ id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', contextWindow: 200_000, supportsTools: true, supportsVision: true },
	{ id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', contextWindow: 200_000, supportsTools: true, supportsVision: true },
	{ id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', contextWindow: 200_000, supportsTools: true, supportsVision: true },
];

/**
 * Anthropic Messages API provider.
 *
 * API: https://docs.claude.com/en/api/messages
 *
 * Главные отличия от OpenAI:
 *   - endpoint /v1/messages (а не /chat/completions)
 *   - системное сообщение - отдельное поле "system", не в messages
 *   - формат content: либо строка, либо массив content blocks
 *   - стриминг: event_stream c события message_start, content_block_start,
 *              content_block_delta, content_block_stop, message_delta, message_stop
 *   - tool use: type=tool_use в content blocks, не tool_calls
 *   - заголовок anthropic-version обязателен
 *
 * Может работать как напрямую (https://api.anthropic.com), так и через
 * прокси (https://proxy.vibecoder.dev), который форвардит запросы и решает
 * CORS-проблему для пользователей из санкционных регионов.
 */
export class AnthropicProvider implements IVibecoderLLMProvider {
	readonly id: VibecoderProviderId = 'anthropic';
	readonly displayName = 'Anthropic';
	readonly capabilities: VibecoderProviderCapabilities = {
		supportsStreaming: true,
		supportsTools: true,
		supportsVision: true,
		requiresApiKey: true,
		isLocal: false,
	};

	private endpoint: string;
	private apiKey: string;
	private anthropicVersion = '2023-06-01';

	constructor(apiKey: string = '', endpoint: string = 'https://api.anthropic.com') {
		this.endpoint = endpoint.replace(/\/$/, '');
		this.apiKey = apiKey;
	}

	setEndpoint(endpoint: string): void {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	setApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	private buildHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'x-api-key': this.apiKey,
			'anthropic-version': this.anthropicVersion,
			// Если ходим напрямую из браузера, нужен dangerous direct-browser-access.
			// Через прокси этот заголовок безопасно игнорируется.
			'anthropic-dangerous-direct-browser-access': 'true',
		};
	}

	async checkAvailability(): Promise<{ available: boolean; error?: string }> {
		if (!this.apiKey) {
			return { available: false, error: 'API key не задан' };
		}
		// У Anthropic нет /models endpoint, поэтому делаем минимальный запрос.
		// 1 токен ответа - дешевле всего.
		try {
			const response = await fetch(`${this.endpoint}/v1/messages`, {
				method: 'POST',
				headers: this.buildHeaders(),
				body: JSON.stringify({
					model: 'claude-haiku-4-5-20251001',
					max_tokens: 1,
					messages: [{ role: 'user', content: 'hi' }],
				}),
				signal: AbortSignal.timeout(8000),
			});
			if (response.status === 401 || response.status === 403) {
				return { available: false, error: 'Неверный API key' };
			}
			if (!response.ok && response.status !== 200) {
				return { available: false, error: `HTTP ${response.status}` };
			}
			return { available: true };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { available: false, error: message };
		}
	}

	async listModels(): Promise<VibecoderModelInfo[]> {
		// У Anthropic есть /v1/models, проверим
		try {
			const response = await fetch(`${this.endpoint}/v1/models`, {
				method: 'GET',
				headers: this.buildHeaders(),
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				return KNOWN_ANTHROPIC_MODELS;
			}
			const data = await response.json() as { data: Array<{ id: string; display_name?: string }> };
			if (!data.data || data.data.length === 0) {
				return KNOWN_ANTHROPIC_MODELS;
			}
			return data.data.map(m => {
				const known = KNOWN_ANTHROPIC_MODELS.find(k => k.id === m.id);
				return known ?? {
					id: m.id,
					displayName: m.display_name ?? m.id,
					contextWindow: 200_000,
					supportsTools: true,
					supportsVision: true,
				};
			});
		} catch {
			return KNOWN_ANTHROPIC_MODELS;
		}
	}

	/**
	 * Конвертирует OpenAI-style messages в Anthropic-style body.
	 * - role=system -> отдельное поле "system"
	 * - role=tool -> content block type=tool_result
	 * - tool_calls в assistant -> content blocks type=tool_use
	 */
	private convertMessages(messages: VibecoderChatMessage[]): {
		system: string | undefined;
		messages: Array<{ role: 'user' | 'assistant'; content: any }>;
	} {
		let system: string | undefined;
		const out: Array<{ role: 'user' | 'assistant'; content: any }> = [];

		for (const msg of messages) {
			if (msg.role === 'system') {
				system = system ? `${system}\n\n${msg.content}` : msg.content;
				continue;
			}
			if (msg.role === 'tool') {
				// tool result - идёт в user message как content block
				out.push({
					role: 'user',
					content: [{
						type: 'tool_result',
						tool_use_id: msg.tool_call_id ?? '',
						content: msg.content,
					}],
				});
				continue;
			}
			if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
				const blocks: any[] = [];
				if (msg.content) {
					blocks.push({ type: 'text', text: msg.content });
				}
				for (const tc of msg.tool_calls) {
					let parsed: any = {};
					try { parsed = JSON.parse(tc.function.arguments); } catch { /* leave empty */ }
					blocks.push({
						type: 'tool_use',
						id: tc.id,
						name: tc.function.name,
						input: parsed,
					});
				}
				out.push({ role: 'assistant', content: blocks });
				continue;
			}
			// обычное user/assistant сообщение
			out.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
		}

		return { system, messages: out };
	}

	private convertTools(tools: VibecoderTool[] | undefined): any[] | undefined {
		if (!tools || tools.length === 0) { return undefined; }
		return tools.map(t => ({
			name: t.function.name,
			description: t.function.description,
			input_schema: t.function.parameters,
		}));
	}

	async *chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk> {
		if (!this.apiKey) {
			yield { type: 'error', error: { message: 'Anthropic: API key не задан', code: 'auth' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		const { system, messages } = this.convertMessages(request.messages);
		const tools = this.convertTools(request.tools);

		const body: any = {
			model: request.model,
			max_tokens: request.maxTokens ?? 4096,
			messages,
			stream: true,
			...(system ? { system } : {}),
			...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
			...(tools ? { tools } : {}),
		};

		let response: Response;
		try {
			response = await fetch(`${this.endpoint}/v1/messages`, {
				method: 'POST',
				headers: this.buildHeaders(),
				body: JSON.stringify(body),
				signal: request.signal,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: 'error', error: { message: `Anthropic: сетевая ошибка: ${message}`, code: 'network' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (response.status === 401 || response.status === 403) {
			yield { type: 'error', error: { message: 'Anthropic: неверный API key', code: 'auth' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}
		if (response.status === 429) {
			const retryAfter = response.headers.get('retry-after');
			yield { type: 'error', error: { message: `Anthropic: rate limit (retry-after: ${retryAfter ?? '?'}s)`, code: 'rate_limit' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			yield { type: 'error', error: { message: `Anthropic HTTP ${response.status}: ${text}` } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}
		if (!response.body) {
			yield { type: 'error', error: { message: 'Anthropic: пустой ответ' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		// Anthropic SSE: события с разными типами
		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let buffer = '';
		let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
		// Активные tool_use блоки по index → ID
		const activeToolUses = new Map<number, { id: string; name: string }>();

		try {
			while (true) {
				if (request.signal?.aborted) {
					yield { type: 'finish', finishReason: 'stop' };
					return;
				}
				const { value, done } = await reader.read();
				if (done) { break; }
				buffer += decoder.decode(value, { stream: true });
				const events = buffer.split('\n\n');
				buffer = events.pop() ?? '';

				for (const event of events) {
					// Каждое событие: "event: <type>\ndata: <json>"
					const dataLine = event.split('\n').find(l => l.startsWith('data:'));
					if (!dataLine) { continue; }
					const payload = dataLine.slice(5).trim();
					if (!payload) { continue; }

					let parsed: any;
					try {
						parsed = JSON.parse(payload);
					} catch {
						continue;
					}

					switch (parsed.type) {
						case 'content_block_start': {
							const block = parsed.content_block;
							if (block?.type === 'tool_use') {
								activeToolUses.set(parsed.index, { id: block.id, name: block.name });
								yield {
									type: 'tool_call_start',
									toolCall: {
										id: block.id,
										type: 'function',
										function: { name: block.name, arguments: '' },
									},
								};
							}
							break;
						}
						case 'content_block_delta': {
							const delta = parsed.delta;
							if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
								yield { type: 'text', text: delta.text };
							} else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
								const active = activeToolUses.get(parsed.index);
								if (active) {
									yield {
										type: 'tool_call_delta',
										toolCall: {
											id: active.id,
											type: 'function',
											function: { name: active.name, arguments: delta.partial_json },
										},
									};
								}
							}
							break;
						}
						case 'message_delta': {
							const reason = parsed.delta?.stop_reason;
							if (reason === 'end_turn' || reason === 'stop_sequence') {
								finishReason = 'stop';
							} else if (reason === 'max_tokens') {
								finishReason = 'length';
							} else if (reason === 'tool_use') {
								finishReason = 'tool_calls';
							}
							break;
						}
						case 'message_stop':
							// финал — обработаем после цикла
							break;
						case 'error': {
							yield { type: 'error', error: { message: parsed.error?.message ?? 'Anthropic stream error' } };
							finishReason = 'error';
							break;
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
