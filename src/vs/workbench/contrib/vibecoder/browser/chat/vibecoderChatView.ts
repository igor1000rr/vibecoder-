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

/** Лимит на содержимое активного файла, который отправляем модели (примерно 7-8K токенов). */
const ACTIVE_FILE_MAX_CHARS = 30000;
/** Лимит на содержимое выделения. Дальше уже подозрительно большое выделение. */
const SELECTION_MAX_CHARS = 10000;
/** Сколько открытых табов максимум перечисляем в контексте. */
const OPEN_TABS_LIMIT = 20;

/**
 * Sparkle иконка в Activity Bar - вход в NIT.
 */
const nitViewIcon = registerIcon(
	'vibecoder-nit-icon',
	Codicon.sparkle,
	localize('vibecoderNitIcon', 'NIT — AI-ассистент Vibecoder.')
);

/**
 * Описание активного контекста редактора: текущий файл + опциональное выделение.
 */
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
 * Большой CSS-блок для welcome-экрана и общих стилей NIT.
 * Инжектится через `<style>` тэг с textContent — Trusted Types safe.
 * (Style-тэги: textContent НЕ парсится как HTML, это просто CSS-текст.)
 */
const NIT_VIEW_STYLES = `
@keyframes nit-shimmer {
	0%   { background-position: 0% center; }
	100% { background-position: 200% center; }
}

@keyframes nit-pulse-glow {
	0%, 100% {
		text-shadow:
			0 0 16px rgba(255, 60, 200, 0.45),
			0 0 32px rgba(255, 60, 200, 0.20),
			0 0 64px rgba(0, 240, 255, 0.10);
	}
	50% {
		text-shadow:
			0 0 24px rgba(255, 60, 200, 0.75),
			0 0 48px rgba(0, 240, 255, 0.45),
			0 0 96px rgba(157, 78, 221, 0.25);
	}
}

@keyframes nit-spotlight-pulse {
	0%, 100% { opacity: 0.35; transform: translate(-50%, -50%) scale(1); }
	50%      { opacity: 0.65; transform: translate(-50%, -50%) scale(1.15); }
}

@keyframes nit-particle-drift-1 {
	0%   { transform: translate(0, 0);       opacity: 0.0; }
	20%  {                                   opacity: 0.7; }
	100% { transform: translate(40px, -60px); opacity: 0.0; }
}

@keyframes nit-particle-drift-2 {
	0%   { transform: translate(0, 0);        opacity: 0.0; }
	25%  {                                    opacity: 0.6; }
	100% { transform: translate(-30px, -70px); opacity: 0.0; }
}

@keyframes nit-particle-drift-3 {
	0%   { transform: translate(0, 0);        opacity: 0.0; }
	30%  {                                    opacity: 0.5; }
	100% { transform: translate(20px, -80px); opacity: 0.0; }
}

@keyframes nit-fade-in-up {
	from { opacity: 0; transform: translateY(12px); }
	to   { opacity: 1; transform: translateY(0); }
}

@keyframes nit-cursor-blink {
	0%, 49%   { opacity: 1; }
	50%, 100% { opacity: 0; }
}

@keyframes nit-grid-scroll {
	0%   { background-position: 0 0; }
	100% { background-position: 40px 40px; }
}

/* ── Welcome-контейнер ─────────────────────────────────────────────── */
.vibecoder-nit-view .nit-welcome {
	position: relative;
	flex: 1;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 24px 16px;
	display: flex;
	flex-direction: column;
	gap: 18px;
	background:
		radial-gradient(ellipse 80% 50% at 50% 10%, rgba(255, 60, 200, 0.06) 0%, transparent 70%),
		linear-gradient(to bottom, rgba(0, 240, 255, 0.02) 0%, transparent 30%);
}

/* ── Cyber-grid фон ────────────────────────────────────────────────── */
.vibecoder-nit-view .nit-grid-bg {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 0;
	background-image:
		linear-gradient(rgba(255, 60, 200, 0.04) 1px, transparent 1px),
		linear-gradient(90deg, rgba(0, 240, 255, 0.04) 1px, transparent 1px);
	background-size: 40px 40px;
	animation: nit-grid-scroll 12s linear infinite;
	mask-image: radial-gradient(ellipse 70% 50% at 50% 0%, black 0%, transparent 80%);
	-webkit-mask-image: radial-gradient(ellipse 70% 50% at 50% 0%, black 0%, transparent 80%);
}

/* ── Плавающие частицы ─────────────────────────────────────────────── */
.vibecoder-nit-view .nit-particles {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 1;
	overflow: hidden;
}

.vibecoder-nit-view .nit-particle {
	position: absolute;
	width: 4px;
	height: 4px;
	border-radius: 50%;
	box-shadow: 0 0 8px currentColor;
}

.vibecoder-nit-view .nit-particle.p1 { top: 30%; left: 15%; color: #ff3cc8; animation: nit-particle-drift-1 6s ease-out infinite; }
.vibecoder-nit-view .nit-particle.p2 { top: 60%; left: 80%; color: #00f0ff; animation: nit-particle-drift-2 7s ease-out infinite 1s; }
.vibecoder-nit-view .nit-particle.p3 { top: 80%; left: 25%; color: #9d4edd; animation: nit-particle-drift-3 8s ease-out infinite 2s; }
.vibecoder-nit-view .nit-particle.p4 { top: 20%; left: 70%; color: #ff3cc8; animation: nit-particle-drift-1 9s ease-out infinite 3s; }
.vibecoder-nit-view .nit-particle.p5 { top: 50%; left: 50%; color: #00f0ff; animation: nit-particle-drift-2 6.5s ease-out infinite 1.5s; }
.vibecoder-nit-view .nit-particle.p6 { top: 70%; left: 10%; color: #ff3cc8; animation: nit-particle-drift-3 7.5s ease-out infinite 2.5s; }

/* ── Spotlight за лого ─────────────────────────────────────────────── */
.vibecoder-nit-view .nit-hero {
	position: relative;
	z-index: 2;
	text-align: center;
	padding: 36px 0 12px 0;
	animation: nit-fade-in-up 0.6s ease-out;
}

.vibecoder-nit-view .nit-hero-spotlight {
	position: absolute;
	top: 50%;
	left: 50%;
	width: 240px;
	height: 240px;
	pointer-events: none;
	border-radius: 50%;
	background: radial-gradient(circle, rgba(255, 60, 200, 0.25) 0%, rgba(0, 240, 255, 0.10) 40%, transparent 70%);
	filter: blur(12px);
	animation: nit-spotlight-pulse 4s ease-in-out infinite;
	z-index: -1;
}

.vibecoder-nit-view .nit-logo {
	font-family: 'Orbitron', 'Rajdhani', monospace;
	font-weight: 800;
	font-size: 56px;
	letter-spacing: 10px;
	background: linear-gradient(135deg, #ff3cc8 0%, #00f0ff 50%, #ff3cc8 100%);
	background-size: 200% auto;
	-webkit-background-clip: text;
	background-clip: text;
	-webkit-text-fill-color: transparent;
	animation: nit-shimmer 4s linear infinite, nit-pulse-glow 3s ease-in-out infinite;
	user-select: none;
}

.vibecoder-nit-view .nit-tagline {
	font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
	font-size: 10px;
	letter-spacing: 5px;
	margin-top: 8px;
	color: var(--vscode-descriptionForeground);
	opacity: 0.75;
	animation: nit-fade-in-up 0.8s ease-out 0.3s both;
}

.vibecoder-nit-view .nit-subtitle {
	margin-top: 16px;
	font-size: 13px;
	line-height: 1.6;
	color: var(--vscode-foreground);
	text-align: center;
	padding: 0 16px;
	animation: nit-fade-in-up 0.8s ease-out 0.5s both;
}

.vibecoder-nit-view .nit-subtitle .nit-accent-magenta { color: #ff3cc8; font-weight: 600; }
.vibecoder-nit-view .nit-subtitle .nit-accent-cyan    { color: #00f0ff; font-weight: 600; }

.vibecoder-nit-view .nit-madhya {
	margin-top: 12px;
	font-family: monospace;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	opacity: 0.7;
	font-style: italic;
	text-align: center;
	animation: nit-fade-in-up 0.8s ease-out 0.7s both;
}

/* ── Action cards ──────────────────────────────────────────────────── */
.vibecoder-nit-view .nit-actions {
	position: relative;
	z-index: 2;
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 12px;
	animation: nit-fade-in-up 0.8s ease-out 0.9s both;
}

.vibecoder-nit-view .nit-card {
	position: relative;
	padding: 12px 12px 12px 16px;
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-panel-border);
	border-radius: 8px;
	cursor: pointer;
	display: flex;
	gap: 12px;
	align-items: flex-start;
	transition: all 0.18s ease;
	overflow: hidden;
}

.vibecoder-nit-view .nit-card::before {
	content: '';
	position: absolute;
	left: 0; top: 0; bottom: 0;
	width: 3px;
	background: linear-gradient(180deg, #ff3cc8 0%, #00f0ff 100%);
	opacity: 0.5;
	transition: opacity 0.18s ease;
}

.vibecoder-nit-view .nit-card:hover {
	border-color: rgba(255, 60, 200, 0.6);
	box-shadow: 0 0 16px rgba(255, 60, 200, 0.25), inset 0 0 0 1px rgba(255, 60, 200, 0.15);
	transform: translateY(-1px);
}

.vibecoder-nit-view .nit-card:hover::before { opacity: 1; }

.vibecoder-nit-view .nit-card-icon {
	font-size: 22px;
	line-height: 1;
	padding-top: 2px;
	filter: drop-shadow(0 0 6px rgba(255, 60, 200, 0.4));
}

.vibecoder-nit-view .nit-card-body { flex: 1; min-width: 0; }

.vibecoder-nit-view .nit-card-title {
	font-weight: 600;
	font-size: 12.5px;
	color: var(--vscode-foreground);
	letter-spacing: 0.2px;
}

.vibecoder-nit-view .nit-card-desc {
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	margin-top: 3px;
	line-height: 1.4;
}

/* ── Tips footer ───────────────────────────────────────────────────── */
.vibecoder-nit-view .nit-tips {
	position: relative;
	z-index: 2;
	margin-top: auto;
	padding: 14px 12px 4px 12px;
	border-top: 1px solid var(--vscode-panel-border);
	font-size: 10.5px;
	font-family: 'JetBrains Mono', monospace;
	color: var(--vscode-descriptionForeground);
	line-height: 1.8;
	letter-spacing: 0.3px;
	animation: nit-fade-in-up 0.8s ease-out 1.1s both;
}

.vibecoder-nit-view .nit-tips .nit-tip-kbd {
	display: inline-block;
	padding: 1px 6px;
	background: rgba(255, 60, 200, 0.12);
	border: 1px solid rgba(255, 60, 200, 0.3);
	border-radius: 3px;
	font-weight: 600;
	color: #ff3cc8;
	font-size: 10px;
}

.vibecoder-nit-view .nit-tips .nit-cursor {
	display: inline-block;
	width: 6px;
	height: 11px;
	background: #ff3cc8;
	margin-left: 2px;
	vertical-align: middle;
	animation: nit-cursor-blink 1s steps(1) infinite;
}

/* ── Brand row в header ────────────────────────────────────────────── */
.vibecoder-nit-view .nit-brand-text {
	font-family: 'Orbitron', 'Rajdhani', monospace;
	font-weight: 700;
	font-size: 16px;
	letter-spacing: 3px;
	background: linear-gradient(90deg, #ff3cc8 0%, #00f0ff 100%);
	-webkit-background-clip: text;
	background-clip: text;
	-webkit-text-fill-color: transparent;
	text-shadow: 0 0 12px rgba(255, 60, 200, 0.3);
}

.vibecoder-nit-view .nit-brand-tag {
	font-size: 10px;
	color: var(--vscode-descriptionForeground);
	margin-left: 8px;
	letter-spacing: 1px;
}
`;

