/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tool execution loop для NIT chat.
 *
 * Превращает одиночный chat() запрос в полноценный agent loop:
 *   1. Отправляем messages + tools в LLM
 *   2. Стримим текст и одновременно собираем tool_calls
 *   3. Если LLM вернула tool_calls — выполняем их через MCP, кладём результаты в messages
 *   4. Повторяем 1-3 пока LLM не закончит без tool_calls (или достигнем maxIterations)
 *
 * Это файл живёт отдельно от vibecoderChatView чтобы:
 *   - не раздувать UI-класс
 *   - переиспользовать loop в Cmd+K inline edit, composer и других местах
 *   - легче тестировать (нет зависимостей от DOM)
 *
 * Limit: maxIterations=8 (стандарт для агентов — больше редко нужно, защищает от циклов).
 */

import { IVibecoderLLMRouter } from './llmRouter.js';
import { IVibecoderMcpService } from '../mcp/mcpService.js';
import {
	VibecoderChatMessage,
	VibecoderChatChunk,
	VibecoderTool,
	VibecoderToolCall,
} from './llmProvider.js';
import { VibecoderProviderId } from '../../common/vibecoder.js';

const MAX_TOOL_ITERATIONS = 8;

export interface ToolLoopOptions {
	readonly messages: VibecoderChatMessage[];
	readonly model: string;
	readonly providerHint: VibecoderProviderId;
	readonly tools?: VibecoderTool[];
	readonly signal?: AbortSignal;
}

/**
 * Событие из tool loop. UI-слой подписывается и рендерит.
 */
export type ToolLoopEvent =
	| { type: 'text'; text: string }
	| { type: 'tool_call_started'; toolCall: VibecoderToolCall }
	| { type: 'tool_call_finished'; toolCall: VibecoderToolCall; result: string; isError: boolean }
	| { type: 'iteration'; iteration: number }
	| { type: 'finished'; reason: 'stop' | 'max_iterations' | 'aborted' | 'error'; error?: string };

export interface IToolLoopRunner {
	/**
	 * Запустить цикл. Возвращает async iterable событий.
	 * Гарантирует ровно один финальный 'finished'.
	 */
	run(options: ToolLoopOptions): AsyncIterable<ToolLoopEvent>;
}

export class ToolLoopRunner implements IToolLoopRunner {
	constructor(
		private readonly llmRouter: IVibecoderLLMRouter,
		private readonly mcpService: IVibecoderMcpService,
	) { }

