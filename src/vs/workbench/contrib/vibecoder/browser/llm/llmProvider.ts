/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VibecoderProviderId } from '../../common/vibecoder.js';

/**
 * Сообщение в чате с LLM. Совместимо с OpenAI Chat Completions API.
 */
export interface VibecoderChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	/** Только для role='tool' - ID связанного tool_call */
	tool_call_id?: string;
	/** Только для role='assistant' - вызовы инструментов */
	tool_calls?: VibecoderToolCall[];
}

/**
 * Описание инструмента в формате OpenAI function calling.
 * Транслируется в Anthropic / Gemini форматы в соответствующих провайдерах.
 */
export interface VibecoderTool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>; // JSON Schema
	};
}

export interface VibecoderToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string; // JSON-строка
	};
}

/**
 * Параметры запроса к LLM.
 */
export interface VibecoderChatRequest {
	messages: VibecoderChatMessage[];
	model: string;
	temperature?: number;
	maxTokens?: number;
	tools?: VibecoderTool[];
	/** Имя провайдера в случае роутера; не используется провайдером напрямую */
	providerHint?: VibecoderProviderId;
	/** AbortController.signal для отмены запроса */
	signal?: AbortSignal;
}

/**
 * Чанк потокового ответа от LLM (streaming).
 * Соответствует delta из OpenAI-style стрима.
 */
export interface VibecoderChatChunk {
	type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'finish' | 'error';
	/** Для type='text' - кусок текста */
	text?: string;
	/** Для type='tool_call_*' */
	toolCall?: Partial<VibecoderToolCall>;
	/** Для type='finish' */
	finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
	/** Для type='error' */
	error?: { message: string; code?: string };
	/** Метаданные использования токенов (обычно только в финальном чанке) */
	usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Описание модели, доступной у провайдера.
 */
export interface VibecoderModelInfo {
	id: string;
	displayName: string;
	contextWindow?: number;
	supportsTools?: boolean;
	supportsVision?: boolean;
}

/**
 * Возможности провайдера, выставляемые наружу.
 * Используются роутером для решения какому провайдеру отправить запрос.
 */
export interface VibecoderProviderCapabilities {
	readonly supportsStreaming: boolean;
	readonly supportsTools: boolean;
	readonly supportsVision: boolean;
	readonly requiresApiKey: boolean;
	/** Если true, провайдер локальный (LM Studio, Ollama) */
	readonly isLocal: boolean;
}

/**
 * Результат checkAvailability у провайдера.
 *
 * `endpoint` опционален: облачные провайдеры (Anthropic/OpenAI/...) могут его
 * не возвращать (либо возвращать base URL для дебага). LM Studio всегда
 * возвращает endpoint — он критичен для диагностики "куда мы пытались
 * достучаться".
 */
export interface VibecoderAvailabilityResult {
	available: boolean;
	error?: string;
	endpoint?: string;
}

/**
 * Базовый интерфейс LLM-провайдера.
 *
 * Все провайдеры (LMStudio, Anthropic, OpenAI, Gemini, OpenRouter)
 * реализуют этот интерфейс; роутер общается с ними только через него.
 */
export interface IVibecoderLLMProvider {
	readonly id: VibecoderProviderId;
	readonly displayName: string;
	readonly capabilities: VibecoderProviderCapabilities;

	/**
	 * Проверить доступность провайдера (например, ping LM Studio,
	 * валидация API-ключа).
	 */
	checkAvailability(): Promise<VibecoderAvailabilityResult>;

	/**
	 * Получить список моделей, доступных у провайдера.
	 * Для облачных - возвращает захардкоженный или fetched список.
	 * Для LM Studio - запрос к /v1/models.
	 */
	listModels(): Promise<VibecoderModelInfo[]>;

	/**
	 * Отправить запрос и получить ответ в виде асинхронного итератора чанков.
	 *
	 * Реализация ОБЯЗАНА:
	 *  - проверить request.signal.aborted перед каждым yield
	 *  - выдать хотя бы один чанк type='finish'
	 *  - не бросать после первого чанка type='error' (вместо этого finish с error reason)
	 */
	chat(request: VibecoderChatRequest): AsyncIterable<VibecoderChatChunk>;
}

/**
 * Ошибка от LLM-провайдера.
 */
export class VibecoderLLMError extends Error {
	constructor(
		message: string,
		public readonly provider: VibecoderProviderId,
		public readonly code?: 'auth' | 'rate_limit' | 'network' | 'timeout' | 'unavailable' | 'invalid_request' | 'unknown',
		public readonly retryAfter?: number
	) {
		super(message);
		this.name = 'VibecoderLLMError';
	}
}