/**
 * NIT — AI-сайдбар Vibecoder.
 *
 * Регистрируется в AuxiliaryBar (правая панель, как в Cursor).
 *
 * Особенности UI:
 *  - Весь рендер — через DOM-методы (`document.createElement` / `$`).
 *    `innerHTML` НЕ используется нигде из-за политики Trusted Types в
 *    VS Code OSS workbench (требует TrustedHTML, иначе бросает TypeError
 *    и срывает renderBody).
 *  - Стили инжектятся одним `<style>` тэгом через textContent — это
 *    разрешено в Trusted Types (textContent style-тэга не парсится как HTML).
 *
 * Фичи:
 *  - Streaming чат с 5 провайдерами через IVibecoderLLMRouter
 *  - Auto-select первой модели при подключении к провайдеру
 *  - Apply-кнопки прямо в сообщении ассистента когда модель выдала
 *    search/replace блоки (см. applyPanel.ts)
 *  - Auto-include содержимого активного редактора в системный промпт
 *    на каждый запрос (NIT всегда видит файл на экране юзера)
 *  - Selection-context: если юзер выделил код, NIT видит выделение
 *    отдельной секцией системного промпта
 *  - Open tabs awareness: NIT знает какие ещё файлы открыты у юзера
 *    (без содержимого — только имена, чтобы попросить юзера показать)
 *  - Анимированный welcome со скиллами/командами
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
		container.style.padding = '0';
		container.style.fontFamily = 'var(--vscode-font-family)';
		container.style.fontSize = 'var(--vscode-font-size)';
		container.style.background = 'var(--vscode-sideBar-background)';

		// Инжектим общие стили один раз
		const styleEl = append(container, $('style'));
		styleEl.textContent = NIT_VIEW_STYLES;

		// ── Header: бренд NIT + provider/model selectors + active file badge ──
		const header = append(container, $('div'));
		header.style.padding = '10px 12px';
		header.style.borderBottom = '1px solid var(--vscode-panel-border)';
		header.style.display = 'flex';
		header.style.flexDirection = 'column';
		header.style.gap = '8px';
		header.style.background = 'linear-gradient(180deg, rgba(255, 60, 200, 0.06) 0%, transparent 100%)';

		const brandRow = append(header, $('div'));
		brandRow.style.display = 'flex';
		brandRow.style.alignItems = 'center';
		brandRow.style.justifyContent = 'space-between';

		const brand = append(brandRow, $('div'));
		const brandText = append(brand, $('span.nit-brand-text'));
		brandText.textContent = 'NIT';
		const brandTag = append(brand, $('span.nit-brand-tag'));
		brandTag.textContent = 'AI ASSISTANT';

		const newChatBtn = append(brandRow, $('button')) as HTMLButtonElement;
		newChatBtn.textContent = '+ New';
		newChatBtn.title = 'Начать новый чат';
		this.styleButton(newChatBtn, 'ghost');
		newChatBtn.style.fontSize = '11px';
		newChatBtn.addEventListener('click', () => this.resetConversation());

		const selectorsRow = append(header, $('div'));
		selectorsRow.style.display = 'flex';
		selectorsRow.style.gap = '6px';

		this.providerSelect = append(selectorsRow, $('select')) as HTMLSelectElement;
		this.styleSelect(this.providerSelect);
		this.providerSelect.style.flex = '1';
		for (const p of [
			{ id: 'lmstudio', label: '🖥  LM Studio' },
			{ id: 'anthropic', label: '🟠 Anthropic' },
			{ id: 'openai', label: '🟢 OpenAI' },
			{ id: 'gemini', label: '🔷 Gemini' },
			{ id: 'openrouter', label: '🔀 OpenRouter' },
		] as Array<{ id: VibecoderProviderId; label: string }>) {
			const opt = append(this.providerSelect, $('option')) as HTMLOptionElement;
			opt.value = p.id;
			opt.textContent = p.label;
		}

		this.modelSelect = append(selectorsRow, $('select')) as HTMLSelectElement;
		this.styleSelect(this.modelSelect);
		this.modelSelect.style.flex = '2';

		this.providerSelect.addEventListener('change', () => this.onProviderChange());

		// Active file badge
		this.activeFileBadge = append(header, $('div'));
		this.activeFileBadge.style.fontSize = '10px';
		this.activeFileBadge.style.fontFamily = 'monospace';
		this.activeFileBadge.style.color = 'var(--vscode-descriptionForeground)';
		this.activeFileBadge.style.padding = '2px 0';
		this.activeFileBadge.style.overflow = 'hidden';
		this.activeFileBadge.style.textOverflow = 'ellipsis';
		this.activeFileBadge.style.whiteSpace = 'nowrap';
		this.activeFileBadge.style.opacity = '0.75';
		this.updateActiveFileBadge();

		this._register(this.editorService.onDidActiveEditorChange(() => this.updateActiveFileBadge()));

		// ── Welcome block ────────────────────────────────────────────────────
		this.welcomeContainer = append(container, $('div'));
		this.renderWelcome();

		// ── Messages container ───────────────────────────────────────────────
		this.messagesContainer = append(container, $('div'));
		this.messagesContainer.style.flex = '1';
		this.messagesContainer.style.overflowY = 'auto';
		this.messagesContainer.style.padding = '12px';
		this.messagesContainer.style.gap = '10px';
		this.messagesContainer.style.display = 'none';
		this.messagesContainer.style.flexDirection = 'column';

		// ── Status line ──────────────────────────────────────────────────────
		this.statusLine = append(container, $('div'));
		this.statusLine.style.padding = '4px 12px';
		this.statusLine.style.fontSize = '10px';
		this.statusLine.style.color = 'var(--vscode-descriptionForeground)';
		this.statusLine.style.fontFamily = 'monospace';
		this.statusLine.style.letterSpacing = '0.5px';
		this.statusLine.textContent = '⚡ initializing...';

		// ── Input row ────────────────────────────────────────────────────────
		const inputRow = append(container, $('div'));
		inputRow.style.padding = '8px 12px 12px 12px';
		inputRow.style.display = 'flex';
		inputRow.style.flexDirection = 'column';
		inputRow.style.gap = '6px';
		inputRow.style.borderTop = '1px solid var(--vscode-panel-border)';

		this.inputElement = append(inputRow, $('textarea')) as HTMLTextAreaElement;
		this.inputElement.placeholder = 'Спроси NIT что-нибудь...  (Enter — отправить, Shift+Enter — перенос)';
		this.inputElement.rows = 3;
		this.inputElement.style.background = 'var(--vscode-input-background)';
		this.inputElement.style.color = 'var(--vscode-input-foreground)';
		this.inputElement.style.border = '1px solid var(--vscode-input-border)';
		this.inputElement.style.borderRadius = '6px';
		this.inputElement.style.padding = '8px 10px';
		this.inputElement.style.resize = 'vertical';
		this.inputElement.style.fontFamily = 'inherit';
		this.inputElement.style.fontSize = 'inherit';
		this.inputElement.style.outline = 'none';
		this.inputElement.style.transition = 'border-color 0.15s, box-shadow 0.15s';

		this.inputElement.addEventListener('focus', () => {
			this.inputElement.style.borderColor = '#ff3cc8';
			this.inputElement.style.boxShadow = '0 0 0 1px #ff3cc8, 0 0 8px rgba(255, 60, 200, 0.2)';
		});
		this.inputElement.addEventListener('blur', () => {
			this.inputElement.style.borderColor = 'var(--vscode-input-border)';
			this.inputElement.style.boxShadow = 'none';
		});

		const buttonRow = append(inputRow, $('div'));
		buttonRow.style.display = 'flex';
		buttonRow.style.gap = '6px';
		buttonRow.style.justifyContent = 'flex-end';

		this.stopButton = append(buttonRow, $('button')) as HTMLButtonElement;
		this.stopButton.textContent = '◼ Stop';
		this.styleButton(this.stopButton, 'secondary');
		this.stopButton.disabled = true;
		this.stopButton.addEventListener('click', () => this.abortController?.abort());

		this.sendButton = append(buttonRow, $('button')) as HTMLButtonElement;
		this.sendButton.textContent = 'Send  ⏎';
		this.styleButton(this.sendButton, 'primary');
		this.sendButton.addEventListener('click', () => this.sendCurrent());

		this.inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendCurrent();
			}
		});

		this.onProviderChange().catch(err => {
			this.statusLine.textContent = `error: ${err?.message ?? err}`;
		});
	}

	/**
	 * Анимированный welcome-экран для NIT:
	 *  - Cyber-grid фон с медленной прокруткой
	 *  - 6 плавающих частиц (magenta / cyan / purple)
	 *  - Hero-секция: spotlight + огромное лого NIT с shimmer и pulse-glow
	 *  - Tagline / subtitle / madhya — каскадная fade-in-up анимация
	 *  - 4 action card'а с hover-glow и accent-bar слева
	 *  - Tips-footer с моноширным шрифтом и подсветкой клавиш
	 *
	 * Весь рендер через document.createElement — никакого innerHTML
	 * (требование Trusted Types в VS Code OSS workbench).
	 */
	private renderWelcome(): void {
		clearChildren(this.welcomeContainer);
		this.welcomeContainer.classList.add('nit-welcome');

		// Декоративный фон: cyber-grid + плавающие частицы
		append(this.welcomeContainer, $('div.nit-grid-bg'));
		const particles = append(this.welcomeContainer, $('div.nit-particles'));
		for (let i = 1; i <= 6; i++) {
			append(particles, $('div.nit-particle.p' + i));
		}

		// ── Hero: spotlight + лого + tagline ──
		const hero = append(this.welcomeContainer, $('div.nit-hero'));
		append(hero, $('div.nit-hero-spotlight'));

		const logo = append(hero, $('div.nit-logo'));
		logo.textContent = 'NIT';

		const tagline = append(hero, $('div.nit-tagline'));
		tagline.textContent = '▸ NEURAL INTERFACE TERMINAL ◂';

		// ── Subtitle с акцентами ──
		const subtitle = append(this.welcomeContainer, $('div.nit-subtitle'));
		subtitle.appendChild(document.createTextNode('AI-ассистент Vibecoder с упором на '));
		const localAcc = append(subtitle, $('span.nit-accent-magenta'));
		localAcc.textContent = 'локальные модели';
		subtitle.appendChild(document.createTextNode(' и '));
		const privAcc = append(subtitle, $('span.nit-accent-cyan'));
		privAcc.textContent = 'приватность';
		subtitle.appendChild(document.createTextNode('.'));

		// ── Срединный путь / Madhya ──
		const madhya = append(this.welcomeContainer, $('div.nit-madhya'));
		madhya.textContent = '« Срединный путь · Madhya »';

		// ── Action cards ──
		const actions: Array<{ icon: string; title: string; description: string; commandId: string }> = [
			{
				icon: '🖥',
				title: 'Подключить LM Studio',
				description: 'Локальный LLM — самый быстрый и приватный путь',
				commandId: 'vibecoder.testLMStudio',
			},
			{
				icon: '🔑',
				title: 'Добавить API-ключ',
				description: 'Anthropic, OpenAI, Gemini или OpenRouter',
				commandId: 'vibecoder.setApiKey',
			},
			{
				icon: '📋',
				title: 'Apply from Clipboard',
				description: 'Применить search/replace блоки в код',
				commandId: 'vibecoder.applyFromClipboard',
			},
			{
				icon: '🧠',
				title: 'Reload Skills',
				description: 'Перезагрузить .vibecoder/skills/',
				commandId: 'vibecoder.reloadSkills',
			},
		];

		const actionsGrid = append(this.welcomeContainer, $('div.nit-actions'));
		for (const action of actions) {
			const card = append(actionsGrid, $('div.nit-card'));

			const iconEl = append(card, $('div.nit-card-icon'));
			iconEl.textContent = action.icon;

			const body = append(card, $('div.nit-card-body'));
			const titleEl = append(body, $('div.nit-card-title'));
			titleEl.textContent = action.title;
			const descEl = append(body, $('div.nit-card-desc'));
			descEl.textContent = action.description;

			card.addEventListener('click', () => {
				this.commandService.executeCommand(action.commandId).catch(err => {
					console.error('NIT action failed:', err);
				});
			});
		}

		// ── Tips footer ──
		const tips = append(this.welcomeContainer, $('div.nit-tips'));

		const tip1 = append(tips, $('div'));
		tip1.appendChild(document.createTextNode('▸ '));
		const kbd1 = append(tip1, $('span.nit-tip-kbd'));
		kbd1.textContent = 'Ctrl+Shift+P';
		tip1.appendChild(document.createTextNode(' → «Vibecoder» для всех команд'));

		const tip2 = append(tips, $('div'));
		tip2.textContent = '▸ Выдели код в редакторе — NIT сфокусируется на нём';

		const tip3 = append(tips, $('div'));
		tip3.appendChild(document.createTextNode('▸ Жди ответа модели'));
		append(tip3, $('span.nit-cursor'));
	}

	private styleSelect(el: HTMLSelectElement): void {
		el.style.background = 'var(--vscode-dropdown-background)';
		el.style.color = 'var(--vscode-dropdown-foreground)';
		el.style.border = '1px solid var(--vscode-dropdown-border)';
		el.style.borderRadius = '4px';
		el.style.padding = '4px 6px';
		el.style.fontFamily = 'inherit';
		el.style.fontSize = '11px';
		el.style.cursor = 'pointer';
	}

	private styleButton(btn: HTMLButtonElement, variant: 'primary' | 'secondary' | 'ghost'): void {
		btn.style.padding = '6px 12px';
		btn.style.border = 'none';
		btn.style.borderRadius = '4px';
		btn.style.cursor = 'pointer';
		btn.style.fontFamily = 'inherit';
		btn.style.fontSize = 'inherit';
		btn.style.fontWeight = '600';
		btn.style.letterSpacing = '0.3px';
		btn.style.transition = 'all 0.15s';

		if (variant === 'primary') {
			btn.style.background = 'linear-gradient(135deg, #ff3cc8 0%, #ff5db5 100%)';
			btn.style.color = '#fff';
			btn.style.boxShadow = '0 2px 8px rgba(255, 60, 200, 0.25)';
		} else if (variant === 'secondary') {
			btn.style.background = 'var(--vscode-button-secondaryBackground)';
			btn.style.color = 'var(--vscode-button-secondaryForeground)';
		} else {
			btn.style.background = 'transparent';
			btn.style.color = 'var(--vscode-descriptionForeground)';
			btn.style.border = '1px solid var(--vscode-panel-border)';
			btn.style.padding = '3px 8px';
		}
	}

	/**
	 * Достаёт текущий активный редактор и возвращает информацию о нём.
	 */
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
					displayPath = `[untitled] ${displayPath}`;
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
			this.activeFileBadge.textContent = '○ no active file';
			this.activeFileBadge.style.color = 'var(--vscode-descriptionForeground)';
			this.activeFileBadge.title = 'Открой файл в редакторе — NIT увидит его автоматически';
			return;
		}
		const lineCount = info.content.split('\n').length;
		let text = `📄 ${info.fileName} · ${lineCount} lines · ${info.lang}`;
		if (info.selection) {
			const selLines = info.selection.endLine - info.selection.startLine + 1;
			text += ` · ✦ ${selLines} sel`;
		}
		const otherTabsCount = this.getOpenTabsList().length;
		this.activeFileBadge.textContent = text;
		this.activeFileBadge.style.color = info.selection ? '#ff3cc8' : '#00f0ff';
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
		this.statusLine.textContent = `▸ querying ${providerId}...`;

		const provider = this.llmRouter.getProvider(providerId);
		if (!provider) {
			this.statusLine.textContent = `▸ ${providerId} unavailable`;
			return;
		}

		let models: VibecoderModelInfo[] = [];
		try {
			models = this.modelsCache.get(providerId) ?? await provider.listModels();
			this.modelsCache.set(providerId, models);
		} catch (e) {
			clearChildren(this.modelSelect);
			const errOpt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			errOpt.textContent = '(unavailable)';
			const message = e instanceof Error ? e.message : String(e);
			this.statusLine.textContent = `▸ ${providerId}: ${message}`;
			if (providerId === 'lmstudio') {
				this.appendMessage('error',
					`LM Studio недоступна.\n\n${message}\n\n` +
					`Что делать:\n` +
					`1) Открой LM Studio\n` +
					`2) Загрузи модель (рекомендуется Qwen 3 Coder 30B-A3B)\n` +
					`3) Developer → Start Server (порт 1234)\n` +
					`4) Здесь — кнопка ↻ или смени провайдера и обратно`);
			}
			return;
		}

		clearChildren(this.modelSelect);
		if (models.length === 0) {
			const opt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			opt.textContent = '(no models)';
			if (providerId === 'lmstudio') {
				this.statusLine.textContent = `▸ LM Studio запущена, но моделей не загружено. Загрузи модель в LM Studio.`;
			} else {
				this.statusLine.textContent = `▸ ${providerId}: no models. set API key first.`;
			}
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

		this.statusLine.textContent = `▸ ${providerId}: ${models.length} model(s) · ${models[0].displayName} selected · ready`;
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
		block.style.borderRadius = '8px';
		block.style.whiteSpace = 'pre-wrap';
		block.style.wordBreak = 'break-word';
		block.style.maxWidth = '92%';
		block.style.lineHeight = '1.5';

		if (role === 'user') {
			block.style.background = 'linear-gradient(135deg, rgba(255, 60, 200, 0.18) 0%, rgba(255, 60, 200, 0.10) 100%)';
			block.style.border = '1px solid rgba(255, 60, 200, 0.35)';
			block.style.color = 'var(--vscode-foreground)';
			block.style.alignSelf = 'flex-end';
		} else if (role === 'assistant') {
			block.style.background = 'rgba(0, 240, 255, 0.06)';
			block.style.border = '1px solid rgba(0, 240, 255, 0.25)';
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
			this.statusLine.textContent = '▸ already streaming. wait or Stop.';
			return;
		}

		const providerId = this.providerSelect.value as VibecoderProviderId;
		const model = this.modelSelect.value;
		if (!model || model.startsWith('(')) {
			this.appendMessage('error', 'Модель не выбрана. Подключи LM Studio (Developer → Start Server) или добавь API-ключ через Ctrl+Shift+P → "Vibecoder: Set API Key".');
			return;
		}

		this.rebuildSystemMessage();

		this.appendMessage('user', text);
		this.history.push({ role: 'user', content: text });
		this.inputElement.value = '';

		const assistantBlock = this.appendMessage('assistant', '');
		this.statusLine.textContent = `▸ streaming ${providerId}/${model}...`;
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
					this.statusLine.textContent = `▸ done · ${accumulated.length} chars · ${blocks.length} edit(s) ready`;
				} else {
					this.statusLine.textContent = `▸ done · ${accumulated.length} chars`;
				}
			} else {
				this.statusLine.textContent = '▸ empty response.';
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (!accumulated) { assistantBlock.remove(); }
			this.appendMessage('error', `Ошибка: ${message}`);
			this.statusLine.textContent = '▸ error.';
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

/**
 * Регистрирует View Container в AuxiliaryBar (правая панель, как в Cursor)
 * и NIT view внутри него.
 */
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
