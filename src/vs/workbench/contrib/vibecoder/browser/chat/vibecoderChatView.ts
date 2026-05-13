/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { Extensions, IViewContainersRegistry, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../../common/views.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../../browser/parts/views/viewPaneContainer.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { IVibecoderLLMRouter } from '../llm/llmRouter.js';
import { VibecoderChatMessage, VibecoderModelInfo } from '../llm/llmProvider.js';
import { IVibecoderSkillsService } from '../skills/skillsService.js';
import { VibecoderProviderId } from '../../common/vibecoder.js';
import { buildChatSystemPrompt } from '../prompts/systemPrompts.js';
import { parseSearchReplaceBlocks } from '../composer/composerService.js';
import { renderApplyPanel } from './applyPanel.js';

export const VIBECODER_VIEW_CONTAINER_ID = 'workbench.view.vibecoder';
export const VIBECODER_CHAT_VIEW_ID = 'vibecoder.nitView';

const ACTIVE_FILE_MAX_CHARS = 30000;
const SELECTION_MAX_CHARS = 10000;
const OPEN_TABS_LIMIT = 20;

const nitViewIcon = registerIcon(
	'vibecoder-nit-icon',
	Codicon.sparkle,
	localize('vibecoderNitIcon', 'NIT — AI-ассистент Vibecoder.')
);

interface ActiveFileInfo {
	readonly fileName: string;
	readonly lang: string;
	readonly content: string;
	readonly truncated: boolean;
	readonly selection?: {
		readonly text: string;
		readonly startLine: number;
		readonly endLine: number;
	};
}

/**
 * Очищает элемент от детей. Безопаснее `el.innerHTML = ''` в окружении Trusted Types.
 */
function clearChildren(el: HTMLElement): void {
	while (el.firstChild) {
		el.removeChild(el.firstChild);
	}
}

/**
 * Стандартные VS Code-style стили для NIT-сайдбара.
 * Все цвета — через --vscode-* CSS-переменные. Без анимаций, неона, частиц.
 *
 * Trusted Types safe: инжектится как textContent в style-тэг.
 */
const NIT_VIEW_STYLES = `
.vibecoder-nit-view .nit-topbar {
	flex-shrink: 0;
	padding: 8px 12px;
	border-bottom: 1px solid var(--vscode-panel-border);
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.vibecoder-nit-view .nit-brand {
	display: flex;
	align-items: baseline;
	gap: 8px;
}

.vibecoder-nit-view .nit-brand-text {
	font-weight: 600;
	font-size: 13px;
	color: var(--vscode-foreground);
	letter-spacing: 0.5px;
}

.vibecoder-nit-view .nit-brand-tag {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
}

/* ── Welcome-секция (внутри сайдбара) ───────────────────────────── */
.vibecoder-nit-view .nit-welcome {
	flex: 1;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 24px 16px;
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.vibecoder-nit-view .nit-welcome-hero {
	text-align: center;
	padding: 8px 0 8px 0;
}

.vibecoder-nit-view .nit-welcome-title {
	font-size: 18px;
	font-weight: 600;
	color: var(--vscode-foreground);
	margin: 0 0 4px 0;
}

.vibecoder-nit-view .nit-welcome-subtitle {
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.5;
	margin: 0;
}

/* ── Messages контейнер ────────────────────────────────────────── */
.vibecoder-nit-view .nit-messages {
	flex: 1;
	overflow-y: auto;
	padding: 12px;
	gap: 10px;
	display: none;
	flex-direction: column;
}

/* ── Action items (как в Welcome page VS Code) ─────────────────── */
.vibecoder-nit-view .nit-actions {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.vibecoder-nit-view .nit-action {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 8px 10px;
	border-radius: 4px;
	cursor: pointer;
	color: var(--vscode-textLink-foreground);
	transition: background-color 0.1s ease;
}

.vibecoder-nit-view .nit-action:hover {
	background: var(--vscode-list-hoverBackground);
	color: var(--vscode-textLink-activeForeground);
}

.vibecoder-nit-view .nit-action-icon {
	font-size: 14px;
	line-height: 18px;
	width: 18px;
	text-align: center;
	flex-shrink: 0;
}

.vibecoder-nit-view .nit-action-body {
	flex: 1;
	min-width: 0;
}

.vibecoder-nit-view .nit-action-label {
	font-size: 12.5px;
	line-height: 18px;
}

.vibecoder-nit-view .nit-action-desc {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	margin-top: 2px;
	line-height: 1.4;
}

/* ── Tips footer ───────────────────────────────────────────────── */
.vibecoder-nit-view .nit-tips {
	margin-top: auto;
	padding-top: 12px;
	border-top: 1px solid var(--vscode-panel-border);
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.7;
}

.vibecoder-nit-view .nit-tip-kbd {
	display: inline-block;
	padding: 1px 6px;
	background: var(--vscode-keybindingLabel-background);
	border: 1px solid var(--vscode-keybindingLabel-border);
	color: var(--vscode-keybindingLabel-foreground);
	border-radius: 3px;
	font-size: 10.5px;
	font-family: var(--vscode-editor-font-family);
}

/* ── Bottom bar (Cursor-style) ─────────────────────────────────── */
.vibecoder-nit-view .nit-bottombar {
	flex-shrink: 0;
	border-top: 1px solid var(--vscode-panel-border);
	padding: 8px 12px 10px 12px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.vibecoder-nit-view .nit-active-file {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	padding: 2px 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.vibecoder-nit-view .nit-input {
	background: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	border: 1px solid var(--vscode-input-border);
	border-radius: 2px;
	padding: 6px 8px;
	resize: vertical;
	font-family: inherit;
	font-size: inherit;
	outline: none;
	min-height: 60px;
}

.vibecoder-nit-view .nit-input:focus {
	border-color: var(--vscode-focusBorder);
}

.vibecoder-nit-view .nit-button-row {
	display: flex;
	gap: 6px;
	justify-content: flex-end;
}

.vibecoder-nit-view .nit-selectors {
	display: flex;
	gap: 6px;
	margin-top: 2px;
}

.vibecoder-nit-view .nit-status {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	padding-top: 2px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
`;

/**
 * NIT — AI-сайдбар Vibecoder. Регистрируется в AuxiliaryBar (правая панель).
 *
 * Стандартный VS Code-style дизайн без cyberpunk-эффектов. Все цвета — через
 * --vscode-* переменные.
 *
 * Layout (Cursor-style):
 *   topbar (бренд + новый чат)
 *   ↓
 *   welcome / chat (главная зона)
 *   ↓
 *   bottombar (файл / input / кнопки / провайдер+модель / статус)
 */
export class NitChatView extends ViewPane {

	static readonly ID = VIBECODER_CHAT_VIEW_ID;

	private welcomeContainer!: HTMLElement;
	private messagesContainer!: HTMLElement;
	private inputElement!: HTMLTextAreaElement;
	private sendButton!: HTMLButtonElement;
	private stopButton!: HTMLButtonElement;
	private statusLine!: HTMLElement;
	private providerSelect!: HTMLSelectElement;
	private modelSelect!: HTMLSelectElement;
	private activeFileBadge!: HTMLElement;

	private readonly history: VibecoderChatMessage[] = [];
	private abortController: AbortController | undefined;
	private modelsCache = new Map<VibecoderProviderId, VibecoderModelInfo[]>();

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
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('vibecoder-nit-view');
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';
		container.style.fontFamily = 'var(--vscode-font-family)';
		container.style.fontSize = 'var(--vscode-font-size)';
		container.style.background = 'var(--vscode-sideBar-background)';

		const styleEl = append(container, $('style'));
		styleEl.textContent = NIT_VIEW_STYLES;

		// ── Top bar ─────────────────────────────────────────────────
		const topBar = append(container, $('div.nit-topbar'));

		const brand = append(topBar, $('div.nit-brand'));
		const brandText = append(brand, $('span.nit-brand-text'));
		brandText.textContent = 'NIT';
		const brandTag = append(brand, $('span.nit-brand-tag'));
		brandTag.textContent = 'AI-ассистент';

		const newChatBtn = append(topBar, $('button')) as HTMLButtonElement;
		newChatBtn.textContent = '+ Новый';
		newChatBtn.title = 'Начать новый чат';
		this.styleButton(newChatBtn, 'ghost');
		newChatBtn.addEventListener('click', () => this.resetConversation());

		// ── Главная зона ────────────────────────────────────────────
		this.welcomeContainer = append(container, $('div'));
		this.renderWelcome();

		this.messagesContainer = append(container, $('div.nit-messages'));

		// ── Bottom bar ──────────────────────────────────────────────
		const bottomBar = append(container, $('div.nit-bottombar'));

		this.activeFileBadge = append(bottomBar, $('div.nit-active-file'));
		this.updateActiveFileBadge();
		this._register(this.editorService.onDidActiveEditorChange(() => this.updateActiveFileBadge()));

		this.inputElement = append(bottomBar, $('textarea.nit-input')) as HTMLTextAreaElement;
		this.inputElement.placeholder = 'Спроси NIT что-нибудь...  (Enter — отправить, Shift+Enter — перенос)';
		this.inputElement.rows = 3;

		this.inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendCurrent();
			}
		});

		const buttonRow = append(bottomBar, $('div.nit-button-row'));

		this.stopButton = append(buttonRow, $('button')) as HTMLButtonElement;
		this.stopButton.textContent = 'Стоп';
		this.styleButton(this.stopButton, 'secondary');
		this.stopButton.disabled = true;
		this.stopButton.addEventListener('click', () => this.abortController?.abort());

		this.sendButton = append(buttonRow, $('button')) as HTMLButtonElement;
		this.sendButton.textContent = 'Отправить';
		this.styleButton(this.sendButton, 'primary');
		this.sendButton.addEventListener('click', () => this.sendCurrent());

		const selectorsRow = append(bottomBar, $('div.nit-selectors'));

		this.providerSelect = append(selectorsRow, $('select')) as HTMLSelectElement;
		this.styleSelect(this.providerSelect);
		this.providerSelect.style.flex = '1';
		for (const p of [
			{ id: 'lmstudio', label: 'LM Studio' },
			{ id: 'anthropic', label: 'Anthropic' },
			{ id: 'openai', label: 'OpenAI' },
			{ id: 'gemini', label: 'Gemini' },
			{ id: 'openrouter', label: 'OpenRouter' },
		] as Array<{ id: VibecoderProviderId; label: string }>) {
			const opt = append(this.providerSelect, $('option')) as HTMLOptionElement;
			opt.value = p.id;
			opt.textContent = p.label;
		}

		this.modelSelect = append(selectorsRow, $('select')) as HTMLSelectElement;
		this.styleSelect(this.modelSelect);
		this.modelSelect.style.flex = '2';

		this.providerSelect.addEventListener('change', () => this.onProviderChange());

		this.statusLine = append(bottomBar, $('div.nit-status'));
		this.statusLine.textContent = 'Инициализация...';

		this.onProviderChange().catch(err => {
			this.statusLine.textContent = `Ошибка инициализации: ${err?.message ?? err}`;
		});
	}

	/**
	 * Welcome-секция внутри сайдбара. Стандартный VS Code стиль — заголовок,
	 * описание, список action-items как ссылки, tips внизу.
	 */
	private renderWelcome(): void {
		clearChildren(this.welcomeContainer);
		this.welcomeContainer.classList.add('nit-welcome');

		const hero = append(this.welcomeContainer, $('div.nit-welcome-hero'));
		const title = append(hero, $('div.nit-welcome-title'));
		title.textContent = 'NIT';
		const subtitle = append(hero, $('div.nit-welcome-subtitle'));
		subtitle.textContent = 'AI-ассистент Vibecoder. Локальные модели и приватность.';

		const actions: Array<{ icon: string; label: string; description: string; commandId: string }> = [
			{
				icon: '🖥',
				label: 'Подключить LM Studio',
				description: 'Локальная модель — приватно и быстро',
				commandId: 'vibecoder.testLMStudio',
			},
			{
				icon: '🔑',
				label: 'Добавить API-ключ',
				description: 'Anthropic, OpenAI, Gemini, OpenRouter',
				commandId: 'vibecoder.setApiKey',
			},
			{
				icon: '📋',
				label: 'Применить из буфера',
				description: 'search/replace блоки в код',
				commandId: 'vibecoder.applyFromClipboard',
			},
			{
				icon: '🧠',
				label: 'Перезагрузить навыки',
				description: '.vibecoder/skills/',
				commandId: 'vibecoder.reloadSkills',
			},
		];

		const actionsList = append(this.welcomeContainer, $('div.nit-actions'));
		for (const action of actions) {
			const item = append(actionsList, $('div.nit-action'));
			item.setAttribute('role', 'button');
			item.setAttribute('tabindex', '0');

			const iconEl = append(item, $('div.nit-action-icon'));
			iconEl.textContent = action.icon;

			const body = append(item, $('div.nit-action-body'));
			const labelEl = append(body, $('div.nit-action-label'));
			labelEl.textContent = action.label;
			const descEl = append(body, $('div.nit-action-desc'));
			descEl.textContent = action.description;

			const handler = () => {
				this.commandService.executeCommand(action.commandId).catch(err => {
					console.error('NIT action failed:', err);
				});
			};
			item.addEventListener('click', handler);
			item.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					handler();
				}
			});
		}

		// Tips
		const tips = append(this.welcomeContainer, $('div.nit-tips'));

		const tip1 = append(tips, $('div'));
		tip1.appendChild(document.createTextNode('Нажми '));
		const kbd1 = append(tip1, $('span.nit-tip-kbd'));
		kbd1.textContent = 'Ctrl+Shift+P';
		tip1.appendChild(document.createTextNode(' и набери «Vibecoder» для списка команд.'));

		const tip2 = append(tips, $('div'));
		tip2.textContent = 'Выдели код в редакторе — NIT сфокусируется на нём.';

		const tip3 = append(tips, $('div'));
		tip3.textContent = 'Напиши вопрос снизу и нажми Enter.';
	}

	private styleSelect(el: HTMLSelectElement): void {
		el.style.background = 'var(--vscode-dropdown-background)';
		el.style.color = 'var(--vscode-dropdown-foreground)';
		el.style.border = '1px solid var(--vscode-dropdown-border)';
		el.style.borderRadius = '2px';
		el.style.padding = '3px 6px';
		el.style.fontFamily = 'inherit';
		el.style.fontSize = '12px';
		el.style.cursor = 'pointer';
	}

	private styleButton(btn: HTMLButtonElement, variant: 'primary' | 'secondary' | 'ghost'): void {
		btn.style.padding = '4px 12px';
		btn.style.border = 'none';
		btn.style.borderRadius = '2px';
		btn.style.cursor = 'pointer';
		btn.style.fontFamily = 'inherit';
		btn.style.fontSize = '12px';

		if (variant === 'primary') {
			btn.style.background = 'var(--vscode-button-background)';
			btn.style.color = 'var(--vscode-button-foreground)';
		} else if (variant === 'secondary') {
			btn.style.background = 'var(--vscode-button-secondaryBackground)';
			btn.style.color = 'var(--vscode-button-secondaryForeground)';
		} else {
			btn.style.background = 'transparent';
			btn.style.color = 'var(--vscode-foreground)';
			btn.style.border = '1px solid var(--vscode-panel-border)';
			btn.style.padding = '3px 8px';
			btn.style.fontSize = '11px';
		}
	}

	private getActiveFileInfo(): ActiveFileInfo | undefined {
		try {
			const editor = this.editorService.activeTextEditorControl as any;
			if (!editor || typeof editor.getModel !== 'function') { return undefined; }
			const model = editor.getModel();
			if (!model || typeof model.getValue !== 'function') { return undefined; }

			const value: string = model.getValue();
			if (!value || value.length === 0) { return undefined; }

			let content = value;
			let truncated = false;
			if (content.length > ACTIVE_FILE_MAX_CHARS) {
				content = content.slice(0, ACTIVE_FILE_MAX_CHARS);
				truncated = true;
			}

			const uri = model.uri;
			const fileName = uri?.path?.split('/').pop() ?? 'untitled';
			const lang = typeof model.getLanguageId === 'function' ? model.getLanguageId() : 'plaintext';

			let selection: ActiveFileInfo['selection'];
			try {
				const sel = typeof editor.getSelection === 'function' ? editor.getSelection() : null;
				if (sel && typeof sel.isEmpty === 'function' && !sel.isEmpty()) {
					const selText: string = typeof model.getValueInRange === 'function'
						? model.getValueInRange(sel)
						: '';
					if (selText && selText.length > 0 && selText.length < SELECTION_MAX_CHARS) {
						selection = {
							text: selText,
							startLine: sel.startLineNumber ?? 0,
							endLine: sel.endLineNumber ?? 0,
						};
					}
				}
			} catch {
				// selection optional
			}

			return { fileName, lang, content, truncated, selection };
		} catch (e) {
			console.warn('[Vibecoder] getActiveFileInfo failed:', e);
			return undefined;
		}
	}

	private getOpenTabsList(): string[] {
		try {
			const editorServiceAny = this.editorService as any;
			let editors: any[] = [];
			if (Array.isArray(editorServiceAny.editors)) {
				editors = editorServiceAny.editors;
			} else if (typeof editorServiceAny.getEditors === 'function') {
				try {
					const result = editorServiceAny.getEditors(0);
					editors = Array.isArray(result) ? result : [];
				} catch {
					editors = [];
				}
			}

			let activeUriPath: string | undefined;
			try {
				const activeEditor = this.editorService.activeTextEditorControl as any;
				const activeModel = activeEditor?.getModel?.();
				activeUriPath = activeModel?.uri?.path;
			} catch {
				// игнор
			}

			const seenPaths = new Set<string>();
			const workspaceFolders = this.workspaceService.getWorkspace().folders;
			const out: string[] = [];

			for (const ed of editors) {
				const uri = ed?.resource;
				if (!uri || typeof uri.path !== 'string') { continue; }
				if (uri.scheme !== 'file' && uri.scheme !== 'untitled') { continue; }

				const fullPath: string = uri.path;
				if (seenPaths.has(fullPath)) { continue; }
				seenPaths.add(fullPath);
				if (fullPath === activeUriPath) { continue; }

				let displayPath = fullPath;
				for (const folder of workspaceFolders) {
					const folderPath = folder.uri.path;
					if (fullPath.startsWith(folderPath + '/')) {
						displayPath = fullPath.slice(folderPath.length + 1);
						break;
					}
				}

				if (uri.scheme === 'untitled') {
					displayPath = `[без имени] ${displayPath}`;
				}

				out.push(displayPath);
				if (out.length >= OPEN_TABS_LIMIT) { break; }
			}

			return out;
		} catch (e) {
			console.warn('[Vibecoder] getOpenTabsList failed:', e);
			return [];
		}
	}

	private buildWorkspaceContext(): string | undefined {
		const info = this.getActiveFileInfo();
		if (!info) {
			const tabs = this.getOpenTabsList();
			if (tabs.length === 0) { return undefined; }
			return `# Открытые табы в редакторе (нет активного файла):\n${tabs.map(t => `- \`${t}\``).join('\n')}\n\n_NIT не видит содержимое этих файлов. Попроси юзера показать конкретный если задача его касается._`;
		}

		const truncNote = info.truncated
			? `\n\n_(файл обрезан до ${ACTIVE_FILE_MAX_CHARS} символов для контекста)_`
			: '';

		let result = `# Активный файл в редакторе: \`${info.fileName}\` (язык: ${info.lang})

