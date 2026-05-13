/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Welcome-команда Vibecoder.
 *
 * Открывает полноэкранный анимированный Welcome-таб (кастомный EditorPane,
 * см. `welcomeEditor.ts`).
 *
 * Команда `Vibecoder: Open Welcome` доступна через Ctrl+Shift+P и через
 * меню Help → Vibecoder Welcome. Также вызывается автоматически при
 * первом старте без workspace из `VibecoderStartupContribution`.
 */

import { localize2 } from '../../../../../nls.js';
import { Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { VibecoderWelcomeEditorInput } from './welcomeEditor.js';

export class VibecoderOpenWelcomeAction extends Action2 {
	static readonly ID = 'vibecoder.openWelcome';

	constructor() {
		super({
			id: VibecoderOpenWelcomeAction.ID,
			title: localize2('vibecoder.openWelcome.title', 'Vibecoder: Open Welcome'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);

		// Открываем наш кастомный EditorPane через editor service.
		// VS Code сам найдёт зарегистрированный pane по типу input'а
		// (через SyncDescriptor → IEditorPaneRegistry).
		const input = new VibecoderWelcomeEditorInput();
		await editorService.openEditor(input, { pinned: true });
	}
}
