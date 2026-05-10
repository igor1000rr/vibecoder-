/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Точка входа Vibecoder-модуля.
 *
 * Здесь регистрируются команды, view-контейнеры, сервисы и контрибуции,
 * специфичные для Vibecoder.
 *
 * Архитектура:
 *   - LLMRouter (./llm/llmRouter.ts) [DONE] - управление 5 провайдерами
 *   - VibecoderChatView (./chat/) [DONE: скелет] - сайдбар с чатом
 *   - VibecoderComposer (./composer/) [PLANNED] - multi-file edit с diff UI
 *   - VibecoderMcpClient (./mcp/) [PLANNED] - клиент MCP-серверов
 *   - VibecoderSkillsLoader (./skills/) [PLANNED] - загрузчик .vibecoder/skills/
 *   - VibecoderAutocomplete (./autocomplete/) [PLANNED] - tab-completion через LM Studio
 */

import { Action2, registerAction2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { localize, localize2 } from '../../../../nls.js';
import { VIBECODER_PRODUCT_NAME, VIBECODER_VERSION, VibecoderCommands, VibecoderProviderId } from '../common/vibecoder.js';
import { IVibecoderLLMRouter, VibecoderLLMRouter } from './llm/llmRouter.js';
import { registerVibecoderConfiguration } from './vibecoderConfiguration.js';
import { registerVibecoderChatView } from './chat/vibecoderChatView.js';

//#region --- Конфигурация

registerVibecoderConfiguration();

//#endregion

//#region --- Сервисы

registerSingleton(IVibecoderLLMRouter, VibecoderLLMRouter, InstantiationType.Delayed);

//#endregion

//#region --- View (Activity Bar + сайдбар чата)

registerVibecoderChatView();

//#endregion

//#region --- Команды

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
				'{0} v{1} is alive 🎉  AI-фичи появляются по мере разработки.',
				VIBECODER_PRODUCT_NAME,
				VIBECODER_VERSION
			)
		);
	}
}

/**
 * Тестовая команда: пингует LM Studio и показывает список доступных моделей.
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

		notificationService.info('Проверка LM Studio...');

		const availability = await lmstudio.checkAvailability();
		if (!availability.available) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize(
					'vibecoder.testLMStudio.notAvailable',
					'LM Studio недоступна. Запусти LM Studio и включи Local Server (Developer → Start Server). Ошибка: {0}',
					availability.error ?? 'unknown'
				),
			});
			return;
		}

		try {
			const models = await lmstudio.listModels();
			if (models.length === 0) {
				notificationService.warn('LM Studio работает, но не загружено ни одной модели.');
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

/**
 * Универсальная команда ввода API-ключа для облачного провайдера.
 * Сохраняет ключ в SecretStorage (OS keychain) через LLMRouter.
 */
class VibecoderSetApiKeyAction extends Action2 {
	constructor() {
		super({
			id: 'vibecoder.setApiKey',
			title: localize2('vibecoder.setApiKey.title', 'Vibecoder: Set API Key for Provider'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const router = accessor.get(IVibecoderLLMRouter);

		// Шаг 1: выбрать провайдера
		const providerPicks: Array<{ label: string; description?: string; id: VibecoderProviderId }> = [
			{ label: 'Anthropic', description: 'Claude Opus/Sonnet/Haiku', id: 'anthropic' },
			{ label: 'OpenAI', description: 'GPT-5, o3, GPT-4.1', id: 'openai' },
			{ label: 'Google Gemini', description: 'Gemini 2.5 Pro/Flash', id: 'gemini' },
			{ label: 'OpenRouter', description: 'агрегатор моделей через один ключ', id: 'openrouter' },
		];
		const selected = await quickInput.pick(providerPicks, {
			placeHolder: localize('vibecoder.setApiKey.selectProvider', 'Выбери провайдера для ввода API-ключа'),
		});
		if (!selected) { return; }

		// Шаг 2: ввести ключ
		const apiKey = await quickInput.input({
			password: true,
			placeHolder: localize('vibecoder.setApiKey.placeholder', 'Вставь API-ключ для {0}', selected.label),
			prompt: localize('vibecoder.setApiKey.prompt', 'Ключ будет сохранён в системном keychain (OS SecretStorage). Никогда не попадает в settings.json или git.'),
		});
		if (!apiKey) { return; }

		await router.setApiKey(selected.id, apiKey.trim());
		notificationService.info(
			localize('vibecoder.setApiKey.success', 'API-ключ для {0} сохранён ✅', selected.label)
		);
	}
}

/**
 * Команда: список всех доступных моделей (опрашивает все провайдеры).
 */
class VibecoderListModelsAction extends Action2 {
	constructor() {
		super({
			id: 'vibecoder.listModels',
			title: localize2('vibecoder.listModels.title', 'Vibecoder: List All Available Models'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const router = accessor.get(IVibecoderLLMRouter);

		notificationService.info('Сбор моделей со всех провайдеров...');
		const all = await router.listAllModels();

		if (all.length === 0) {
			notificationService.warn('Ни один провайдер не вернул моделей. Проверь LM Studio и/или API-ключи.');
			return;
		}

		const byProvider = new Map<string, string[]>();
		for (const { provider, model } of all) {
			if (!byProvider.has(provider)) { byProvider.set(provider, []); }
			byProvider.get(provider)!.push(model.displayName);
		}

		const lines: string[] = [];
		for (const [provider, models] of byProvider) {
			lines.push(`${provider}: ${models.length} модел(и/ей)`);
			for (const m of models.slice(0, 5)) {
				lines.push(`  • ${m}`);
			}
			if (models.length > 5) {
				lines.push(`  • ... +${models.length - 5} ещё`);
			}
		}

		notificationService.info(lines.join('\n'));
	}
}

registerAction2(VibecoderHelloAction);
registerAction2(VibecoderTestLMStudioAction);
registerAction2(VibecoderSetApiKeyAction);
registerAction2(VibecoderListModelsAction);

//#endregion

//#region --- Меню Help

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: '0_vibecoder',
	command: {
		id: VibecoderCommands.Hello,
		title: localize({ key: 'miVibecoderHello', comment: ['&& denotes a mnemonic'] }, '&&Vibecoder'),
	},
	order: 1,
});

//#endregion
