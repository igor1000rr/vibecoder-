/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vibecoder Settings View — отдельная панель слева в Activity Bar.
 *
 * Разделы:
 *  - Провайдеры LLM: 6 строк со статусом + Set Key / Test / Delete
 *  - Эндпоинты: LM Studio + Polza.ai (редактируемые)
 *  - Навыки (23 built-in + workspace): badge источника, Reload
 *  - MCP-серверы (15 шаблонов): Configure → опрос env → запись в .vibecoder/mcp.json
 *  - Действия: Open NIT / Welcome / Apply Clipboard
 *  - Footer
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

.vibecoder-settings-view .vs-section-hint {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	margin: 4px 0 8px 0;
	font-style: italic;
	line-height: 1.4;
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

.vibecoder-settings-view .vs-skill-empty {
	font-style: italic;
	color: var(--vscode-descriptionForeground);
	font-size: 11.5px;
}

.vibecoder-settings-view .vs-skills-scroll {
	max-height: 240px;
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

.vibecoder-settings-view .vs-mcp-status {
	font-size: 10.5px;
	font-family: var(--vscode-editor-font-family);
	padding: 1px 6px;
	border-radius: 3px;
}

.vibecoder-settings-view .vs-mcp-scroll {
	max-height: 380px;
	overflow-y: auto;
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

export class VibecoderSettingsView extends ViewPane {

	static readonly ID = VIBECODER_SETTINGS_VIEW_ID;

	private rootEl: HTMLElement | undefined;
	private providerRows: ProviderRowEls[] = [];
	private skillsListEl: HTMLElement | undefined;
	private mcpStatusElements = new Map<string, HTMLElement>();

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
		this.renderMcpSection(container);
		this.renderActionsSection(container);
		this.renderFooter(container);

		this.refresh().catch(err => console.warn('[Vibecoder Settings] refresh failed:', err));
		this.refreshMcpStatuses().catch(() => { });

		// Перерисовать skills при reload через сервис
		this._register(this.skillsService.onDidChangeSkills(() => this.refreshSkillsList()));
	}

	// ── Провайдеры ───────────────────────────────────────────────

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

			if (provider.requiresApiKey) {
				const deleteBtn = append(buttons, $('button.vs-btn.vs-btn-danger')) as HTMLButtonElement;
				deleteBtn.textContent = 'Delete';
				deleteBtn.title = `Удалить API-ключ ${provider.label} из keychain`;
				deleteBtn.addEventListener('click', () => {
					this.onDeleteApiKey(provider).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
				});
			}

			this.providerRows.push({ row: provider, statusEl });
		}
	}

	// ── Эндпоинты ─────────────────────────────────────────────────

	private renderEndpointsSection(parent: HTMLElement): void {
		const section = append(parent, $('div.vs-section'));
		const title = append(section, $('div.vs-section-title'));
		title.textContent = 'Эндпоинты';

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
					.then(() => this.notify(`LM Studio endpoint: ${value}`))
					.catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
			});
		}

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
					.then(() => this.notify(`Polza.ai endpoint: ${value}`))
					.catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
			});
		}
	}

	// ── Навыки ───────────────────────────────────────────────────

	private renderSkillsSection(parent: HTMLElement): void {
		const section = append(parent, $('div.vs-section'));
		const title = append(section, $('div.vs-section-title'));
		title.textContent = 'Навыки (Skills)';

		const hint = append(section, $('div.vs-section-hint'));
		hint.textContent = '23 built-in доступны сразу. Workspace .vibecoder/skills/<name>/SKILL.md перебивают одноимённые.';

		const listEl = append(section, $('div.vs-skills-scroll'));
		this.skillsListEl = listEl;
		this.refreshSkillsList();

		const buttons = append(section, $('div.vs-button-row'));
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
		const skills = this.skillsService.getAllSkills();
		if (skills.length === 0) {
			const empty = append(this.skillsListEl, $('div.vs-skill-empty'));
			empty.textContent = 'Skills не найдены.';
			return;
		}
		// Сортируем: workspace сверху, потом built-in алфавитом
		const sorted = [...skills].sort((a, b) => {
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

	private renderMcpSection(parent: HTMLElement): void {
		const section = append(parent, $('div.vs-section'));
		const title = append(section, $('div.vs-section-title'));
		title.textContent = 'MCP-серверы';

		const hint = append(section, $('div.vs-section-hint'));
		hint.textContent = '15 шаблонов. stdio пока в beta (нужен electron-main канал). HTTP/SSE работают.';

		this.mcpStatusElements = new Map();

		const scroll = append(section, $('div.vs-mcp-scroll'));

		for (const template of BUILTIN_MCP_TEMPLATES) {
			const item = append(scroll, $('div.vs-mcp-item'));

			const head = append(item, $('div.vs-mcp-head'));
			const name = append(head, $('div.vs-mcp-name'));
			name.textContent = `${template.icon} ${template.displayName}`;

			const typeBadge = append(head, $('span.vs-mcp-type'));
			typeBadge.textContent = template.type;

			const statusEl = append(head, $('span.vs-mcp-status.vs-status-warn'));
			statusEl.textContent = '...';
			this.mcpStatusElements.set(template.id, statusEl);

			const desc = append(item, $('div.vs-mcp-desc'));
			desc.textContent = template.description;

			const buttons = append(item, $('div.vs-button-row'));

			const configBtn = append(buttons, $('button.vs-btn.vs-btn-primary')) as HTMLButtonElement;
			configBtn.textContent = 'Configure';
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

			const removeBtn = append(buttons, $('button.vs-btn.vs-btn-danger')) as HTMLButtonElement;
			removeBtn.textContent = 'Remove';
			removeBtn.title = `Удалить ${template.id} из .vibecoder/mcp.json (env-токены НЕ удаляются)`;
			removeBtn.addEventListener('click', () => {
				this.onRemoveMcp(template).catch(err => this.notify('Ошибка: ' + (err?.message ?? err)));
			});
		}
	}

	private async onConfigureMcp(template: VibecoderMcpTemplate): Promise<void> {
		// Опрашиваем все требуемые env-переменные
		const envValues: Record<string, string> = {};
		for (const required of template.requiredEnv ?? []) {
			const value = await this.quickInputService.input({
				password: required.name.includes('TOKEN') || required.name.includes('KEY') || required.name.includes('SECRET'),
				placeHolder: required.name,
				prompt: required.description,
				value: '',
			});
			if (value === undefined) { return; } // юзер отменил
			envValues[required.name] = value.trim();
		}

		// Загружаем текущий mcp.json (если есть)
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

		// Добавляем/обновляем сервер
		current.mcpServers[template.id] = templateToConfig(template, envValues);

		// Записываем
		const dirUri = URI.joinPath(mcpUri, '..');
		try {
			if (!(await this.fileService.exists(dirUri))) {
				await this.fileService.createFolder(dirUri);
			}
			const json = JSON.stringify(current, null, 2) + '\n';
			await this.fileService.writeFile(mcpUri, VSBuffer.fromString(json));
			this.notify(`✅ ${template.displayName} добавлен в .vibecoder/mcp.json`);
			await this.refreshMcpStatuses();
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
				this.notify(`${template.displayName} удалён из .vibecoder/mcp.json`);
				await this.refreshMcpStatuses();
			} else {
				this.notify(`${template.displayName} не был настроен`);
			}
		} catch (e) {
			this.notify(`Ошибка: ${(e as Error).message}`);
		}
	}

	private async refreshMcpStatuses(): Promise<void> {
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
		for (const [id, el] of this.mcpStatusElements) {
			if (configured.has(id)) {
				el.className = 'vs-mcp-status vs-status-ok';
				el.textContent = 'configured';
			} else {
				el.className = 'vs-mcp-status vs-status-warn';
				el.textContent = 'not configured';
			}
		}
	}

	private getMcpJsonUri(): URI | undefined {
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) { return undefined; }
		return URI.joinPath(folders[0].uri, '.vibecoder', 'mcp.json');
	}

	// ── Действия ──────────────────────────────────────────────────

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

	// ── Refresh providers ─────────────────────────────────────────

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
			prompt: 'Ключ сохраняется в системном keychain.',
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
			this.notify(`✅ ${provider.label}: моделей ${models.length}`);
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
