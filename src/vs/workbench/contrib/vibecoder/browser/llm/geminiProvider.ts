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

const KNOWN_GEMINI_MODELS: VibecoderModelInfo[] = [
	{ id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 2_000_000, supportsTools: true, supportsVision: true },
	{ id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', contextWindow: 1_000_000, supportsTools: true, supportsVision: true },
	{ id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextWindow: 1_000_000, supportsTools: true, supportsVision: true },
];

/**
 * Google Gemini provider через Generative Language API.
 *
 * https://ai.google.dev/api/rest
 *
 * Особенности формата:
 *   - endpoint: /v1beta/models/{model}:streamGenerateContent?alt=sse
 *   - messages → contents с role=user/model и parts: [{text}]
 *   - system instruction отдельным полем systemInstruction
 *   - tools: functionDeclarations
 *   - SSE: события прямо как JSON в data:, без отдельных типов событий
 */
export class GeminiProvider implements IVibecoderLLMProvider {
	readonly id: VibecoderProviderId = 'gemini';
	readonly displayName = 'Google Gemini';
	readonly capabilities: VibecoderProviderCapabilities = {
		supportsStreaming: true,
		supportsTools: true,
		supportsVision: true,
		requiresApiKey: true,
		isLocal: false,
	};

	private endpoint: string;
	private apiKey: string;

	constructor(apiKey: string = '', endpoint: string = 'https://generativelanguage.googleapis.com') {
		this.endpoint = endpoint.replace(/\/$/, '');
		this.apiKey = apiKey;
	}

	setEndpoint(endpoint: string): void {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	setApiKey(apiKey: string): void {
		this.apiKey = apiKey;
	}

	async checkAvailability(): Promise<{ available: boolean; error?: string }> {
		if (!this.apiKey) {
			return { available: false, error: 'API key не задан' };
		}
		try {
			const response = await fetch(
				`${this.endpoint}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`,
				{ method: 'GET', signal: AbortSignal.timeout(5000) }
			);
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

	async listModels(): Promise<VibecoderModelInfo[]> {
		try {
			const response = await fetch(
				`${this.endpoint}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`,
				{ method: 'GET', signal: AbortSignal.timeout(5000) }
			);
			if (!response.ok) { return KNOWN_GEMINI_MODELS; }
			const data = await response.json() as {
				models: Array<{
					name: string;
					displayName?: string;
					inputTokenLimit?: number;
					supportedGenerationMethods?: string[];
				}>;
			};
			const filtered = (data.models ?? []).filter(m =>
				m.supportedGenerationMethods?.includes('generateContent')
				&& !m.name.includes('embedding')
				&& !m.name.includes('aqa')
			);
			if (filtered.length === 0) { return KNOWN_GEMINI_MODELS; }
			return filtered.map(m => {
				const id = m.name.replace(/^models\//, '');
				const known = KNOWN_GEMINI_MODELS.find(k => k.id === id);
				return known ?? {
					id,
					displayName: m.displayName ?? id,
					contextWindow: m.inputTokenLimit,
					supportsTools: true,
					supportsVision: true,
				};
			});
		} catch {
			return KNOWN_GEMINI_MODELS;
		}
	}

	private convertMessages(messages: VibecoderChatMessage[]): {
		systemInstruction?: { parts: Array<{ text: string }> };
		contents: Array<{ role: 'user' | 'model'; parts: any[] }>;
	} {
		let systemText = '';
		const contents: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

		for (const msg of messages) {
			if (msg.role === 'system') {
				systemText = systemText ? `${systemText}\n\n${msg.content}` : msg.content;
				continue;
			}
			if (msg.role === 'tool') {
				contents.push({
					role: 'user',
					parts: [{
						functionResponse: {
							name: msg.tool_call_id ?? 'unknown',
							response: { result: msg.content },
						},
					}],
				});
				continue;
			}
			if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
				const parts: any[] = [];
				if (msg.content) { parts.push({ text: msg.content }); }
				for (const tc of msg.tool_calls) {
					let args: any = {};
					try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
					parts.push({
						functionCall: {
							name: tc.function.name,
							args,
						},
					});
				}
				contents.push({ role: 'model', parts });
				continue;
			}
			contents.push({
				role: msg.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: msg.content }],
			});
		}

		return {
			systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
			contents,
		};
	}

	private convertTools(tools: VibecoderTool[] | undefined): any[] | undefined {
		if (!tools || tools.length === 0) { return undefined; }
		return [{
			functionDeclarations: tools.map(t => ({
				name: t.function.name,
				description: t.function.description,
				parameters: t.function.parameters,
			})),
		}];
	}

	async *chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk> {
		if (!this.apiKey) {
			yield { type: 'error', error: { message: 'Gemini: API key не задан', code: 'auth' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		const { systemInstruction, contents } = this.convertMessages(request.messages);
		const tools = this.convertTools(request.tools);
		const generationConfig: any = {};
		if (typeof request.temperature === 'number') { generationConfig.temperature = request.temperature; }
		if (request.maxTokens) { generationConfig.maxOutputTokens = request.maxTokens; }

		const body: any = {
			contents,
			...(systemInstruction ? { systemInstruction } : {}),
			...(tools ? { tools } : {}),
			...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
		};

		const url = `${this.endpoint}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

		let response: Response;
		try {
			response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: request.signal,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: 'error', error: { message: `Gemini: сетевая ошибка: ${message}`, code: 'network' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		if (response.status === 401 || response.status === 403) {
			yield { type: 'error', error: { message: 'Gemini: неверный API key', code: 'auth' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}
		if (response.status === 429) {
			yield { type: 'error', error: { message: 'Gemini: rate limit', code: 'rate_limit' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			yield { type: 'error', error: { message: `Gemini HTTP ${response.status}: ${text}` } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}
		if (!response.body) {
			yield { type: 'error', error: { message: 'Gemini: пустой ответ' } };
			yield { type: 'finish', finishReason: 'error' };
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let buffer = '';
		let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
		let toolCallCounter = 0;

		try {
			while (true) {
				if (request.signal?.aborted) {
					yield { type: 'finish', finishReason: 'stop' };
					return;
				}
				const { value, done } = await reader.read();
				if (done) { break; }
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data:')) { continue; }
					const payload = trimmed.slice(5).trim();
					if (!payload) { continue; }

					let parsed: any;
					try { parsed = JSON.parse(payload); } catch { continue; }

					const candidate = parsed.candidates?.[0];
					if (!candidate) { continue; }

					const parts = candidate.content?.parts ?? [];
					for (const part of parts) {
						if (typeof part.text === 'string' && part.text.length > 0) {
							yield { type: 'text', text: part.text };
						}
						if (part.functionCall) {
							const id = `gemini-call-${++toolCallCounter}`;
							yield {
								type: 'tool_call_start',
								toolCall: {
									id,
									type: 'function',
									function: {
										name: part.functionCall.name,
										arguments: JSON.stringify(part.functionCall.args ?? {}),
									},
								},
							};
						}
					}

					if (candidate.finishReason) {
						const r = candidate.finishReason;
						if (r === 'STOP') { finishReason = 'stop'; }
						else if (r === 'MAX_TOKENS') { finishReason = 'length'; }
						else if (r === 'SAFETY' || r === 'RECITATION') { finishReason = 'error'; }
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		yield { type: 'finish', finishReason };
	}
}
