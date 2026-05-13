/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vibecoder Settings View — отдельная панель слева в Activity Bar (иконка ⚙).
 *
 * Все секции - collapsible (▾ открыта / ▸ свёрнута). По умолчанию открыты:
 *   - Провайдеры LLM
 *   - MCP-серверы
 * Свёрнуты:
 *   - Эндпоинты, Навыки, Действия
 *
 * Состояние раскрытия секций — в localStorage workbench (StorageService).
 *
 * MCP-секция имеет поиск + фильтр по статусу: All / Configured / Not configured.
 *
 * Skills тоже под поиском (32 built-in + workspace).
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
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IVibecoderLLMRouter } from '../llm/llmRouter.js';
import { IVibecoderSkillsService } from '../skills/skillsService.js';
import { BUILTIN_MCP_TEMPLATES, VibecoderMcpTemplate, templateToConfig } from '../mcp/builtinMcpTemplates.js';
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

type SectionId = 'providers' | 'endpoints' | 'skills' | 'mcp' | 'actions';

interface SectionDefaults {
	readonly id: SectionId;
	readonly title: string;
	readonly defaultExpanded: boolean;
}

const SECTIONS: readonly SectionDefaults[] = [
	{ id: 'providers', title: 'Провайдеры LLM', defaultExpanded: true },
	{ id: 'mcp', title: 'MCP-серверы', defaultExpanded: true },
	{ id: 'skills', title: 'Навыки (Skills)', defaultExpanded: false },
	{ id: 'endpoints', title: 'Эндпоинты', defaultExpanded: false },
	{ id: 'actions', title: 'Действия', defaultExpanded: false },
];

const STORAGE_KEY_SECTION_PREFIX = 'vibecoder.settingsView.section.';

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

.vibecoder-settings-view .vs-quick-start {
	padding: 10px 14px;
	background: var(--vscode-textBlockQuote-background, transparent);
	border-bottom: 1px solid var(--vscode-panel-border);
	font-size: 11.5px;
	line-height: 1.5;
	color: var(--vscode-foreground);
}

.vibecoder-settings-view .vs-quick-start b {
	color: var(--vscode-textLink-foreground);
}

.vibecoder-settings-view .vs-section {
	border-bottom: 1px solid var(--vscode-panel-border);
}

.vibecoder-settings-view .vs-section:last-child {
	border-bottom: none;
}

.vibecoder-settings-view .vs-section-header {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 14px;
	cursor: pointer;
	user-select: none;
	background: transparent;
	transition: background-color 0.1s ease;
}

.vibecoder-settings-view .vs-section-header:hover {
	background: var(--vscode-list-hoverBackground);
}

.vibecoder-settings-view .vs-section-chevron {
	font-size: 10px;
	color: var(--vscode-descriptionForeground);
	width: 12px;
	display: inline-block;
}

.vibecoder-settings-view .vs-section-title {
	flex: 1;
	font-size: 11px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 1px;
	color: var(--vscode-foreground);
}

.vibecoder-settings-view .vs-section-counter {
	font-size: 10px;
	color: var(--vscode-descriptionForeground);
	font-family: var(--vscode-editor-font-family);
}

.vibecoder-settings-view .vs-section-body {
	padding: 4px 14px 12px 14px;
}

.vibecoder-settings-view .vs-section-body.collapsed {
	display: none;
}

.vibecoder-settings-view .vs-section-hint {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	margin: 4px 0 8px 0;
	font-style: italic;
	line-height: 1.4;
}

.vibecoder-settings-view .vs-search-row {
	margin-bottom: 8px;
}

.vibecoder-settings-view .vs-search-input {
	width: 100%;
	box-sizing: border-box;
	background: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	border: 1px solid var(--vscode-input-border);
	border-radius: 2px;
	padding: 4px 6px;
	font-size: 11.5px;
	outline: none;
}

.vibecoder-settings-view .vs-search-input:focus {
	border-color: var(--vscode-focusBorder);
}

