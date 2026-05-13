/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tab-autocomplete (FIM — Fill In the Middle) через LM Studio.
 *
 * Регистрирует InlineCompletionsProvider в IL anguageFeaturesService,
 * который ловит каждое движение курсора в редакторе и запрашивает у LLM
 * предположение что юзер хочет напечатать дальше.
 *
 * АКТИВАЦИЯ:
 *   Безопасный default — пусто в `vibecoder.lmStudio.autocompleteModel` →
 *   provider молчит и ничего не запрашивает. Чтобы включить, юзер должен
 *   явно указать модель в настройках (рекомендуется маленькая и быстрая
 *   модель типа Qwen 2.5 Coder 1.5B/3B).
 *
 * FIM-ФОРМАТ:
 *   Многие модели (Qwen Coder, DeepSeek Coder, StarCoder) понимают
 *   специальные FIM-токены `<|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>`.
 *   В этом MVP используем chat-формат с системным промптом — он работает
 *   с ЛЮБОЙ моделью, а потом можно улучшить переключив на /v1/completions
 *   с FIM-токенами для скорости.
 *
 * РАСХОД:
 *   - Запрос идёт на КАЖДЫЙ вызов provider (VS Code сам частично дебаунсит)
 *   - В debounce внутри провайдера тоже добавим — минимум 250ms между запросами
 *   - Cancellation через CancellationToken от VS Code + AbortController наружу
 *
 * ОГРАНИЧЕНИЯ:
 *   - Только текстовые модели (.scheme === 'file' || 'untitled')
 *   - Только когда модель указана и LM Studio доступна
 *   - Не работает для очень длинных файлов (обрезаем prefix до 2000 строк)
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { InlineCompletion, InlineCompletionContext, InlineCompletions, InlineCompletionsProvider } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { IVibecoderLLMRouter } from '../llm/llmRouter.js';
import { VibecoderConfigKeys } from '../../common/vibecoder.js';
import { AUTOCOMPLETE_SYSTEM_PROMPT } from '../prompts/systemPrompts.js';

export const IVibecoderAutocompleteService = createDecorator<IVibecoderAutocompleteService>('vibecoderAutocompleteService');

export interface IVibecoderAutocompleteService {
	readonly _serviceBrand: undefined;
	/** True если провайдер зарегистрирован в редакторе (всегда true после конструктора). */
	isRegistered(): boolean;
}

/** Минимальный интервал между запросами к LM Studio, чтобы не забивать её при быстром наборе. */
const MIN_REQUEST_INTERVAL_MS = 250;
/** Сколько строк выше курсора отдаём модели как контекст. */
const PREFIX_LINES_LIMIT = 2000;
/** Сколько строк ниже курсора отдаём модели как контекст (мало — модель пишет вперёд). */
const SUFFIX_LINES_LIMIT = 200;
/** Лимит размера completion который мы примем. */
const MAX_COMPLETION_LENGTH = 1500;

class VibecoderInlineCompletionProvider implements InlineCompletionsProvider {

	/** Время последнего запроса — для throttle между быстрыми нажатиями клавиш. */
	private lastRequestAt = 0;

	constructor(
		private readonly llmRouter: IVibecoderLLMRouter,
		private readonly configService: IConfigurationService,
	) { }

	async provideInlineCompletions(
		model: ITextModel,
		position: Position,
		_context: InlineCompletionContext,
		token: CancellationToken,
	): Promise<InlineCompletions | undefined> {
		// 1. Проверка активации через конфиг
		const autocompleteModel = this.configService.getValue<string>(VibecoderConfigKeys.LmStudioAutocompleteModel);
		if (!autocompleteModel || !autocompleteModel.trim()) {
			return undefined; // фича отключена
		}

		// 2. Только текстовые модели (не output, не git, не readonly)
		const scheme = model.uri.scheme;
		if (scheme !== 'file' && scheme !== 'untitled' && scheme !== 'vscode-userdata') {
			return undefined;
		}

		// 3. Throttle — если предыдущий запрос был совсем недавно, ждём
		const now = Date.now();
		const sinceLast = now - this.lastRequestAt;
		if (sinceLast < MIN_REQUEST_INTERVAL_MS) {
			await delay(MIN_REQUEST_INTERVAL_MS - sinceLast);
			if (token.isCancellationRequested) { return undefined; }
		}
		this.lastRequestAt = Date.now();

		// 4. Соберём prefix/suffix вокруг курсора
		const { prefix, suffix } = extractContextAroundCursor(model, position);
		const lang = model.getLanguageId();

		// 5. Составим запрос к LM Studio через chat API
		const userMessage = buildFimMessage(lang, prefix, suffix);

		// 6. Прокидываем cancellation от VS Code в AbortController fetch
		const abort = new AbortController();
		const cancelSubscription = token.onCancellationRequested(() => abort.abort());

		let completion = '';
		try {
			const stream = this.llmRouter.chat({
				model: autocompleteModel,
				providerHint: 'lmstudio',
				messages: [
					{ role: 'system', content: AUTOCOMPLETE_SYSTEM_PROMPT },
					{ role: 'user', content: userMessage },
				],
				temperature: 0.1, // очень низкая стохастика — нужно предсказуемое продолжение
				maxTokens: 256,
				signal: abort.signal,
			});

			for await (const chunk of stream) {
				if (token.isCancellationRequested) { return undefined; }
				if (chunk.type === 'text' && chunk.text) {
					completion += chunk.text;
					if (completion.length > MAX_COMPLETION_LENGTH) {
						abort.abort();
						break;
					}
				} else if (chunk.type === 'error') {
					console.warn('[Vibecoder][Autocomplete] LLM error:', chunk.error?.message);
					return undefined;
				}
			}
		} catch (e) {
			// AbortError — нормально (юзер передвинул курсор). Логируем только странное.
			const msg = e instanceof Error ? e.message : String(e);
			if (!/abort/i.test(msg)) {
				console.warn('[Vibecoder][Autocomplete] request failed:', msg);
			}
			return undefined;
		} finally {
			cancelSubscription.dispose();
		}

		if (!completion.trim()) { return undefined; }

		// 7. Очистка от markdown-артефактов (модель иногда заворачивает в ```)
		const cleaned = stripMarkdownArtifacts(completion);
		if (!cleaned) { return undefined; }

		// 8. Возвращаем completion для inline-показа
		return {
			items: [{
				insertText: cleaned,
				range: {
					startLineNumber: position.lineNumber,
					startColumn: position.column,
					endLineNumber: position.lineNumber,
					endColumn: position.column,
				},
			}],
			suppressSuggestions: false,
			enableForwardStability: true,
		};
	}

