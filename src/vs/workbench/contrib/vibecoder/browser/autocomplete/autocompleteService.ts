/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tab-autocomplete через LM Studio.
 *
 * Регистрирует InlineCompletionsProvider в Monaco-редакторе. Когда юзер
 * пишет код и делает паузу, провайдер отправляет prompt в LM Studio
 * (модель должна быть FIM-capable: Qwen Coder, DeepSeek Coder, и т.д.)
 * и показывает предложенное завершение серым inline-текстом.
 *
 * Tab принимает предложение. Esc отменяет.
 *
 * Сейчас MVP: простой prompt (не настоящий FIM, а просто "complete this").
 * Полноценный FIM с <|fim_prefix|>/<|fim_suffix|>/<|fim_middle|> токенами
 * добавим когда определимся с целевой моделью.
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { languages } from '../../../../../editor/editor.api.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { VibecoderConfigKeys } from '../../common/vibecoder.js';
import { IVibecoderLLMRouter } from '../llm/llmRouter.js';
import { AUTOCOMPLETE_SYSTEM_PROMPT } from '../prompts/systemPrompts.js';

export const IVibecoderAutocompleteService = createDecorator<IVibecoderAutocompleteService>('vibecoderAutocompleteService');

export interface IVibecoderAutocompleteService {
	readonly _serviceBrand: undefined;
	/** Включить/выключить инлайн-комплишн */
	setEnabled(enabled: boolean): void;
	isEnabled(): boolean;
}

const MAX_PREFIX_CHARS = 4000;
const MAX_SUFFIX_CHARS = 1000;
const DEBOUNCE_MS = 400;

export class VibecoderAutocompleteService extends Disposable implements IVibecoderAutocompleteService {
	readonly _serviceBrand: undefined;

	private enabled = true;
	private providerDisposable: { dispose(): void } | undefined;

	constructor(
		@IVibecoderLLMRouter private readonly llmRouter: IVibecoderLLMRouter,
		@IConfigurationService private readonly configService: IConfigurationService,
	) {
		super();
		this.registerProvider();
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	private registerProvider(): void {
		this.providerDisposable?.dispose();
		// Регистрируем глобально для всех языков; провайдер сам решит подходит ли контекст
		this.providerDisposable = languages.registerInlineCompletionsProvider({ pattern: '**' }, {
			provideInlineCompletions: async (
				model: ITextModel,
				position: Position,
				_context: languages.InlineCompletionContext,
				token: CancellationToken,
			): Promise<languages.InlineCompletions | undefined> => {
				if (!this.enabled) { return undefined; }

				// Только для LM Studio; модель должна быть задана в конфиге
				const modelId = this.configService.getValue<string>(VibecoderConfigKeys.LmStudioAutocompleteModel);
				if (!modelId) { return undefined; }

				// Соберём prefix (до курсора) и suffix (после курсора), ограниченные размером
				const fullText = model.getValue();
				const offset = model.getOffsetAt(position);
				const prefix = fullText.slice(Math.max(0, offset - MAX_PREFIX_CHARS), offset);
				const suffix = fullText.slice(offset, Math.min(fullText.length, offset + MAX_SUFFIX_CHARS));

				// Дебаунс через простой sleep + проверку cancellation
				await new Promise(resolve => setTimeout(resolve, DEBOUNCE_MS));
				if (token.isCancellationRequested) { return undefined; }

				// Промпт-формат: пока не настоящий FIM, а chat-style.
				// Когда выберем целевую модель — заменим на её FIM-токены.
				const userPrompt = `Complete the code at <CURSOR>. Output ONLY the completion text.\n\n\`\`\`\n${prefix}<CURSOR>${suffix}\n\`\`\``;

				const ac = new AbortController();
				token.onCancellationRequested(() => ac.abort());

				let completion = '';
				try {
					const stream = this.llmRouter.chat({
						model: modelId,
						providerHint: 'lmstudio',
						messages: [
							{ role: 'system', content: AUTOCOMPLETE_SYSTEM_PROMPT },
							{ role: 'user', content: userPrompt },
						],
						temperature: 0.2,
						maxTokens: 256,
						signal: ac.signal,
					});

					for await (const chunk of stream) {
						if (token.isCancellationRequested) { return undefined; }
						if (chunk.type === 'text' && chunk.text) {
							completion += chunk.text;
							if (completion.length > 500) { break; }
						}
					}
				} catch {
					return undefined;
				}

				if (!completion.trim()) { return undefined; }

				// Снимем markdown-обёртки если модель их добавила
				completion = completion.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '');

				return {
					items: [{
						insertText: completion,
						range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column },
					}],
				};
			},
			freeInlineCompletions: () => {
				// Ничего освобождать не нужно
			},
		});

		this._register(this.providerDisposable);
	}
}
