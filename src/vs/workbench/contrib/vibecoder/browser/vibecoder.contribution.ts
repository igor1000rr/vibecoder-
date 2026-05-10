/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Точка входа Vibecoder-модуля.
 *
 * Здесь регистрируются команды, view-контейнеры, сервисы и контрибуции,
 * специфичные для Vibecoder. Файл импортируется из workbench.common.main.ts.
 *
 * Архитектура (планируется по мере добавления):
 *   - LLMRouter (./llm/llmRouter.ts) - унифицированный интерфейс к провайдерам
 *   - VibecoderChatView (./chat/) - сайдбар с чатом
 *   - VibecoderComposer (./composer/) - multi-file edit с diff UI
 *   - VibecoderMcpClient (./mcp/) - клиент MCP-серверов
 *   - VibecoderSkillsLoader (./skills/) - загрузчик .vibecoder/skills/
 *   - VibecoderAutocomplete (./autocomplete/) - tab-completion через LM Studio
 */

import { Action2, registerAction2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize, localize2 } from '../../../../nls.js';
import { VIBECODER_PRODUCT_NAME, VIBECODER_VERSION, VibecoderCommands } from '../common/vibecoder.js';

/**
 * Smoke-test действие, подтверждающее что Vibecoder-модуль успешно
 * загружен и зарегистрирован в workbench. Доступно через командную палитру
 * (Ctrl+Shift+P → "Vibecoder: Hello").
 */
class VibecoderHelloAction extends Action2 {
	constructor() {
		super({
			id: VibecoderCommands.Hello,
			title: localize2('vibecoder.hello.title', 'Vibecoder: Hello'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true, // показать в командной палитре
		});
	}

	run(accessor: ServicesAccessor): void {
		const notificationService = accessor.get(INotificationService);
		notificationService.info(
			localize(
				'vibecoder.hello.message',
				'{0} v{1} is alive 🎉  AI-фичи (чат, composer, MCP, skills) появятся в следующих версиях.',
				VIBECODER_PRODUCT_NAME,
				VIBECODER_VERSION
			)
		);
	}
}

registerAction2(VibecoderHelloAction);

// Пункт меню в Help → "Vibecoder Hello" для быстрой проверки что модуль загрузился.
// Когда дойдём до полноценного AI, этот пункт можно удалить или заменить на "Vibecoder Settings".
MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: '0_vibecoder',
	command: {
		id: VibecoderCommands.Hello,
		title: localize({ key: 'miVibecoderHello', comment: ['&& denotes a mnemonic'] }, '&&Vibecoder Hello'),
	},
	order: 1,
});
