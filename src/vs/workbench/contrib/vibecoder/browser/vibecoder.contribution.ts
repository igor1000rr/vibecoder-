/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Точка входа Vibecoder-модуля.
 *
 * Здесь регистрируются команды, view-контейнеры, сервисы и контрибуции,
 * специфичные для Vibecoder. Файл импортируется из workbench.common.main.ts.
 *
 * Архитектура (планируется по мере добавления):
 *   - LLMRouter (./llm/llmRouter.ts) - унифицированный интерфейс к провайдерам [DONE: MVP]
 *   - VibecoderChatView (./chat/) - сайдбар с чатом
 *   - VibecoderComposer (./composer/) - multi-file edit с diff UI
 *   - VibecoderMcpClient (./mcp/) - клиент MCP-серверов
 *   - VibecoderSkillsLoader (./skills/) - загрузчик .vibecoder/skills/
 *   - VibecoderAutocomplete (./autocomplete/) - tab-completion через LM Studio
 */

import { Action2, registerAction2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { localize, localize2 } from '../../../../nls.js';
import { VIBECODER_PRODUCT_NAME, VIBECODER_VERSION, VibecoderCommands } from '../common/vibecoder.js';
import { IVibecoderLLMRouter, VibecoderLLMRouter } from './llm/llmRouter.js';

//#region --- Сервисы

registerSingleton(IVibecoderLLMRouter, VibecoderLLMRouter, InstantiationType.Delayed);

//#endregion

//#region --- Команды

/**
 * Smoke-test действие, подтверждающее что Vibecoder-модуль успешно
 * загружен и зарегистрирован в workbench.
 */
class VibecoderHelloAction extends Action2 {
	constructor() {
		super({
			id: VibecoderCommands.Hello,
			title: localize2('vibecoder.hello.title', 'Vibecoder: Hello'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
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

/**
 * Тестовая команда: пингует LM Studio и показывает список доступных моделей.
 * Это первая команда которая реально использует LLMRouter и доказывает что
 * AI-инфраструктура подключена.
 */
class VibecoderTestLMStudioAction extends Action2 {
	constructor() {
		super({
			id: VibecoderCommands.TestLMStudio,
			title: localize2('vibecoder.testLMStudio.title', 'Vibecoder: Test LM Studio Connection'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const router = accessor.get(IVibecoderLLMRouter);

		const lmstudio = router.getProvider('lmstudio');
		if (!lmstudio) {
			notificationService.error('LM Studio провайдер не зарегистрирован.');
			return;
		}

		notificationService.info('Проверка LM Studio (localhost:1234)...');

		const availability = await lmstudio.checkAvailability();
		if (!availability.available) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize(
					'vibecoder.testLMStudio.notAvailable',
					'LM Studio недоступна на localhost:1234. Запусти LM Studio и включи Local Server (Developer → Start Server). Ошибка: {0}',
					availability.error ?? 'unknown'
				),
			});
			return;
		}

		try {
			const models = await lmstudio.listModels();
			if (models.length === 0) {
				notificationService.warn('LM Studio работает, но не загружено ни одной модели. Загрузи модель в LM Studio.');
				return;
			}
			const modelList = models.map(m => `• ${m.displayName}`).join('\n');
			notificationService.info(
				localize(
					'vibecoder.testLMStudio.success',
					'LM Studio OK ✅ Найдено {0} модел(и/ей):\n{1}',
					models.length,
					modelList
				)
			);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			notificationService.error(`LM Studio: ошибка получения моделей: ${message}`);
		}
	}
}

registerAction2(VibecoderHelloAction);
registerAction2(VibecoderTestLMStudioAction);

//#endregion

//#region --- Меню

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

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: '0_vibecoder',
	command: {
		id: VibecoderCommands.TestLMStudio,
		title: localize({ key: 'miVibecoderTestLMStudio', comment: ['&& denotes a mnemonic'] }, 'Test &&LM Studio Connection'),
	},
	order: 2,
});

//#endregion