	async *run(options: ToolLoopOptions): AsyncIterable<ToolLoopEvent> {
		// Локальная копия истории — будем добавлять assistant и tool сообщения
		const messages: VibecoderChatMessage[] = [...options.messages];

		// Tools = переданные явно + MCP (если есть)
		const mcpTools = this.mcpService.getAllTools();
		const allTools: VibecoderTool[] = [...(options.tools ?? []), ...mcpTools];

		let iteration = 0;
		try {
			while (iteration < MAX_TOOL_ITERATIONS) {
				if (options.signal?.aborted) {
					yield { type: 'finished', reason: 'aborted' };
					return;
				}
				iteration++;
				yield { type: 'iteration', iteration };

				let assistantText = '';
				const pendingToolCalls = new Map<number, Partial<VibecoderToolCall> & { argsBuffer: string }>();
				let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined;

				const stream = this.llmRouter.chat({
					messages,
					model: options.model,
					providerHint: options.providerHint,
					tools: allTools.length > 0 ? allTools : undefined,
					signal: options.signal,
				});

				// Читаем стрим этой итерации
				for await (const chunk of stream as AsyncIterable<VibecoderChatChunk>) {
					if (options.signal?.aborted) {
						yield { type: 'finished', reason: 'aborted' };
						return;
					}
					if (chunk.type === 'text' && chunk.text) {
						assistantText += chunk.text;
						yield { type: 'text', text: chunk.text };
					} else if (chunk.type === 'tool_call_start' && chunk.toolCall) {
						const tc = chunk.toolCall;
						// id может прийти из delta — пока используем заглушку, проставится по мере поступления
						const slot: Partial<VibecoderToolCall> & { argsBuffer: string } = {
							id: tc.id,
							type: 'function',
							function: tc.function ? { name: tc.function.name ?? '', arguments: '' } : { name: '', arguments: '' },
							argsBuffer: '',
						};
						// Используем порядковый индекс пока нет нативного index из провайдера
						pendingToolCalls.set(pendingToolCalls.size, slot);
					} else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
						// Дополняем последний tool call (или находим по id если он пришёл)
						const tc = chunk.toolCall;
						const last = Array.from(pendingToolCalls.entries()).pop();
						if (!last) { continue; }
						const slot = last[1];
						if (tc.id && !slot.id) { slot.id = tc.id; }
						if (tc.function?.name && slot.function) {
							slot.function.name = tc.function.name;
						}
						if (tc.function?.arguments && slot.function) {
							slot.argsBuffer += tc.function.arguments;
						}
					} else if (chunk.type === 'finish') {
						finishReason = chunk.finishReason;
					} else if (chunk.type === 'error' && chunk.error) {
						yield { type: 'finished', reason: 'error', error: chunk.error.message };
						return;
					}
				}

				// Собрали итерацию. Решаем что делать дальше.
				if (pendingToolCalls.size === 0) {
					// Нет tool calls — простой ответ, выходим
					yield { type: 'finished', reason: 'stop' };
					return;
				}

				// Финализируем tool calls (склеиваем argsBuffer → arguments)
				const toolCalls: VibecoderToolCall[] = [];
				for (const slot of pendingToolCalls.values()) {
					if (!slot.function?.name) { continue; }
					toolCalls.push({
						id: slot.id ?? `call_${Date.now()}_${toolCalls.length}`,
						type: 'function',
						function: {
							name: slot.function.name,
							arguments: slot.argsBuffer || slot.function.arguments || '',
						},
					});
				}

				if (toolCalls.length === 0) {
					// Заявил tool_calls в finish_reason, но реально ничего не отдал — выходим
					yield { type: 'finished', reason: 'stop' };
					return;
				}

				// Добавляем assistant message с tool_calls в историю
				messages.push({
					role: 'assistant',
					content: assistantText,
					tool_calls: toolCalls,
				});

				// Выполняем все tool calls последовательно (параллельно может быть быстрее,
				// но usability сильно лучше когда юзер видит прогресс по одной)
				for (const toolCall of toolCalls) {
					if (options.signal?.aborted) {
						yield { type: 'finished', reason: 'aborted' };
						return;
					}
					yield { type: 'tool_call_started', toolCall };

					let parsedArgs: Record<string, unknown> = {};
					try {
						parsedArgs = toolCall.function.arguments
							? JSON.parse(toolCall.function.arguments) as Record<string, unknown>
							: {};
					} catch (e) {
						const errMsg = `Не удалось распарсить arguments: ${(e as Error).message}`;
						yield { type: 'tool_call_finished', toolCall, result: errMsg, isError: true };
						messages.push({
							role: 'tool',
							content: errMsg,
							tool_call_id: toolCall.id,
						});
						continue;
					}

					try {
						const result = await this.mcpService.callTool(toolCall.function.name, parsedArgs);
						yield { type: 'tool_call_finished', toolCall, result: result.content, isError: result.isError };
						messages.push({
							role: 'tool',
							content: result.content,
							tool_call_id: toolCall.id,
						});
					} catch (e) {
						const errMsg = `Tool ${toolCall.function.name} упал: ${(e as Error).message}`;
						yield { type: 'tool_call_finished', toolCall, result: errMsg, isError: true };
						messages.push({
							role: 'tool',
							content: errMsg,
							tool_call_id: toolCall.id,
						});
					}
				}

				// finishReason у некоторых провайдеров не приходит — продолжаем цикл
				void finishReason;
			}

			// Достигли лимита итераций
			yield { type: 'finished', reason: 'max_iterations' };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: 'finished', reason: 'error', error: message };
		}
	}
}
