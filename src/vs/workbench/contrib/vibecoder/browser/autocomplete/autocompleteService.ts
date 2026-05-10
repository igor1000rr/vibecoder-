/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tab-autocomplete через LM Studio.
 *
 * СТАТУС: PLANNED / DISABLED.
 *
 * Изначально использовал `languages.registerInlineCompletionsProvider` из
 * `editor.editor.api.js` — этот путь работает только в monaco-editor
 * standalone, а не в workbench-сборке VS Code OSS. Здесь регистрация
 * должна идти через `ILanguageFeaturesService.inlineCompletionsProvider.register`
 * с правильными типами из `editor/common/languages`. Заглушка оставлена
 * чтобы не ломать сборку до правильной реализации.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IVibecoderAutocompleteService = createDecorator<IVibecoderAutocompleteService>('vibecoderAutocompleteService');

export interface IVibecoderAutocompleteService {
	readonly _serviceBrand: undefined;
	setEnabled(enabled: boolean): void;
	isEnabled(): boolean;
}

export class VibecoderAutocompleteService extends Disposable implements IVibecoderAutocompleteService {
	readonly _serviceBrand: undefined;

	private enabled = false;

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	isEnabled(): boolean {
		return this.enabled;
	}
}