.vibecoder-settings-view .vs-filter-row {
	display: flex;
	gap: 4px;
	margin-bottom: 8px;
	flex-wrap: wrap;
}

.vibecoder-settings-view .vs-filter-chip {
	font-size: 10.5px;
	padding: 2px 8px;
	border-radius: 9px;
	border: 1px solid var(--vscode-panel-border);
	background: transparent;
	color: var(--vscode-foreground);
	cursor: pointer;
}

.vibecoder-settings-view .vs-filter-chip:hover {
	background: var(--vscode-list-hoverBackground);
}

.vibecoder-settings-view .vs-filter-chip.active {
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border-color: var(--vscode-button-background);
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
	gap: 6px;
}

.vibecoder-settings-view .vs-provider-name {
	font-size: 13px;
	font-weight: 600;
	color: var(--vscode-foreground);
}

.vibecoder-settings-view .vs-status {
	font-size: 10.5px;
	font-family: var(--vscode-editor-font-family);
	padding: 1px 6px;
	border-radius: 3px;
	letter-spacing: 0.3px;
}

.vibecoder-settings-view .vs-status-ok {
	background: transparent;
	color: var(--vscode-testing-iconPassed, #81B88B);
	border: 1px solid var(--vscode-panel-border);
}

.vibecoder-settings-view .vs-status-warn {
	background: transparent;
	color: var(--vscode-descriptionForeground);
	border: 1px solid var(--vscode-panel-border);
}

.vibecoder-settings-view .vs-status-err {
	background: transparent;
	color: var(--vscode-errorForeground);
	border: 1px solid var(--vscode-errorForeground);
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
	flex-wrap: wrap;
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

.vibecoder-settings-view .vs-skill-item {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 4px 0;
	font-size: 11.5px;
	color: var(--vscode-foreground);
	font-family: var(--vscode-editor-font-family);
}

.vibecoder-settings-view .vs-skill-name {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.vibecoder-settings-view .vs-skill-source {
	font-size: 10px;
	padding: 1px 6px;
	border-radius: 3px;
	margin-left: 6px;
	font-family: var(--vscode-editor-font-family);
	color: var(--vscode-descriptionForeground);
	border: 1px solid var(--vscode-panel-border);
}

.vibecoder-settings-view .vs-skill-source-workspace {
	color: var(--vscode-textLink-foreground);
	border-color: var(--vscode-textLink-foreground);
}

.vibecoder-settings-view .vs-empty {
	font-style: italic;
	color: var(--vscode-descriptionForeground);
	font-size: 11.5px;
	padding: 8px 0;
}

.vibecoder-settings-view .vs-list-scroll {
	max-height: 360px;
	overflow-y: auto;
}

.vibecoder-settings-view .vs-mcp-item {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 8px 0;
	border-bottom: 1px dashed var(--vscode-panel-border);
}

.vibecoder-settings-view .vs-mcp-item:last-child {
	border-bottom: none;
}

.vibecoder-settings-view .vs-mcp-head {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 6px;
}

.vibecoder-settings-view .vs-mcp-name {
	font-size: 12.5px;
	font-weight: 600;
	color: var(--vscode-foreground);
	flex: 1;
	display: flex;
	align-items: center;
	gap: 6px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.vibecoder-settings-view .vs-mcp-type {
	font-size: 9.5px;
	font-family: var(--vscode-editor-font-family);
	padding: 0 5px;
	border-radius: 3px;
	border: 1px solid var(--vscode-panel-border);
	color: var(--vscode-descriptionForeground);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.vibecoder-settings-view .vs-mcp-desc {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.4;
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
}

type McpFilter = 'all' | 'configured' | 'not-configured';

export class VibecoderSettingsView extends ViewPane {

	static readonly ID = VIBECODER_SETTINGS_VIEW_ID;

	private rootEl: HTMLElement | undefined;
	private providerRows: ProviderRowEls[] = [];
	private skillsListEl: HTMLElement | undefined;
	private skillsSearchValue = '';
	private skillsCounter: HTMLElement | undefined;
	private mcpListEl: HTMLElement | undefined;
	private mcpSearchValue = '';
	private mcpFilter: McpFilter = 'all';
	private mcpCounter: HTMLElement | undefined;
	private mcpStatusElements = new Map<string, HTMLElement>();
	private mcpConfiguredIds = new Set<string>();

	/** body-элементы секций для toggle collapse/expand */
	private sectionBodies = new Map<SectionId, HTMLElement>();
	private sectionChevrons = new Map<SectionId, HTMLElement>();

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
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.rootEl = container;
		container.classList.add('vibecoder-settings-view');

		const styleEl = append(container, $('style'));
		styleEl.textContent = SETTINGS_VIEW_STYLES;

		this.renderQuickStart(container);

		// Секции в определённом порядке
		for (const section of SECTIONS) {
			const body = this.renderSectionShell(container, section);
			switch (section.id) {
				case 'providers': this.renderProvidersBody(body); break;
				case 'mcp': this.renderMcpBody(body); break;
				case 'skills': this.renderSkillsBody(body); break;
				case 'endpoints': this.renderEndpointsBody(body); break;
				case 'actions': this.renderActionsBody(body); break;
			}
		}

		this.renderFooter(container);

		// Подгрузить статусы
		this.refreshProviders().catch(err => console.warn('[Vibecoder Settings] refresh failed:', err));
		this.refreshMcpConfigured().catch(() => { });

		this._register(this.skillsService.onDidChangeSkills(() => this.refreshSkillsList()));
	}

	// ── Quick start hint (вверху панели) ────────────────────────

	private renderQuickStart(parent: HTMLElement): void {
		const box = append(parent, $('div.vs-quick-start'));
		box.innerHTML = `
			<div style="margin-bottom: 4px;"><b>👋 Привет!</b> Это панель настроек Vibecoder.</div>
			<div>NIT-чат — справа в боковой панели. Здесь — настрой провайдеры и подключи MCP-серверы.</div>
		`;
		// Чтобы не было XSS — innerHTML только для статичного контента, без user input.
		// Альтернативно можно через append + textContent, но markup проще через innerHTML.
	}

	// ── Collapsible-секции ───────────────────────────────────────

	private renderSectionShell(parent: HTMLElement, def: SectionDefaults): HTMLElement {
		const section = append(parent, $('div.vs-section'));

		const header = append(section, $('div.vs-section-header')) as HTMLElement;
		const chevron = append(header, $('span.vs-section-chevron'));
		const title = append(header, $('span.vs-section-title'));
		title.textContent = def.title;
		const counter = append(header, $('span.vs-section-counter'));

		const body = append(section, $('div.vs-section-body')) as HTMLElement;

		this.sectionBodies.set(def.id, body);
		this.sectionChevrons.set(def.id, chevron);

		const expanded = this.getSectionExpanded(def);
		this.applySectionExpanded(def.id, expanded);

		header.addEventListener('click', () => {
			const isExpanded = !body.classList.contains('collapsed');
			this.applySectionExpanded(def.id, !isExpanded);
			this.storageService.store(STORAGE_KEY_SECTION_PREFIX + def.id, !isExpanded, StorageScope.PROFILE, StorageTarget.USER);
		});

		// Поместим counter в нужное место — после title
		header.appendChild(counter);

		// Counter ref в state, чтобы наполнять из секций
		if (def.id === 'mcp') { this.mcpCounter = counter; }
		if (def.id === 'skills') { this.skillsCounter = counter; }

		return body;
	}

	private getSectionExpanded(def: SectionDefaults): boolean {
		return this.storageService.getBoolean(STORAGE_KEY_SECTION_PREFIX + def.id, StorageScope.PROFILE, def.defaultExpanded);
	}

	private applySectionExpanded(id: SectionId, expanded: boolean): void {
		const body = this.sectionBodies.get(id);
		const chevron = this.sectionChevrons.get(id);
		if (!body || !chevron) { return; }
		if (expanded) {
			body.classList.remove('collapsed');
			chevron.textContent = '▾';
		} else {
			body.classList.add('collapsed');
			chevron.textContent = '▸';
		}
	}

	// ── Провайдеры ───────────────────────────────────────────────

	private renderProvidersBody(body: HTMLElement): void {
		this.providerRows = [];

		for (const provider of PROVIDERS) {
			const row = append(body, $('div.vs-provider'));

			const head = append(row, $('div.vs-provider-head'));
			const nameEl = append(head, $('span.vs-provider-name'));
			nameEl.textContent = provider.label;

			const statusEl = append(head, $('span.vs-status.vs-status-warn'));
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

			if (provider.requiresApiKey) {
				const testBtn = append(buttons, $('button.vs-btn')) as HTMLButtonElement;
				testBtn.textContent = 'Test';
				testBtn.title = `Проверить подключение к ${provider.label}`;
				testBtn.addEventListener('click', () => {
					this.onTestProvider(provider).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
				});

				const deleteBtn = append(buttons, $('button.vs-btn.vs-btn-danger')) as HTMLButtonElement;
				deleteBtn.textContent = 'Delete';
				deleteBtn.title = `Удалить API-ключ ${provider.label}`;
				deleteBtn.addEventListener('click', () => {
					this.onDeleteApiKey(provider).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
				});
			}

			this.providerRows.push({ row: provider, statusEl });
		}
	}

	// ── Эндпоинты ─────────────────────────────────────────────────

	private renderEndpointsBody(body: HTMLElement): void {
		this.renderEndpointInput(body, 'LM Studio (локально)', VibecoderConfigKeys.LmStudioEndpoint, VIBECODER_LMSTUDIO_DEFAULT_URL);
		this.renderEndpointInput(body, 'Polza.ai', VibecoderConfigKeys.PolzaEndpoint, VIBECODER_POLZA_DEFAULT_URL);
	}

	private renderEndpointInput(parent: HTMLElement, label: string, configKey: string, defaultUrl: string): void {
		const row = append(parent, $('div.vs-endpoint-row'));
		const labelEl = append(row, $('label.vs-endpoint-label'));
		labelEl.textContent = label;
		const input = append(row, $('input.vs-endpoint-input')) as HTMLInputElement;
		input.type = 'text';
		input.value = this.configurationService.getValue<string>(configKey) ?? defaultUrl;
		input.placeholder = defaultUrl;
		input.addEventListener('change', () => {
			const value = input.value.trim() || defaultUrl;
			this.configurationService.updateValue(configKey, value, ConfigurationTarget.USER)
				.then(() => this.notify(`${label}: ${value}`))
				.catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
		});
	}

	// ── Навыки ───────────────────────────────────────────────────

	private renderSkillsBody(body: HTMLElement): void {
		const hint = append(body, $('div.vs-section-hint'));
		hint.textContent = '32 встроенных навыка + workspace .vibecoder/skills/<name>/SKILL.md';

		const searchRow = append(body, $('div.vs-search-row'));
		const search = append(searchRow, $('input.vs-search-input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Поиск по имени...';
		search.addEventListener('input', () => {
			this.skillsSearchValue = search.value.toLowerCase().trim();
			this.refreshSkillsList();
		});

		const listEl = append(body, $('div.vs-list-scroll'));
		this.skillsListEl = listEl;
		this.refreshSkillsList();

		const buttons = append(body, $('div.vs-button-row'));
		const reloadBtn = append(buttons, $('button.vs-btn')) as HTMLButtonElement;
		reloadBtn.textContent = 'Перезагрузить';
		reloadBtn.addEventListener('click', () => {
			this.commandService.executeCommand('vibecoder.reloadSkills')
				.catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
		});
	}

	private refreshSkillsList(): void {
		if (!this.skillsListEl) { return; }
		while (this.skillsListEl.firstChild) {
			this.skillsListEl.removeChild(this.skillsListEl.firstChild);
		}
		const allSkills = this.skillsService.getAllSkills();
		const filtered = this.skillsSearchValue
			? allSkills.filter(s =>
				s.id.toLowerCase().includes(this.skillsSearchValue) ||
				(s.metadata.description ?? '').toLowerCase().includes(this.skillsSearchValue))
			: allSkills;

		if (this.skillsCounter) {
			this.skillsCounter.textContent = filtered.length === allSkills.length
				? `${allSkills.length}`
				: `${filtered.length}/${allSkills.length}`;
		}

		if (filtered.length === 0) {
			const empty = append(this.skillsListEl, $('div.vs-empty'));
			empty.textContent = this.skillsSearchValue ? 'Ничего не найдено.' : 'Skills не найдены.';
			return;
		}

		// Сортируем: workspace сверху, потом built-in алфавитом
		const sorted = [...filtered].sort((a, b) => {
			const aWorkspace = (a.metadata.source === 'workspace') ? 0 : 1;
			const bWorkspace = (b.metadata.source === 'workspace') ? 0 : 1;
			if (aWorkspace !== bWorkspace) { return aWorkspace - bWorkspace; }
			return a.id.localeCompare(b.id);
		});
		for (const skill of sorted) {
			const item = append(this.skillsListEl, $('div.vs-skill-item'));
			const nameEl = append(item, $('span.vs-skill-name'));
			nameEl.textContent = skill.id;
			nameEl.title = skill.metadata.description ?? '';
			const isWorkspace = skill.metadata.source === 'workspace';
			const sourceEl = append(item, $(isWorkspace ? 'span.vs-skill-source.vs-skill-source-workspace' : 'span.vs-skill-source'));
			sourceEl.textContent = isWorkspace ? 'workspace' : 'built-in';
		}
	}

	// ── MCP-серверы ───────────────────────────────────────────────

	private renderMcpBody(body: HTMLElement): void {
		const hint = append(body, $('div.vs-section-hint'));
		hint.textContent = `15 готовых шаблонов. Нажми "Configure" — введи токены — готово.`;

		const searchRow = append(body, $('div.vs-search-row'));
		const search = append(searchRow, $('input.vs-search-input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Поиск (github, supabase, ollama...)';
		search.addEventListener('input', () => {
			this.mcpSearchValue = search.value.toLowerCase().trim();
			this.refreshMcpList();
		});

		const filterRow = append(body, $('div.vs-filter-row'));
		const filterAll = this.makeFilterChip(filterRow, 'all', 'Все');
		const filterConfigured = this.makeFilterChip(filterRow, 'configured', 'Подключённые');
		const filterNot = this.makeFilterChip(filterRow, 'not-configured', 'Не подключённые');

		this.mcpStatusElements = new Map();
		this.mcpListEl = append(body, $('div.vs-list-scroll'));
		this.refreshMcpList();

		// helper для активации chip по выбранному фильтру
		const updateActiveChip = () => {
			[filterAll, filterConfigured, filterNot].forEach(c => c.classList.remove('active'));
			if (this.mcpFilter === 'all') { filterAll.classList.add('active'); }
			else if (this.mcpFilter === 'configured') { filterConfigured.classList.add('active'); }
			else { filterNot.classList.add('active'); }
		};
		updateActiveChip();
		filterAll.addEventListener('click', () => { this.mcpFilter = 'all'; updateActiveChip(); this.refreshMcpList(); });
		filterConfigured.addEventListener('click', () => { this.mcpFilter = 'configured'; updateActiveChip(); this.refreshMcpList(); });
		filterNot.addEventListener('click', () => { this.mcpFilter = 'not-configured'; updateActiveChip(); this.refreshMcpList(); });
	}

	private makeFilterChip(parent: HTMLElement, value: McpFilter, label: string): HTMLButtonElement {
		const chip = append(parent, $('button.vs-filter-chip')) as HTMLButtonElement;
		chip.textContent = label;
		(chip as any).dataset.filter = value;
		return chip;
	}

	private refreshMcpList(): void {
		if (!this.mcpListEl) { return; }
		while (this.mcpListEl.firstChild) {
			this.mcpListEl.removeChild(this.mcpListEl.firstChild);
		}
		this.mcpStatusElements.clear();

		const filtered = BUILTIN_MCP_TEMPLATES.filter(t => {
			// поиск
			if (this.mcpSearchValue) {
				const hay = `${t.id} ${t.displayName} ${t.description}`.toLowerCase();
				if (!hay.includes(this.mcpSearchValue)) { return false; }
			}
			// фильтр статуса
			const isConfigured = this.mcpConfiguredIds.has(t.id);
			if (this.mcpFilter === 'configured' && !isConfigured) { return false; }
			if (this.mcpFilter === 'not-configured' && isConfigured) { return false; }
			return true;
		});

		if (this.mcpCounter) {
			this.mcpCounter.textContent = filtered.length === BUILTIN_MCP_TEMPLATES.length
				? `${BUILTIN_MCP_TEMPLATES.length}`
				: `${filtered.length}/${BUILTIN_MCP_TEMPLATES.length}`;
		}

		if (filtered.length === 0) {
			const empty = append(this.mcpListEl, $('div.vs-empty'));
			empty.textContent = 'Ничего не найдено.';
			return;
		}

		for (const template of filtered) {
			this.renderMcpItem(this.mcpListEl, template);
		}
	}

	private renderMcpItem(parent: HTMLElement, template: VibecoderMcpTemplate): void {
		const item = append(parent, $('div.vs-mcp-item'));

		const head = append(item, $('div.vs-mcp-head'));
		const name = append(head, $('div.vs-mcp-name'));
		name.textContent = `${template.icon} ${template.displayName}`;

		const typeBadge = append(head, $('span.vs-mcp-type'));
		typeBadge.textContent = template.type;

		const isConfigured = this.mcpConfiguredIds.has(template.id);
		const statusEl = append(head, $(isConfigured ? 'span.vs-status.vs-status-ok' : 'span.vs-status.vs-status-warn'));
		statusEl.textContent = isConfigured ? 'configured' : 'not configured';
		this.mcpStatusElements.set(template.id, statusEl);

		const desc = append(item, $('div.vs-mcp-desc'));
		desc.textContent = template.description;

		const buttons = append(item, $('div.vs-button-row'));

		const configBtn = append(buttons, $('button.vs-btn.vs-btn-primary')) as HTMLButtonElement;
		configBtn.textContent = isConfigured ? 'Reconfigure' : 'Configure';
		configBtn.title = `Подключить ${template.displayName}: опрос env-переменных и запись в .vibecoder/mcp.json`;
		configBtn.addEventListener('click', () => {
			this.onConfigureMcp(template).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
		});

		if (template.docsUrl) {
			const docsBtn = append(buttons, $('button.vs-btn')) as HTMLButtonElement;
			docsBtn.textContent = 'Docs';
			docsBtn.title = template.docsUrl;
			docsBtn.addEventListener('click', () => {
				this.openerService.open(URI.parse(template.docsUrl!), { openExternal: true }).catch(() => { });
			});
		}

		if (isConfigured) {
			const removeBtn = append(buttons, $('button.vs-btn.vs-btn-danger')) as HTMLButtonElement;
			removeBtn.textContent = 'Remove';
			removeBtn.title = `Удалить ${template.id} из .vibecoder/mcp.json`;
			removeBtn.addEventListener('click', () => {
				this.onRemoveMcp(template).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
			});
		}
	}

	private async onConfigureMcp(template: VibecoderMcpTemplate): Promise<void> {
		const envValues: Record<string, string> = {};
		for (const required of template.requiredEnv ?? []) {
			const value = await this.quickInputService.input({
				password: required.name.includes('TOKEN') || required.name.includes('KEY') || required.name.includes('SECRET'),
				placeHolder: required.name,
				prompt: required.description,
				value: '',
			});
			if (value === undefined) { return; }
			envValues[required.name] = value.trim();
		}

		const mcpUri = this.getMcpJsonUri();
		if (!mcpUri) {
			this.notify('Откройте папку (workspace) — без неё нельзя сохранить .vibecoder/mcp.json');
			return;
		}

		let current: any = { mcpServers: {} };
		try {
			if (await this.fileService.exists(mcpUri)) {
				const content = await this.fileService.readFile(mcpUri);
				current = JSON.parse(content.value.toString());
				if (!current.mcpServers) { current.mcpServers = {}; }
			}
		} catch (e) {
			this.notify(`Ошибка чтения .vibecoder/mcp.json: ${(e as Error).message}. Создаём заново.`);
			current = { mcpServers: {} };
		}

		current.mcpServers[template.id] = templateToConfig(template, envValues);

		const dirUri = URI.joinPath(mcpUri, '..');
		try {
			if (!(await this.fileService.exists(dirUri))) {
				await this.fileService.createFolder(dirUri);
			}
			const json = JSON.stringify(current, null, 2) + '\n';
			await this.fileService.writeFile(mcpUri, VSBuffer.fromString(json));
			this.notify(`✅ ${template.displayName} добавлен в .vibecoder/mcp.json`);
			await this.refreshMcpConfigured();
		} catch (e) {
			this.notify(`Ошибка записи: ${(e as Error).message}`);
		}
	}

	private async onRemoveMcp(template: VibecoderMcpTemplate): Promise<void> {
		const mcpUri = this.getMcpJsonUri();
		if (!mcpUri) { return; }

		try {
			if (!(await this.fileService.exists(mcpUri))) {
				this.notify('.vibecoder/mcp.json ещё не создан');
				return;
			}
			const content = await this.fileService.readFile(mcpUri);
			const current = JSON.parse(content.value.toString());
			if (current.mcpServers && current.mcpServers[template.id]) {
				delete current.mcpServers[template.id];
				const json = JSON.stringify(current, null, 2) + '\n';
				await this.fileService.writeFile(mcpUri, VSBuffer.fromString(json));
				this.notify(`${template.displayName} удалён`);
				await this.refreshMcpConfigured();
			}
		} catch (e) {
			this.notify(`Ошибка: ${(e as Error).message}`);
		}
	}

	private async refreshMcpConfigured(): Promise<void> {
		const mcpUri = this.getMcpJsonUri();
		const configured = new Set<string>();
		if (mcpUri) {
			try {
				if (await this.fileService.exists(mcpUri)) {
					const content = await this.fileService.readFile(mcpUri);
					const current = JSON.parse(content.value.toString());
					if (current.mcpServers) {
						for (const id of Object.keys(current.mcpServers)) {
							configured.add(id);
						}
					}
				}
			} catch {
				// игнор
			}
		}
		this.mcpConfiguredIds = configured;
		// Перерисуем список (статусы изменились)
		this.refreshMcpList();
	}

	private getMcpJsonUri(): URI | undefined {
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) { return undefined; }
		return URI.joinPath(folders[0].uri, '.vibecoder', 'mcp.json');
	}

	// ── Действия ──────────────────────────────────────────────────

	private renderActionsBody(body: HTMLElement): void {
		const buttons = append(body, $('div.vs-button-row'));
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

	// ── Refresh providers ─────────────────────────────────────────

	private async refreshProviders(): Promise<void> {
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
						statusEl.title = 'Нажми Set API Key';
					}
				}
			} catch (e) {
				this.setStatus(statusEl, 'err', 'ошибка');
				statusEl.title = e instanceof Error ? e.message : String(e);
			}
		}
	}

	private setStatus(el: HTMLElement, kind: 'ok' | 'warn' | 'err', text: string): void {
		el.className = 'vs-status';
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
			prompt: 'Ключ сохраняется в системном keychain.',
		});
		if (!apiKey) { return; }
		await this.llmRouter.setApiKey(provider.id, apiKey.trim());
		this.notify(`API-ключ для ${provider.label} сохранён ✅`);
		await this.refreshProviders();
	}

	private async onDeleteApiKey(provider: ProviderRow): Promise<void> {
		await this.llmRouter.deleteApiKey(provider.id);
		this.notify(`API-ключ для ${provider.label} удалён.`);
		await this.refreshProviders();
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
			this.notify(`✅ ${provider.label}: моделей ${models.length}`);
			await this.refreshProviders();
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