\`\`\`${info.lang}
${info.content}
\`\`\`${truncNote}`;

		if (info.selection) {
			result += `

## Юзер ВЫДЕЛИЛ этот фрагмент (строки ${info.selection.startLine}–${info.selection.endLine}):

\`\`\`${info.lang}
${info.selection.text}
\`\`\`

_Если задача относится к выделенному коду — фокусируйся на нём в первую очередь._`;
		}

		const otherTabs = this.getOpenTabsList();
		if (otherTabs.length > 0) {
			result += `\n\n## Другие открытые табы (только имена, без содержимого):\n${otherTabs.map(t => `- \`${t}\``).join('\n')}\n\n_NIT не видит содержимое этих файлов. Если задача их касается — попроси юзера переключиться на нужный таб или явно показать его._`;
		}

		result += `\n\n_NIT видит активный файл автоматически. Если задача про другой код — попроси юзера показать._`;

		return result;
	}

	private updateActiveFileBadge(): void {
		if (!this.activeFileBadge) { return; }
		const info = this.getActiveFileInfo();
		if (!info) {
			this.activeFileBadge.textContent = 'Нет открытого файла';
			this.activeFileBadge.title = 'Открой файл в редакторе — NIT увидит его автоматически';
			return;
		}
		const lineCount = info.content.split('\n').length;
		let text = `${info.fileName} · ${lineCount} строк · ${info.lang}`;
		if (info.selection) {
			const selLines = info.selection.endLine - info.selection.startLine + 1;
			text += ` · ${selLines} выдел.`;
		}
		const otherTabsCount = this.getOpenTabsList().length;
		this.activeFileBadge.textContent = text;
		const tabsHint = otherTabsCount > 0 ? `\n+${otherTabsCount} других табов (NIT видит имена)` : '';
		this.activeFileBadge.title = (info.selection
			? `NIT видит файл + выделенный фрагмент (строки ${info.selection.startLine}–${info.selection.endLine})`
			: 'NIT автоматически видит этот файл. Выдели код — NIT сфокусируется на нём.') + tabsHint;
	}

	private async onProviderChange(): Promise<void> {
		const providerId = this.providerSelect.value as VibecoderProviderId;
		clearChildren(this.modelSelect);
		const loadingOpt = append(this.modelSelect, $('option')) as HTMLOptionElement;
		loadingOpt.textContent = '...';
		this.statusLine.textContent = `Проверка ${providerId}...`;

		const provider = this.llmRouter.getProvider(providerId);
		if (!provider) {
			this.statusLine.textContent = `${providerId} недоступен`;
			return;
		}

		let models: VibecoderModelInfo[] = [];
		try {
			models = this.modelsCache.get(providerId) ?? await provider.listModels();
			this.modelsCache.set(providerId, models);
		} catch (e) {
			clearChildren(this.modelSelect);
			const errOpt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			errOpt.textContent = '(недоступно)';
			const message = e instanceof Error ? e.message : String(e);
			if (providerId === 'lmstudio') {
				this.statusLine.textContent = `LM Studio не отвечает. Запусти Developer → Start Server.`;
				this.statusLine.title = `${message}\n\nЧто делать:\n1) Открой LM Studio\n2) Загрузи модель (для RTX 5090 — Qwen 3 Coder 30B-A3B)\n3) Developer → Start Server (порт 1234)\n4) Кликни ещё раз по селектору провайдера`;
			} else {
				this.statusLine.textContent = `${providerId}: ${message}`;
				this.statusLine.title = message;
			}
			return;
		}

		clearChildren(this.modelSelect);
		if (models.length === 0) {
			const opt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			opt.textContent = '(нет моделей)';
			if (providerId === 'lmstudio') {
				this.statusLine.textContent = `LM Studio запущена, но модели не загружены. Загрузи модель в LM Studio.`;
			} else {
				this.statusLine.textContent = `${providerId}: моделей не найдено. Сначала добавь API-ключ.`;
			}
			this.statusLine.title = '';
			return;
		}

		for (const m of models) {
			const opt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			opt.value = m.id;
			opt.textContent = m.displayName;
		}

		if (models.length > 0) {
			this.modelSelect.value = models[0].id;
		}

		this.statusLine.textContent = `${providerId}: ${models.length} моделей · «${models[0].displayName}» · готов`;
		this.statusLine.title = '';
	}

	private resetConversation(): void {
		this.history.length = 0;
		clearChildren(this.messagesContainer);
		this.messagesContainer.style.display = 'none';
		this.welcomeContainer.style.display = 'flex';
	}

	private switchToChat(): void {
		this.welcomeContainer.style.display = 'none';
		this.messagesContainer.style.display = 'flex';
	}

	private appendMessage(role: 'user' | 'assistant' | 'system' | 'error', text: string): HTMLElement {
		this.switchToChat();
		const block = append(this.messagesContainer, $('div'));
		block.style.padding = '10px 12px';
		block.style.borderRadius = '4px';
		block.style.whiteSpace = 'pre-wrap';
		block.style.wordBreak = 'break-word';
		block.style.maxWidth = '92%';
		block.style.lineHeight = '1.5';
		block.style.fontSize = '13px';

		if (role === 'user') {
			block.style.background = 'var(--vscode-list-activeSelectionBackground)';
			block.style.color = 'var(--vscode-list-activeSelectionForeground)';
			block.style.alignSelf = 'flex-end';
		} else if (role === 'assistant') {
			block.style.background = 'var(--vscode-editorWidget-background)';
			block.style.border = '1px solid var(--vscode-editorWidget-border)';
			block.style.color = 'var(--vscode-foreground)';
			block.style.alignSelf = 'flex-start';
		} else if (role === 'error') {
			block.style.background = 'var(--vscode-inputValidation-errorBackground)';
			block.style.border = '1px solid var(--vscode-inputValidation-errorBorder)';
			block.style.color = 'var(--vscode-inputValidation-errorForeground)';
			block.style.alignSelf = 'stretch';
		} else {
			block.style.background = 'transparent';
			block.style.border = '1px dashed var(--vscode-panel-border)';
			block.style.color = 'var(--vscode-descriptionForeground)';
			block.style.fontSize = '11px';
		}

		block.textContent = text;
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
		return block;
	}

	private rebuildSystemMessage(): void {
		const skillsIndex = this.skillsService.getDescriptionsForPrompt();
		const workspaceContext = this.buildWorkspaceContext();
		const systemContent = buildChatSystemPrompt({ skillsIndex, workspaceContext });

		if (this.history.length === 0 || this.history[0].role !== 'system') {
			this.history.unshift({ role: 'system', content: systemContent });
		} else {
			this.history[0] = { role: 'system', content: systemContent };
		}
	}

	private async sendCurrent(): Promise<void> {
		const text = this.inputElement.value.trim();
		if (!text) { return; }
		if (this.abortController) {
			this.statusLine.textContent = 'Уже идёт ответ. Подожди или нажми Стоп.';
			return;
		}

		const providerId = this.providerSelect.value as VibecoderProviderId;
		const model = this.modelSelect.value;
		if (!model || model.startsWith('(')) {
			this.appendMessage('error', 'Модель не выбрана. Подключи LM Studio (Developer → Start Server) или добавь API-ключ через Ctrl+Shift+P → «Vibecoder: Set API Key».');
			return;
		}

		this.rebuildSystemMessage();

		this.appendMessage('user', text);
		this.history.push({ role: 'user', content: text });
		this.inputElement.value = '';

		const assistantBlock = this.appendMessage('assistant', '');
		this.statusLine.textContent = `Генерирую ${providerId}/${model}...`;
		this.sendButton.disabled = true;
		this.stopButton.disabled = false;
		this.abortController = new AbortController();

		let accumulated = '';
		try {
			const stream = this.llmRouter.chat({
				messages: this.history,
				model,
				providerHint: providerId,
				signal: this.abortController.signal,
			});

			for await (const chunk of stream) {
				if (chunk.type === 'text' && chunk.text) {
					accumulated += chunk.text;
					assistantBlock.textContent = accumulated;
					this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
				} else if (chunk.type === 'error' && chunk.error) {
					if (!accumulated) { assistantBlock.remove(); }
					this.appendMessage('error', chunk.error.message);
				}
			}

			if (accumulated) {
				this.history.push({ role: 'assistant', content: accumulated });

				const blocks = parseSearchReplaceBlocks(accumulated);
				if (blocks.length > 0) {
					renderApplyPanel(assistantBlock, blocks, {
						fileService: this.fileService,
						workspaceService: this.workspaceService,
						editorService: this.editorService,
					});
					this.statusLine.textContent = `Готово · ${accumulated.length} симв. · ${blocks.length} правок`;
				} else {
					this.statusLine.textContent = `Готово · ${accumulated.length} симв.`;
				}
			} else {
				this.statusLine.textContent = 'Пустой ответ.';
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (!accumulated) { assistantBlock.remove(); }
			this.appendMessage('error', `Ошибка: ${message}`);
			this.statusLine.textContent = 'Ошибка.';
		} finally {
			this.sendButton.disabled = false;
			this.stopButton.disabled = true;
			this.abortController = undefined;
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}

export function registerVibecoderChatView(): void {
	const viewContainersRegistry = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry);

	const container: ViewContainer = viewContainersRegistry.registerViewContainer({
		id: VIBECODER_VIEW_CONTAINER_ID,
		title: localize2('vibecoder.viewContainer.title', 'NIT'),
		icon: nitViewIcon,
		order: 1,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIBECODER_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
		hideIfEmpty: false,
	}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

	const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
	viewsRegistry.registerViews([{
		id: VIBECODER_CHAT_VIEW_ID,
		name: localize2('vibecoder.nitView.title', 'NIT'),
		ctorDescriptor: new SyncDescriptor(NitChatView),
		canToggleVisibility: true,
		canMoveView: true,
		containerIcon: nitViewIcon,
		order: 1,
	}], container);
}