	freeInlineCompletions(_completions: InlineCompletions): void {
		// Ничего не освобождаем — все данные in-memory, GC уберёт.
	}

	handleItemDidShow?(_completions: InlineCompletions, _item: InlineCompletion): void {
		// Hook для будущей телеметрии. Сейчас no-op.
	}
}

/** Извлекает префикс/суффикс вокруг курсора с лимитами по строкам. */
function extractContextAroundCursor(model: ITextModel, position: Position): { prefix: string; suffix: string } {
	const lineCount = model.getLineCount();
	const startLine = Math.max(1, position.lineNumber - PREFIX_LINES_LIMIT);
	const endLine = Math.min(lineCount, position.lineNumber + SUFFIX_LINES_LIMIT);

	const prefix = model.getValueInRange({
		startLineNumber: startLine,
		startColumn: 1,
		endLineNumber: position.lineNumber,
		endColumn: position.column,
	});

	const suffix = model.getValueInRange({
		startLineNumber: position.lineNumber,
		startColumn: position.column,
		endLineNumber: endLine,
		endColumn: model.getLineMaxColumn(endLine),
	});

	return { prefix, suffix };
}

/** Собирает FIM-запрос для chat-модели. */
function buildFimMessage(lang: string, prefix: string, suffix: string): string {
	return `Language: ${lang}

Before cursor:
\`\`\`${lang}
${prefix}
\`\`\`

After cursor (do NOT include in completion):
\`\`\`${lang}
${suffix}
\`\`\`

Output ONLY the code that should be inserted at the cursor. Do not repeat the "Before cursor" text. Do not include the "After cursor" text. No explanations, no markdown, no backticks.`;
}

/** Удаляет markdown-обёртку которую модель иногда добавляет несмотря на инструкции. */
function stripMarkdownArtifacts(text: string): string {
	let cleaned = text;
	// Удаляем `` ```lang `` в начале (на отдельной строке)
	cleaned = cleaned.replace(/^```\w*\n/, '');
	// Удаляем `` ``` `` в конце
	cleaned = cleaned.replace(/\n?```\s*$/, '');
	return cleaned;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Сервис autocomplete — регистрирует провайдер в редакторе при инстанцировании.
 *
 * Создаётся через DI как singleton. Provider остаётся живым всю сессию.
 * Активация фичи — через конфиг `vibecoder.lmStudio.autocompleteModel`:
 * пусто = провайдер вернёт undefined мгновенно, нет нагрузки.
 */
export class VibecoderAutocompleteService extends Disposable implements IVibecoderAutocompleteService {
	readonly _serviceBrand: undefined;

	private registered = false;

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IVibecoderLLMRouter llmRouter: IVibecoderLLMRouter,
		@IConfigurationService configService: IConfigurationService,
	) {
		super();

		try {
			const provider = new VibecoderInlineCompletionProvider(llmRouter, configService);
			const registration = languageFeaturesService.inlineCompletionsProvider.register('*', provider);
			this._register(registration);
			this.registered = true;
			console.log('[Vibecoder][Autocomplete] inline completions provider registered. Set vibecoder.lmStudio.autocompleteModel to activate.');
		} catch (e) {
			console.error('[Vibecoder][Autocomplete] failed to register provider:', e);
		}
	}

	isRegistered(): boolean {
		return this.registered;
	}
}
