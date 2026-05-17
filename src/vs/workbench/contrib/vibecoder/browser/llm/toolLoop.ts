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
 * ВАЖНО: ToolLoopRunner МУТИРУЕТ переданный massiv options.messages (push tool/assistant
 * messages напрямую). Это нужно чтобы UI-слой (chat view) видел обновления и мог сохранить
 * полную историю с tool результатами. Если кому-то нужна не-мутирующая семантика —
 * передайте копию [...messages] явно на стороне вызова.
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
	/**
	 * История сообщений. МУТИРУЕТСЯ — runner добавляет в этот массив assistant
	 * с tool_calls и tool результаты по мере выполнения. Это нужно для
	 * корректного сохранения чата.
	 */
	readonly messages: VibecoderChatMessage[];
	readonly model: string;
	readonly providerHint: VibecoderProviderId;
	readonly tools?: VibecoderTool[];
	readonly signal?: AbortSignal;
}

/**
 * Событие из tool loop. UI-слой подписывается и рендерит.
 *
 * reason:
 *   - 'stop'             — LLM нормально закончила
 *   - 'length'           — LLM упёрлась в max_tokens / context limit (обрыв)
 *   - 'tool_calls'       — LLM запросила tools (промежуточный, не виден UI)
 *   - 'max_iterations'   — достиг лимит итераций tool loop (8)
 *   - 'aborted'          — юзер нажал Стоп
 *   - 'error'            — ошибка в сети/сервере
 */
export type ToolLoopEvent =
	| { type: 'text'; text: string }
	| { type: 'tool_call_started'; toolCall: VibecoderToolCall }
	| { type: 'tool_call_finished'; toolCall: VibecoderToolCall; result: string; isError: boolean }
	| { type: 'iteration'; iteration: number }
	| { type: 'finished'; reason: 'stop' | 'length' | 'max_iterations' | 'aborted' | 'error'; error?: string };

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
		// МУТИРУЕМ переданный массив. UI-слой видит обновления.
		const messages = options.messages;

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
						const slot: Partial<VibecoderToolCall> & { argsBuffer: string } = {
							id: tc.id,
							type: 'function',
							function: tc.function ? { name: tc.function.name ?? '', arguments: '' } : { name: '', arguments: '' },
							argsBuffer: '',
						};
						pendingToolCalls.set(pendingToolCalls.size, slot);
					} else if (chunk.type === 'tool_call_delta' && chunk.toolCall) {
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
						// Если успели накопить assistant текст — пушим его перед выходом,
						// чтобы он не потерялся для последующих сообщений
						if (assistantText) {
							messages.push({ role: 'assistant', content: assistantText });
						}
						yield { type: 'finished', reason: 'error', error: chunk.error.message };
						return;
					}
				}

				// Собрали итерацию. Решаем что делать дальше.
				if (pendingToolCalls.size === 0) {
					// Нет tool calls — простой ответ. Добавляем assistant в историю и выходим.
					if (assistantText) {
						messages.push({ role: 'assistant', content: assistantText });
					}
					// Если LLM упёрлась в лимит токенов — пробрасываем это UI-слою.
					if (finishReason === 'length') {
						yield { type: 'finished', reason: 'length' };
					} else {
						yield { type: 'finished', reason: 'stop' };
					}
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
					if (assistantText) {
						messages.push({ role: 'assistant', content: assistantText });
					}
					if (finishReason === 'length') {
						yield { type: 'finished', reason: 'length' };
					} else {
						yield { type: 'finished', reason: 'stop' };
					}
					return;
				}

				// КРИТИЧНО: добавляем assistant message с tool_calls в ОБЩУЮ историю.
				// LLM должна видеть свои собственные tool_calls в следующих итерациях.
				messages.push({
					role: 'assistant',
					content: assistantText,
					tool_calls: toolCalls,
				});

				// Выполняем все tool calls последовательно
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
						messages.push({
							role: 'tool',
							content: errMsg,
							tool_call_id: toolCall.id,
						});
						yield { type: 'tool_call_finished', toolCall, result: errMsg, isError: true };
						continue;
					}

					try {
						const result = await this.mcpService.callTool(toolCall.function.name, parsedArgs);
						messages.push({
							role: 'tool',
							content: result.content,
							tool_call_id: toolCall.id,
						});
						yield { type: 'tool_call_finished', toolCall, result: result.content, isError: result.isError };
					} catch (e) {
						const errMsg = `Tool ${toolCall.function.name} упал: ${(e as Error).message}`;
						messages.push({
							role: 'tool',
							content: errMsg,
							tool_call_id: toolCall.id,
						});
						yield { type: 'tool_call_finished', toolCall, result: errMsg, isError: true };
					}
				}
			}

			yield { type: 'finished', reason: 'max_iterations' };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: 'finished', reason: 'error', error: message };
		}
	}
}
