/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Точка входа Vibecoder-модуля.
 *
 * Архитектура:
 *   - IDE = Vibecoder, AI-ассистент внутри = NIT (Madhya — Срединный путь)
 *   - LLMRouter (./llm/llmRouter.ts) — 5 провайдеров
 *   - NitChatView (./chat/) — сайдбар NIT справа (Cursor-style)
 *   - VibecoderMcpService (./mcp/) — MCP клиент (HTTP/SSE health check)
 *   - VibecoderSkillsService (./skills/) — загрузчик .vibecoder/skills/
 *   - Composer (./composer/) — парсер Aider search/replace + apply
 *   - Welcome (./welcome/) — стартовая страница приветствия
 *   - Branding (./branding/) — кастомный CSS + status bar items
 *   - Autocomplete (./autocomplete/) — Tab autocomplete (FIM) через LM Studio.
 *     Активируется при указании модели в vibecoder.lmStudio.autocompleteModel.
 */

import { Action2, registerAction2, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { localize, localize2 } from '../../../../nls.js';
import { VIBECODER_PRODUCT_NAME, VIBECODER_VERSION, VibecoderCommands, VibecoderConfigKeys, VibecoderProviderId } from '../common/vibecoder.js';
import { IVibecoderLLMRouter, VibecoderLLMRouter } from './llm/llmRouter.js';
import { IVibecoderMcpService, VibecoderMcpService } from './mcp/mcpService.js';
import { IVibecoderSkillsService, VibecoderSkillsService } from './skills/skillsService.js';
import { IVibecoderAutocompleteService, VibecoderAutocompleteService } from './autocomplete/autocompleteService.js';
import { registerVibecoderConfiguration } from './vibecoderConfiguration.js';
import { registerVibecoderChatView, VIBECODER_CHAT_VIEW_ID } from './chat/vibecoderChatView.js';
import { registerVibecoderComposerCommands } from './composer/composerCommands.js';
import { VibecoderOpenWelcomeAction } from './welcome/welcomeCommands.js';
import { VibecoderBrandingContribution } from './branding/brandingContribution.js';

//#region --- Конфигурация

registerVibecoderConfiguration();

//#endregion

//#region --- Сервисы

registerSingleton(IVibecoderLLMRouter, VibecoderLLMRouter, InstantiationType.Delayed);
registerSingleton(IVibecoderMcpService, VibecoderMcpService, InstantiationType.Delayed);
registerSingleton(IVibecoderSkillsService, VibecoderSkillsService, InstantiationType.Delayed);
// Autocomplete — Delayed чтобы стартап не тормозил; instantiated через
// VibecoderAutocompleteBootstrapContribution ниже.
registerSingleton(IVibecoderAutocompleteService, VibecoderAutocompleteService, InstantiationType.Delayed);

//#endregion

//#region --- View (NIT в AuxiliaryBar справа)

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
		const skillsService = accessor.get(IVibecoderSkillsService);
		const skills = skillsService.getAllSkills();
		notificationService.info(
			localize(
				'vibecoder.hello.message',
				'{0} v{1} is alive 🎉  Skills loaded: {2}. NIT справа в AuxiliaryBar.',
				VIBECODER_PRODUCT_NAME,
				VIBECODER_VERSION,
				skills.length
			)
		);
	}
}

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

		notificationService.info('▸ Проверка LM Studio...');

		const availability = await lmstudio.checkAvailability();
		if (!availability.available) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize(
					'vibecoder.testLMStudio.notAvailable',
					'❌ LM Studio недоступна на {0}\n\n{1}\n\nЧто делать:\n1) Открой LM Studio\n2) Загрузи модель (рекомендуется Qwen 3 Coder 30B-A3B)\n3) Developer → Start Server (порт 1234)\n4) Повтори команду',
					availability.endpoint ?? 'http://localhost:1234/v1',
					availability.error ?? 'unknown'
				),
			});
			return;
		}

		try {
			const models = await lmstudio.listModels();
			if (models.length === 0) {
				notificationService.warn('⚠ LM Studio работает, но не загружено ни одной модели.\nОткрой LM Studio → My Models → загрузи модель.');
				return;
			}
			const modelList = models.slice(0, 10).map(m => `• ${m.displayName}`).join('\n');
			const more = models.length > 10 ? `\n... +${models.length - 10} ещё` : '';
			notificationService.info(
				localize(
					'vibecoder.testLMStudio.success',
					'✅ LM Studio OK · {0} модел(и/ей):\n{1}{2}',
					models.length,
					modelList,
					more
				)
			);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			notificationService.error(`LM Studio: ошибка получения моделей: ${message}`);
		}
	}
}

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

		const apiKey = await quickInput.input({
			password: true,
			placeHolder: localize('vibecoder.setApiKey.placeholder', 'Вставь API-ключ для {0}', selected.label),
			prompt: localize('vibecoder.setApiKey.prompt', 'Ключ сохраняется в системном keychain. Никогда не попадает в settings.json или git.'),
		});
		if (!apiKey) { return; }

		await router.setApiKey(selected.id, apiKey.trim());
		notificationService.info(
			localize('vibecoder.setApiKey.success', 'API-ключ для {0} сохранён ✅', selected.label)
		);
	}
}

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

