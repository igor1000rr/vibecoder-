/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vibecoder Settings View — отдельная панель слева в Activity Bar.
 *
 * Аналог Extensions panel, но для управления Vibecoder/NIT:
 *  - Список LLM-провайдеров со статусом (configured / no key / available?)
 *  - Кнопки [Set Key] / [Test] / [Delete] для каждого
 *  - Endpoints (LM Studio URL, Polza.ai URL) — редактируемые
 *  - Список загруженных skills с кнопкой Reload
 *  - Версия + ссылки
 *
 * Регистрируется в ViewContainerLocation.Sidebar — появляется новая иконка
 * в Activity Bar слева (между Extensions и Remote Explorer обычно).
 */

import { localize, localize2 } from '../../../../../nls.js';
import { ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { Extensions, IViewContainersRegistry, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../../common/views.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../../browser/parts/views/viewPaneContainer.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { URI } from '../../../../../base/common/uri.js';
import { IVibecoderLLMRouter } from '../llm/llmRouter.js';
import { IVibecoderSkillsService } from '../skills/skillsService.js';
import {
	VibecoderCommands,
	VibecoderConfigKeys,
	VibecoderProviderId,
	VIBECODER_LMSTUDIO_DEFAULT_URL,
	VIBECODER_POLZA_DEFAULT_URL,
	VIBECODER_VERSION,
} from '../../common/vibecoder.js';

export const VIBECODER_SETTINGS_VIEW_CONTAINER_ID = 'workbench.view.vibecoderSettings';
export const VIBECODER_SETTINGS_VIEW_ID = 'vibecoder.settingsView';

const settingsViewIcon = registerIcon(
	'vibecoder-settings-icon',
	Codicon.settingsGear,
	localize('vibecoderSettingsIcon', 'Vibecoder — настройки.')
);

interface ProviderRow {
	readonly id: VibecoderProviderId;
	readonly label: string;
	readonly description: string;
	readonly requiresApiKey: boolean;
}

const PROVIDERS: ProviderRow[] = [
	{ id: 'lmstudio', label: 'LM Studio', description: 'Локальная модель (без ключа)', requiresApiKey: false },
	{ id: 'anthropic', label: 'Anthropic', description: 'Claude Opus / Sonnet / Haiku', requiresApiKey: true },
	{ id: 'openai', label: 'OpenAI', description: 'GPT-5, o3, GPT-4.1', requiresApiKey: true },
	{ id: 'gemini', label: 'Google Gemini', description: 'Gemini 2.5 Pro / Flash', requiresApiKey: true },
	{ id: 'openrouter', label: 'OpenRouter', description: 'Агрегатор моделей через один ключ', requiresApiKey: true },
	{ id: 'polza', label: 'Polza.ai', description: 'Российский OpenAI-агрегатор (без VPN)', requiresApiKey: true },
];

const SETTINGS_VIEW_STYLES = `
.vibecoder-settings-view {
	height: 100%;
	overflow-y: auto;
	overflow-x: hidden;
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	background: var(--vscode-sideBar-background);
	color: var(--vscode-foreground);
}

.vibecoder-settings-view .vs-section {
	padding: 12px 14px 6px 14px;
	border-bottom: 1px solid var(--vscode-panel-border);
}

.vibecoder-settings-view .vs-section:last-child {
	border-bottom: none;
}

.vibecoder-settings-view .vs-section-title {
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 1px;
	color: var(--vscode-descriptionForeground);
	margin: 0 0 10px 0;
}

.vibecoder-settings-view .vs-provider {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px 0;
	border-bottom: 1px dashed var(--vscode-panel-border);
}

.vibecoder-settings-view .vs-provider:last-child {
	border-bottom: none;
}

.vibecoder-settings-view .vs-provider-head {
	display: flex;
	justify-content: space-between;
	align-items: center;
}

.vibecoder-settings-view .vs-provider-name {
	font-size: 13px;
	font-weight: 600;
	color: var(--vscode-foreground);
}

.vibecoder-settings-view .vs-provider-status {
	font-size: 10.5px;
	font-family: var(--vscode-editor-font-family);
	padding: 1px 6px;
	border-radius: 3px;
	letter-spacing: 0.5px;
}

.vibecoder-settings-view .vs-status-ok {
	background: var(--vscode-testing-iconPassed, #487E02)33;
	color: var(--vscode-testing-iconPassed, #81B88B);
	border: 1px solid var(--vscode-testing-iconPassed, #81B88B)55;
}

.vibecoder-settings-view .vs-status-warn {
	background: transparent;
	color: var(--vscode-descriptionForeground);
	border: 1px solid var(--vscode-panel-border);
}

.vibecoder-settings-view .vs-status-err {
	background: transparent;
	color: var(--vscode-errorForeground);
	border: 1px solid var(--vscode-errorForeground)55;
}

.vibecoder-settings-view .vs-provider-desc {
	font-size: 11.5px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.4;
}

.vibecoder-settings-view .vs-button-row {
	display: flex;
	gap: 6px;
	margin-top: 4px;
}

.vibecoder-settings-view .vs-btn {
	padding: 3px 10px;
	border-radius: 2px;
	cursor: pointer;
	font-family: inherit;
	font-size: 11px;
	border: 1px solid var(--vscode-panel-border);
	background: transparent;
	color: var(--vscode-foreground);
	transition: background-color 0.1s ease;
}

.vibecoder-settings-view .vs-btn:hover {
	background: var(--vscode-list-hoverBackground);
}

.vibecoder-settings-view .vs-btn-primary {
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border-color: var(--vscode-button-background);
}

.vibecoder-settings-view .vs-btn-primary:hover {
	background: var(--vscode-button-hoverBackground);
}

.vibecoder-settings-view .vs-btn-danger {
	color: var(--vscode-errorForeground);
}

.vibecoder-settings-view .vs-endpoint-row {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-bottom: 10px;
}

.vibecoder-settings-view .vs-endpoint-label {
	font-size: 11.5px;
	color: var(--vscode-foreground);
}

.vibecoder-settings-view .vs-endpoint-input {
	background: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	border: 1px solid var(--vscode-input-border);
	border-radius: 2px;
	padding: 4px 6px;
	font-family: var(--vscode-editor-font-family);
	font-size: 11.5px;
	outline: none;
}

.vibecoder-settings-view .vs-endpoint-input:focus {
	border-color: var(--vscode-focusBorder);
}

.vibecoder-settings-view .vs-skill-list {
	font-size: 11.5px;
	color: var(--vscode-foreground);
	line-height: 1.6;
	max-height: 200px;
	overflow-y: auto;
}

.vibecoder-settings-view .vs-skill-item {
	padding: 2px 0;
	font-family: var(--vscode-editor-font-family);
}

.vibecoder-settings-view .vs-skill-empty {
	font-style: italic;
	color: var(--vscode-descriptionForeground);
}

.vibecoder-settings-view .vs-footer {
	padding: 14px;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.6;
}

.vibecoder-settings-view .vs-footer a {
	color: var(--vscode-textLink-foreground);
	cursor: pointer;
	text-decoration: none;
}

.vibecoder-settings-view .vs-footer a:hover {
	color: var(--vscode-textLink-activeForeground);
	text-decoration: underline;
}
`;

interface ProviderRowEls {
	readonly row: ProviderRow;
	readonly statusEl: HTMLElement;
	readonly setBtn: HTMLButtonElement;
	readonly testBtn: HTMLButtonElement;
	readonly deleteBtn: HTMLButtonElement;
}

export class VibecoderSettingsView extends ViewPane {

	static readonly ID = VIBECODER_SETTINGS_VIEW_ID;

	private rootEl: HTMLElement | undefined;
	private providerRows: ProviderRowEls[] = [];
	private skillsListEl: HTMLElement | undefined;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IVibecoderLLMRouter private readonly llmRouter: IVibecoderLLMRouter,
		@IVibecoderSkillsService private readonly skillsService: IVibecoderSkillsService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.rootEl = container;
		container.classList.add('vibecoder-settings-view');

		const styleEl = append(container, $('style'));
		styleEl.textContent = SETTINGS_VIEW_STYLES;

		this.renderProvidersSection(container);
		this.renderEndpointsSection(container);
		this.renderSkillsSection(container);
		this.renderActionsSection(container);
		this.renderFooter(container);

		this.refresh().catch(err => console.warn('[Vibecoder Settings] refresh failed:', err));
	}

	private renderProvidersSection(parent: HTMLElement): void {
		const section = append(parent, $('div.vs-section'));
		const title = append(section, $('div.vs-section-title'));
		title.textContent = 'Провайдеры LLM';

		this.providerRows = [];

		for (const provider of PROVIDERS) {
			const row = append(section, $('div.vs-provider'));

			const head = append(row, $('div.vs-provider-head'));
			const nameEl = append(head, $('span.vs-provider-name'));
			nameEl.textContent = provider.label;

			const statusEl = append(head, $('span.vs-provider-status.vs-status-warn'));
			statusEl.textContent = '...';

			const desc = append(row, $('div.vs-provider-desc'));
			desc.textContent = provider.description;

			const buttons = append(row, $('div.vs-button-row'));

			const setBtn = append(buttons, $('button.vs-btn.vs-btn-primary')) as HTMLButtonElement;
			setBtn.textContent = provider.requiresApiKey ? 'Set API Key' : 'Test';
			setBtn.title = provider.requiresApiKey
				? `Ввести API-ключ для ${provider.label}. Сохраняется в системном keychain.`
				: `Проверить подключение к ${provider.label}.`;
			setBtn.addEventListener('click', () => {
				if (provider.requiresApiKey) {
					this.onSetApiKey(provider).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
				} else {
					this.onTestProvider(provider).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
				}
			});

			const testBtn = append(buttons, $('button.vs-btn')) as HTMLButtonElement;
			testBtn.textContent = 'Test';
			testBtn.title = `Проверить подключение к ${provider.label}`;
			testBtn.addEventListener('click', () => {
				this.onTestProvider(provider).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
			});

			const deleteBtn = append(buttons, $('button.vs-btn.vs-btn-danger')) as HTMLButtonElement;
			deleteBtn.textContent = 'Delete';
			deleteBtn.title = `Удалить API-ключ ${provider.label} из keychain`;
			deleteBtn.addEventListener('click', () => {
				this.onDeleteApiKey(provider).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
			});

			// LM Studio не требует ключа — Set/Delete для неё не имеют смысла
			if (!provider.requiresApiKey) {
				setBtn.style.display = 'none';
				deleteBtn.style.display = 'none';
			}

			this.providerRows.push({ row: provider, statusEl, setBtn, testBtn, deleteBtn });
		}
	}

	private renderEndpointsSection(parent: HTMLElement): void {
		const section = append(parent, $('div.vs-section'));
		const title = append(section, $('div.vs-section-title'));
		title.textContent = 'Эндпоинты';

		// LM Studio
		{
			const row = append(section, $('div.vs-endpoint-row'));
			const label = append(row, $('label.vs-endpoint-label'));
			label.textContent = 'LM Studio (локально)';
			const input = append(row, $('input.vs-endpoint-input')) as HTMLInputElement;
			input.type = 'text';
			input.value = this.configurationService.getValue<string>(VibecoderConfigKeys.LmStudioEndpoint) ?? VIBECODER_LMSTUDIO_DEFAULT_URL;
			input.placeholder = VIBECODER_LMSTUDIO_DEFAULT_URL;
			input.addEventListener('change', () => {
				const value = input.value.trim() || VIBECODER_LMSTUDIO_DEFAULT_URL;
				this.configurationService.updateValue(VibecoderConfigKeys.LmStudioEndpoint, value, ConfigurationTarget.USER)
					.then(() => this.notify(`LM Studio endpoint обновлён: ${value}`))
					.catch(err => this.notify('Ошибка обновления endpoint: ' + (err?.message ?? err)));
			});
		}

		// Polza.ai
		{
			const row = append(section, $('div.vs-endpoint-row'));
			const label = append(row, $('label.vs-endpoint-label'));
			label.textContent = 'Polza.ai';
			const input = append(row, $('input.vs-endpoint-input')) as HTMLInputElement;
			input.type = 'text';
			input.value = this.configurationService.getValue<string>(VibecoderConfigKeys.PolzaEndpoint) ?? VIBECODER_POLZA_DEFAULT_URL;
			input.placeholder = VIBECODER_POLZA_DEFAULT_URL;
			input.addEventListener('change', () => {
				const value = input.value.trim() || VIBECODER_POLZA_DEFAULT_URL;
				this.configurationService.updateValue(VibecoderConfigKeys.PolzaEndpoint, value, ConfigurationTarget.USER)
					.then(() => this.notify(`Polza.ai endpoint обновлён: ${value}`))
					.catch(err => this.notify('Ошибка обновления endpoint: ' + (err?.message ?? err)));
			});
		}
	}

	private renderSkillsSection(parent: HTMLElement): void {
		const section = append(parent, $('div.vs-section'));
		const title = append(section, $('div.vs-section-title'));
		title.textContent = 'Навыки (.vibecoder/skills/)';

		const listEl = append(section, $('div.vs-skill-list'));
		this.skillsListEl = listEl;
		this.refreshSkillsList();

		const buttons = append(section, $('div.vs-button-row'));
		const reloadBtn = append(buttons, $('button.vs-btn')) as HTMLButtonElement;
		reloadBtn.textContent = 'Перезагрузить';
		reloadBtn.title = 'Пересканировать .vibecoder/skills/ в workspace';
		reloadBtn.addEventListener('click', () => {
			this.commandService.executeCommand('vibecoder.reloadSkills')
				.then(() => this.refreshSkillsList())
				.catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
		});
	}

	private renderActionsSection(parent: HTMLElement): void {
		const section = append(parent, $('div.vs-section'));
		const title = append(section, $('div.vs-section-title'));
		title.textContent = 'Действия';

		const buttons = append(section, $('div.vs-button-row'));
		buttons.style.flexWrap = 'wrap';

		const openNitBtn = append(buttons, $('button.vs-btn.vs-btn-primary')) as HTMLButtonElement;
		openNitBtn.textContent = 'Открыть NIT';
		openNitBtn.addEventListener('click', () => {
			this.commandService.executeCommand(VibecoderCommands.OpenNit).catch(() => { });
		});

		const welcomeBtn = append(buttons, $('button.vs-btn')) as HTMLButtonElement;
		welcomeBtn.textContent = 'Welcome';
		welcomeBtn.addEventListener('click', () => {
			this.commandService.executeCommand(VibecoderCommands.OpenWelcome).catch(() => { });
		});

		const applyBtn = append(buttons, $('button.vs-btn')) as HTMLButtonElement;
		applyBtn.textContent = 'Apply Clipboard';
		applyBtn.title = 'Применить search/replace блоки из буфера обмена';
		applyBtn.addEventListener('click', () => {
			this.commandService.executeCommand('vibecoder.applyFromClipboard').catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
		});
	}

	private renderFooter(parent: HTMLElement): void {
		const footer = append(parent, $('div.vs-footer'));
		const v = append(footer, $('div'));
		v.textContent = `Vibecoder v${VIBECODER_VERSION} · Apache 2.0`;
		const links = append(footer, $('div'));
		const repo = append(links, $('a')) as HTMLAnchorElement;
		repo.textContent = 'github.com/igor1000rr/vibecoder-';
		repo.addEventListener('click', () => {
			this.openerService.open(URI.parse('https://github.com/igor1000rr/vibecoder-'), { openExternal: true }).catch(() => { });
		});
	}

	private refreshSkillsList(): void {
		if (!this.skillsListEl) { return; }
		while (this.skillsListEl.firstChild) {
			this.skillsListEl.removeChild(this.skillsListEl.firstChild);
		}
		const skills = this.skillsService.getAllSkills();
		if (skills.length === 0) {
			const empty = append(this.skillsListEl, $('div.vs-skill-empty'));
			empty.textContent = 'Нет загруженных навыков. Положи SKILL.md в .vibecoder/skills/<name>/.';
			return;
		}
		for (const skill of skills) {
			const item = append(this.skillsListEl, $('div.vs-skill-item'));
			const anySkill = skill as any;
			const name = anySkill.name ?? anySkill.id ?? 'unnamed';
			item.textContent = `• ${name}`;
		}
	}

	private async refresh(): Promise<void> {
		for (const entry of this.providerRows) {
			const { row, statusEl } = entry;
			try {
				if (!row.requiresApiKey) {
					const provider = this.llmRouter.getProvider(row.id);
					if (!provider) {
						this.setStatus(statusEl, 'warn', 'не зарегистр.');
						continue;
					}
					const result = await provider.checkAvailability();
					if (result.available) {
						this.setStatus(statusEl, 'ok', 'доступна');
					} else {
						this.setStatus(statusEl, 'err', 'offline');
						statusEl.title = result.error ?? '';
					}
				} else {
					const key = await this.llmRouter.getApiKey(row.id);
					if (key) {
						this.setStatus(statusEl, 'ok', 'ключ задан');
						statusEl.title = `Ключ: ${this.maskKey(key)}`;
					} else {
						this.setStatus(statusEl, 'warn', 'no key');
						statusEl.title = 'Нажми Set API Key чтобы добавить';
					}
				}
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				this.setStatus(statusEl, 'err', 'ошибка');
				statusEl.title = message;
			}
		}
	}

	private setStatus(el: HTMLElement, kind: 'ok' | 'warn' | 'err', text: string): void {
		el.className = 'vs-provider-status';
		if (kind === 'ok') { el.classList.add('vs-status-ok'); }
		else if (kind === 'err') { el.classList.add('vs-status-err'); }
		else { el.classList.add('vs-status-warn'); }
		el.textContent = text;
	}

	private maskKey(key: string): string {
		if (key.length <= 8) { return '***'; }
		return key.slice(0, 4) + '***' + key.slice(-4);
	}

	private async onSetApiKey(provider: ProviderRow): Promise<void> {
		const apiKey = await this.quickInputService.input({
			password: true,
			placeHolder: `Вставь API-ключ для ${provider.label}`,
			prompt: 'Ключ сохраняется в системном keychain. Никогда не попадает в settings.json или git.',
		});
		if (!apiKey) { return; }
		await this.llmRouter.setApiKey(provider.id, apiKey.trim());
		this.notify(`API-ключ для ${provider.label} сохранён ✅`);
		await this.refresh();
	}

	private async onDeleteApiKey(provider: ProviderRow): Promise<void> {
		await this.llmRouter.deleteApiKey(provider.id);
		this.notify(`API-ключ для ${provider.label} удалён.`);
		await this.refresh();
	}

	private async onTestProvider(provider: ProviderRow): Promise<void> {
		const llmProvider = this.llmRouter.getProvider(provider.id);
		if (!llmProvider) {
			this.notify(`${provider.label}: провайдер не зарегистрирован`);
			return;
		}
		this.notify(`▸ Проверка ${provider.label}...`);
		const result = await llmProvider.checkAvailability();
		if (!result.available) {
			this.notify(`❌ ${provider.label} недоступен: ${result.error ?? 'unknown'}`);
			return;
		}
		try {
			const models = await llmProvider.listModels();
			this.notify(`✅ ${provider.label}: доступен, моделей: ${models.length}`);
			await this.refresh();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			this.notify(`⚠ ${provider.label}: ${message}`);
		}
	}

	private notify(message: string): void {
		this.notificationService.info(message);
	}

	override focus(): void {
		super.focus();
		this.rootEl?.focus();
	}
}

export function registerVibecoderSettingsView(): void {
	const viewContainersRegistry = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry);

	const container: ViewContainer = viewContainersRegistry.registerViewContainer({
		id: VIBECODER_SETTINGS_VIEW_CONTAINER_ID,
		title: localize2('vibecoder.settingsContainer.title', 'Vibecoder'),
		icon: settingsViewIcon,
		order: 100,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIBECODER_SETTINGS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
		hideIfEmpty: false,
	}, ViewContainerLocation.Sidebar, { isDefault: false });

	const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
	viewsRegistry.registerViews([{
		id: VIBECODER_SETTINGS_VIEW_ID,
		name: localize2('vibecoder.settingsView.title', 'Settings'),
		ctorDescriptor: new SyncDescriptor(VibecoderSettingsView),
		canToggleVisibility: true,
		canMoveView: true,
		containerIcon: settingsViewIcon,
		order: 1,
	}], container);
}