class VibecoderReloadSkillsAction extends Action2 {
	constructor() {
		super({
			id: 'vibecoder.reloadSkills',
			title: localize2('vibecoder.reloadSkills.title', 'Vibecoder: Reload Skills'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const skillsService = accessor.get(IVibecoderSkillsService);
		await skillsService.reload();
		const skills = skillsService.getAllSkills();
		notificationService.info(
			localize('vibecoder.reloadSkills.done', 'Skills перезагружены ✅ Найдено: {0}', skills.length)
		);
	}
}

/**
 * Открывает NIT-сайдбар справа (AuxiliaryBar).
 *
 * Использует две стандартные команды:
 *  1. workbench.action.focusAuxiliaryBar — открыть/сфокусировать правую панель
 *  2. {viewId}.focus — VS Code OSS автоматически регистрирует такую команду для
 *     каждого зарегистрированного View, она поднимает наш view внутри панели
 *
 * Обе обёрнуты в .catch(() => {}) на случай если их по какой-то причине нет
 * в текущей сборке (тогда юзер откроет панель через меню вручную).
 */
class VibecoderOpenNitAction extends Action2 {
	constructor() {
		super({
			id: VibecoderCommands.OpenNit,
			title: localize2('vibecoder.openNit.title', 'Vibecoder: Open NIT Sidebar'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		await commandService.executeCommand('workbench.action.focusAuxiliaryBar').catch(() => { });
		await commandService.executeCommand(`${VIBECODER_CHAT_VIEW_ID}.focus`).catch(() => { });
	}
}

registerAction2(VibecoderHelloAction);
registerAction2(VibecoderTestLMStudioAction);
registerAction2(VibecoderSetApiKeyAction);
registerAction2(VibecoderListModelsAction);
registerAction2(VibecoderReloadSkillsAction);
registerAction2(VibecoderOpenWelcomeAction);
registerAction2(VibecoderOpenNitAction);

// Composer commands (Apply Changes from Clipboard и др.)
registerVibecoderComposerCommands();

//#endregion

//#region --- Startup contributions

const VIBECODER_WELCOME_SHOWN_KEY = 'vibecoder.welcome.shown';

class VibecoderStartupContribution implements IWorkbenchContribution {
	constructor(
		@ICommandService commandService: ICommandService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		const hasWorkspace = workspaceService.getWorkbenchState() !== WorkbenchState.EMPTY;
		const alreadyShown = storageService.getBoolean(VIBECODER_WELCOME_SHOWN_KEY, StorageScope.APPLICATION, false);
		const openNitOnStartup = configurationService.getValue<boolean>(VibecoderConfigKeys.OpenNitOnStartup) !== false;

		if (openNitOnStartup) {
			setTimeout(() => {
				commandService.executeCommand(VibecoderCommands.OpenNit).catch(err => {
					console.warn('[Vibecoder] не удалось открыть NIT:', err);
				});
			}, 700);
		}

		if (!hasWorkspace && !alreadyShown) {
			storageService.store(VIBECODER_WELCOME_SHOWN_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
			setTimeout(() => {
				commandService.executeCommand(VibecoderOpenWelcomeAction.ID).catch(err => {
					console.warn('[Vibecoder] не удалось открыть welcome:', err);
				});
			}, 500);
		}
	}
}

/**
 * Бутстрап-контрибушн, который форсит инстанцирование IVibecoderAutocompleteService через DI.
 *
 * Без этого Delayed-сервис не создастся пока его не запросят явно. А
 * autocomplete-сервис должен жить с момента запуска чтобы зарегистрировать
 * InlineCompletionsProvider в редакторе — иначе Tab autocomplete просто
 * никогда не сработает.
 *
 * Сам сервис активируется только если в настройках указана модель
 * (vibecoder.lmStudio.autocompleteModel), так что bootstrap безопасен.
 */
class VibecoderAutocompleteBootstrapContribution implements IWorkbenchContribution {
	constructor(
		@IVibecoderAutocompleteService _autocomplete: IVibecoderAutocompleteService,
	) {
		// Просто инстанцируем через DI — конструктор сервиса регистрирует провайдер
		void _autocomplete;
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);

// Startup: welcome + auto-open NIT
workbenchContributionsRegistry.registerWorkbenchContribution(VibecoderStartupContribution, LifecyclePhase.Restored);

// Branding: кастомный CSS + status bar items
workbenchContributionsRegistry.registerWorkbenchContribution(VibecoderBrandingContribution, LifecyclePhase.Restored);

// Autocomplete bootstrap: форсим инстанцирование сервиса чтобы провайдер
// зарегистрировался в IL anguageFeaturesService при старте редактора.
workbenchContributionsRegistry.registerWorkbenchContribution(VibecoderAutocompleteBootstrapContribution, LifecyclePhase.Restored);

//#endregion

//#region --- Меню Help

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: '0_vibecoder',
	command: {
		id: VibecoderOpenWelcomeAction.ID,
		title: localize({ key: 'miVibecoderWelcome', comment: ['&& denotes a mnemonic'] }, '&&Vibecoder Welcome'),
	},
	order: 1,
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: '0_vibecoder',
	command: {
		id: VibecoderCommands.Hello,
		title: localize({ key: 'miVibecoderHello', comment: ['&& denotes a mnemonic'] }, 'Vibecoder &&About'),
	},
	order: 2,
});

//#endregion
