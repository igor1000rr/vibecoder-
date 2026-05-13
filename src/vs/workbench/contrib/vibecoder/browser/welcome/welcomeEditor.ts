/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Welcome-редактор Vibecoder.
 *
 * Дизайн: hero с magenta/cyan градиентом (палитра Vibecoder Dark), выделенная
 * карточка автора, grid feature-карточек с hover-glow, минималистичный help-row.
 *
 * Подбор цветов синхронизирован с product.json initialColorTheme:
 *   --vc-magenta:  #ff3cc8
 *   --vc-cyan:     #00f0ff
 *   --vc-purple:   #5a1a78
 *   --vc-bg-deep:  #0a0614
 *   --vc-bg:       #0f0a1f
 *
 * Все взаимодействия через DOM events + openerService/commandService.
 */

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { IEditorOpenContext, EditorExtensions } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Dimension, $, append } from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { localize } from '../../../../../nls.js';

/** Автор Vibecoder */
const VIBECODER_AUTHOR_NAME = 'Дмитрий Орлов';
const VIBECODER_AUTHOR_HANDLE = '@antsincgame';
const VIBECODER_AUTHOR_URL = 'https://github.com/antsincgame';

export class VibecoderWelcomeEditorInput extends EditorInput {

	static readonly ID = 'vibecoder.welcomeEditor.input';

	static readonly RESOURCE = URI.from({ scheme: 'vibecoder-welcome', authority: 'nit', path: '/welcome' });

	override get typeId(): string {
		return VibecoderWelcomeEditorInput.ID;
	}

	override get resource(): URI {
		return VibecoderWelcomeEditorInput.RESOURCE;
	}

	override getName(): string {
		return localize('vibecoder.welcomeEditor.name', 'Welcome');
	}

	override getIcon(): ThemeIcon | undefined {
		return Codicon.sparkle;
	}

	override matches(other: EditorInput | unknown): boolean {
		return other instanceof VibecoderWelcomeEditorInput;
	}
}

/**
 * Стили — все в одном <style> блоке, инжектируются в pane.
 * Цвета жёстко зашиты под palette Vibecoder Dark из product.json.
 */
const WELCOME_STYLES = `
.vibecoder-welcome-editor {
	--vc-magenta: #ff3cc8;
	--vc-cyan: #00f0ff;
	--vc-purple: #5a1a78;
	--vc-bg-deep: #0a0614;
	--vc-bg: #0f0a1f;
	--vc-text: #e8e6f0;
	--vc-text-dim: #9088a8;
	--vc-border: rgba(255, 60, 200, 0.18);
	--vc-border-strong: rgba(255, 60, 200, 0.4);

	height: 100%;
	width: 100%;
	overflow-y: auto;
	overflow-x: hidden;
	background:
		radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255, 60, 200, 0.12), transparent 60%),
		radial-gradient(ellipse 70% 50% at 100% 30%, rgba(0, 240, 255, 0.06), transparent 50%),
		var(--vc-bg-deep);
	color: var(--vc-text);
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
	font-size: 14px;
	line-height: 1.5;
}

/* Сетка точек на фоне — едва заметная, добавляет глубины */
.vibecoder-welcome-editor::before {
	content: "";
	position: absolute;
	inset: 0;
	background-image: radial-gradient(rgba(255, 60, 200, 0.08) 1px, transparent 1px);
	background-size: 28px 28px;
	pointer-events: none;
	mask-image: linear-gradient(180deg, rgba(0,0,0,0.7), transparent 70%);
	z-index: 0;
}

.vw-container {
	position: relative;
	z-index: 1;
	max-width: 1080px;
	margin: 0 auto;
	padding: 80px 48px 56px 48px;
}

/* ── HERO ──────────────────────────────────────────────────── */

.vw-hero {
	margin-bottom: 56px;
	position: relative;
}

.vw-hero-title {
	font-size: 72px;
	font-weight: 800;
	line-height: 0.95;
	letter-spacing: -2px;
	margin: 0 0 18px 0;
	background: linear-gradient(135deg, var(--vc-magenta) 0%, #d83cff 40%, var(--vc-cyan) 100%);
	-webkit-background-clip: text;
	background-clip: text;
	-webkit-text-fill-color: transparent;
	color: transparent;
	text-shadow: 0 0 60px rgba(255, 60, 200, 0.25);
}

.vw-hero-tagline {
	font-size: 18px;
	font-weight: 400;
	color: var(--vc-text);
	margin: 0 0 8px 0;
	max-width: 720px;
	line-height: 1.45;
}

.vw-hero-sub {
	font-size: 14px;
	color: var(--vc-text-dim);
	margin: 0;
	max-width: 680px;
	line-height: 1.6;
}

.vw-hero-sub .nit {
	color: var(--vc-cyan);
	font-weight: 600;
	letter-spacing: 1px;
}

/* ── AUTHOR CARD ───────────────────────────────────────────── */

.vw-author-card {
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 16px 18px;
	margin: 32px 0 56px 0;
	background: linear-gradient(135deg, rgba(90, 26, 120, 0.35), rgba(15, 10, 31, 0.6));
	border: 1px solid var(--vc-border);
	border-radius: 10px;
	box-shadow:
		0 0 0 1px rgba(255, 60, 200, 0.05),
		0 8px 24px rgba(0, 0, 0, 0.4),
		inset 0 1px 0 rgba(255, 255, 255, 0.04);
	cursor: pointer;
	transition: all 0.2s ease;
}

.vw-author-card:hover {
	border-color: var(--vc-border-strong);
	box-shadow:
		0 0 0 1px rgba(255, 60, 200, 0.15),
		0 12px 36px rgba(0, 0, 0, 0.5),
		0 0 24px rgba(255, 60, 200, 0.15);
	transform: translateY(-1px);
}

.vw-author-avatar {
	flex-shrink: 0;
	width: 56px;
	height: 56px;
	border-radius: 50%;
	background: linear-gradient(135deg, var(--vc-magenta), var(--vc-cyan));
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 28px;
	font-weight: 700;
	color: #0a0614;
	font-family: "JetBrains Mono", "Fira Code", monospace;
	box-shadow:
		0 0 24px rgba(255, 60, 200, 0.3),
		inset 0 0 12px rgba(0, 0, 0, 0.2);
}

.vw-author-body {
	flex: 1;
	min-width: 0;
}

.vw-author-label {
	font-size: 10px;
	font-weight: 600;
	color: var(--vc-text-dim);
	letter-spacing: 2px;
	text-transform: uppercase;
	margin-bottom: 4px;
}

.vw-author-name {
	font-size: 17px;
	font-weight: 600;
	color: var(--vc-text);
	line-height: 1.2;
	margin-bottom: 2px;
}

.vw-author-handle {
	font-size: 12.5px;
	color: var(--vc-cyan);
	font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
}

.vw-author-arrow {
	flex-shrink: 0;
	color: var(--vc-magenta);
	font-size: 22px;
	margin-right: 4px;
	transition: transform 0.2s ease;
}

.vw-author-card:hover .vw-author-arrow {
	transform: translateX(4px);
}

/* ── SECTIONS ──────────────────────────────────────────────── */

.vw-section {
	margin-bottom: 48px;
}

.vw-section-title {
	font-size: 11px;
	font-weight: 700;
	color: var(--vc-magenta);
	letter-spacing: 3px;
	text-transform: uppercase;
	margin: 0 0 20px 0;
	display: flex;
	align-items: center;
	gap: 12px;
}

.vw-section-title::after {
	content: "";
	flex: 1;
	height: 1px;
	background: linear-gradient(90deg, var(--vc-border-strong), transparent);
}

/* ── FEATURE GRID ──────────────────────────────────────────── */

.vw-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
	gap: 14px;
}

.vw-card {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 18px 18px 16px 18px;
	background: rgba(15, 10, 31, 0.5);
	border: 1px solid rgba(255, 255, 255, 0.06);
	border-radius: 8px;
	cursor: pointer;
	transition: all 0.18s ease;
	position: relative;
	overflow: hidden;
}

.vw-card::before {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(135deg, rgba(255, 60, 200, 0.08), transparent 60%);
	opacity: 0;
	transition: opacity 0.2s ease;
	pointer-events: none;
}

.vw-card:hover {
	border-color: var(--vc-border-strong);
	background: rgba(15, 10, 31, 0.8);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 60, 200, 0.1);
	transform: translateY(-2px);
}

.vw-card:hover::before {
	opacity: 1;
}

.vw-card:focus {
	outline: 1px solid var(--vc-magenta);
	outline-offset: 2px;
}

.vw-card-icon {
	font-size: 24px;
	line-height: 1;
	margin-bottom: 6px;
}

.vw-card-label {
	font-size: 14px;
	font-weight: 600;
	color: var(--vc-text);
	line-height: 1.3;
}

.vw-card-desc {
	font-size: 12px;
	color: var(--vc-text-dim);
	line-height: 1.5;
}

.vw-card-key {
	margin-top: 4px;
	font-size: 10px;
	color: var(--vc-text-dim);
	font-family: "JetBrains Mono", "Fira Code", monospace;
	letter-spacing: 0.5px;
}

/* ── HELP ROW (плоский список ссылок) ──────────────────────── */

.vw-help-list {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 8px;
}

.vw-help-item {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 8px 14px;
	background: transparent;
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-radius: 6px;
	color: var(--vc-text-dim);
	font-size: 12.5px;
	cursor: pointer;
	transition: all 0.15s ease;
}

.vw-help-item:hover {
	color: var(--vc-cyan);
	border-color: rgba(0, 240, 255, 0.4);
	background: rgba(0, 240, 255, 0.05);
}

.vw-help-icon {
	font-size: 14px;
	line-height: 1;
}

/* ── FOOTER ────────────────────────────────────────────────── */

.vw-footer {
	margin-top: 64px;
	padding-top: 24px;
	border-top: 1px solid rgba(255, 255, 255, 0.06);
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px;
	font-size: 11.5px;
	color: var(--vc-text-dim);
}

.vw-footer-version {
	font-family: "JetBrains Mono", "Fira Code", monospace;
	letter-spacing: 0.5px;
}

.vw-footer-author {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.vw-footer-author-name {
	color: var(--vc-magenta);
	cursor: pointer;
	transition: color 0.15s ease;
}

.vw-footer-author-name:hover {
	color: var(--vc-cyan);
}

/* ── RESPONSIVE ────────────────────────────────────────────── */

@media (max-width: 760px) {
	.vw-container { padding: 48px 24px 40px 24px; }
	.vw-hero-title { font-size: 48px; letter-spacing: -1px; }
	.vw-hero-tagline { font-size: 16px; }
	.vw-author-card { padding: 14px; }
	.vw-author-avatar { width: 48px; height: 48px; font-size: 22px; }
	.vw-author-name { font-size: 15px; }
	.vw-grid { grid-template-columns: 1fr; }
}

/* Pulse glow на hero — едва-едва, не раздражает */
@keyframes vw-pulse {
	0%, 100% { text-shadow: 0 0 60px rgba(255, 60, 200, 0.25); }
	50% { text-shadow: 0 0 80px rgba(255, 60, 200, 0.4); }
}

.vw-hero-title {
	animation: vw-pulse 4s ease-in-out infinite;
}
`;

interface FeatureCard {
	readonly icon: string;
	readonly label: string;
	readonly description: string;
	readonly key?: string;
	readonly commandId?: string;
	readonly url?: string;
}

interface HelpItem {
	readonly icon: string;
	readonly label: string;
	readonly url?: string;
	readonly commandId?: string;
}

export class VibecoderWelcomeEditorPane extends EditorPane {

	static readonly ID = 'vibecoder.welcomeEditor';

	private rootEl: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super(VibecoderWelcomeEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.rootEl = parent;
		this.renderContent(parent);
	}

	override async setInput(
		input: VibecoderWelcomeEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
	}

	override layout(_dimension: Dimension): void {
		// CSS управляет layout-ом (grid/flex)
	}

	override focus(): void {
		this.rootEl?.focus();
	}

	private renderContent(parent: HTMLElement): void {
		parent.classList.add('vibecoder-welcome-editor');
		parent.tabIndex = 0;

		const styleEl = append(parent, $('style'));
		styleEl.textContent = WELCOME_STYLES;

		const container = append(parent, $('div.vw-container'));

		this.renderHero(container);
		this.renderAuthorCard(container);
		this.renderStartGrid(container);
		this.renderHelpRow(container);
		this.renderFooter(container);
	}

	// ── HERO ──────────────────────────────────────────────────

	private renderHero(container: HTMLElement): void {
		const hero = append(container, $('div.vw-hero'));

		const title = append(hero, $('h1.vw-hero-title'));
		title.textContent = 'Vibecoder';

		const tagline = append(hero, $('p.vw-hero-tagline'));
		tagline.textContent = 'AI-IDE с упором на локальные модели и приватность.';

		const sub = append(hero, $('p.vw-hero-sub'));
		const nitSpan = append(sub, $('span.nit')) as HTMLSpanElement;
		nitSpan.textContent = 'NIT';
		sub.appendChild(document.createTextNode(' — встроенный AI-ассистент справа. Срединный путь между блокирующей помощью и слепым vibe-кодингом.'));
	}

	// ── AUTHOR CARD ───────────────────────────────────────────

	private renderAuthorCard(container: HTMLElement): void {
		const card = append(container, $('div.vw-author-card'));
		card.setAttribute('role', 'link');
		card.setAttribute('tabindex', '0');
		card.title = `Открыть ${VIBECODER_AUTHOR_URL}`;

		const avatar = append(card, $('div.vw-author-avatar'));
		// Инициалы автора — Д.О.
		avatar.textContent = 'Д.О.';

		const body = append(card, $('div.vw-author-body'));

		const label = append(body, $('div.vw-author-label'));
		label.textContent = 'Создатель Vibecoder';

		const name = append(body, $('div.vw-author-name'));
		name.textContent = VIBECODER_AUTHOR_NAME;

		const handle = append(body, $('div.vw-author-handle'));
		handle.textContent = `github.com/antsincgame  ·  ${VIBECODER_AUTHOR_HANDLE}`;

		const arrow = append(card, $('div.vw-author-arrow'));
		arrow.textContent = '→';

		const handler = () => {
			this.openerService.open(URI.parse(VIBECODER_AUTHOR_URL), { openExternal: true }).catch(err => {
				console.warn('[Vibecoder Welcome] open author URL failed:', err);
			});
		};
		card.addEventListener('click', handler);
		card.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				handler();
			}
		});
	}

	// ── FEATURE GRID ──────────────────────────────────────────

	private renderStartGrid(container: HTMLElement): void {
		const section = append(container, $('div.vw-section'));

		const title = append(section, $('div.vw-section-title'));
		title.textContent = 'Начало работы';

		const grid = append(section, $('div.vw-grid'));

		const cards: FeatureCard[] = [
			{
				icon: '🖥',
				label: 'LM Studio',
				description: 'Локальная модель. Приватно, бесплатно, без интернета.',
				key: 'Qwen 3 Coder 30B рекомендуется',
				commandId: 'vibecoder.testLMStudio',
			},
			{
				icon: '🔑',
				label: 'Облачные ключи',
				description: 'Anthropic, OpenAI, Gemini, OpenRouter, Polza.ai',
				key: 'API key → keychain',
				commandId: 'vibecoder.setApiKey',
			},
			{
				icon: '🔌',
				label: 'MCP-серверы',
				description: 'GitHub, Supabase, Perplexity и другие. NIT вызывает их сам.',
				key: '15 шаблонов наготове',
				commandId: 'vibecoder.openSettings',
			},
			{
				icon: '✨',
				label: 'Открыть NIT',
				description: 'AI-чат справа. Видит активный файл, выделение, табы.',
				key: 'AuxiliaryBar →',
				commandId: 'vibecoder.openNit',
			},
			{
				icon: '📂',
				label: 'Открыть папку',
				description: 'Начать работу над проектом.',
				key: 'Ctrl+K Ctrl+O',
				commandId: 'workbench.action.files.openFolder',
			},
			{
				icon: '🕓',
				label: 'Недавнее',
				description: 'Продолжить последний проект.',
				key: 'Ctrl+R',
				commandId: 'workbench.action.openRecent',
			},
		];

		for (const card of cards) {
			this.renderFeatureCard(grid, card);
		}
	}

	private renderFeatureCard(parent: HTMLElement, card: FeatureCard): void {
		const item = append(parent, $('div.vw-card'));
		item.setAttribute('role', 'button');
		item.setAttribute('tabindex', '0');

		const icon = append(item, $('div.vw-card-icon'));
		icon.textContent = card.icon;

		const label = append(item, $('div.vw-card-label'));
		label.textContent = card.label;

		const desc = append(item, $('div.vw-card-desc'));
		desc.textContent = card.description;

		if (card.key) {
			const key = append(item, $('div.vw-card-key'));
			key.textContent = card.key;
		}

		const handler = () => {
			if (card.commandId) {
				this.commandService.executeCommand(card.commandId).catch(err => {
					console.warn('[Vibecoder Welcome] command failed:', card.commandId, err);
				});
			} else if (card.url) {
				this.openerService.open(URI.parse(card.url), { openExternal: true }).catch(err => {
					console.warn('[Vibecoder Welcome] open URL failed:', card.url, err);
				});
			}
		};
		item.addEventListener('click', handler);
		item.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				handler();
			}
		});
	}

	// ── HELP ROW ──────────────────────────────────────────────

	private renderHelpRow(container: HTMLElement): void {
		const section = append(container, $('div.vw-section'));

		const title = append(section, $('div.vw-section-title'));
		title.textContent = 'Документация';

		const list = append(section, $('div.vw-help-list'));

		const items: HelpItem[] = [
			{ icon: '📜', label: 'Манифест Срединного пути', url: 'https://github.com/igor1000rr/vibecoder-/blob/main/docs/MANIFESTO.md' },
			{ icon: '📖', label: 'README', url: 'https://github.com/igor1000rr/vibecoder-/blob/main/README.md' },
			{ icon: '🛠', label: 'Системный промпт NIT', url: 'https://github.com/igor1000rr/vibecoder-/blob/main/docs/NIT_SYSTEM_PROMPT.md' },
			{ icon: '🗺', label: 'Roadmap', url: 'https://github.com/igor1000rr/vibecoder-/blob/main/docs/ROADMAP.md' },
			{ icon: '🐛', label: 'Сообщить о баге', url: 'https://github.com/igor1000rr/vibecoder-/issues' },
		];

		for (const item of items) {
			this.renderHelpItem(list, item);
		}
	}

	private renderHelpItem(parent: HTMLElement, item: HelpItem): void {
		const el = append(parent, $('div.vw-help-item'));
		el.setAttribute('role', 'link');
		el.setAttribute('tabindex', '0');

		const icon = append(el, $('span.vw-help-icon'));
		icon.textContent = item.icon;

		const label = append(el, $('span'));
		label.textContent = item.label;

		const handler = () => {
			if (item.url) {
				this.openerService.open(URI.parse(item.url), { openExternal: true }).catch(err => {
					console.warn('[Vibecoder Welcome] open URL failed:', err);
				});
			} else if (item.commandId) {
				this.commandService.executeCommand(item.commandId).catch(err => {
					console.warn('[Vibecoder Welcome] command failed:', err);
				});
			}
		};
		el.addEventListener('click', handler);
		el.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				handler();
			}
		});
	}

	// ── FOOTER ────────────────────────────────────────────────

	private renderFooter(container: HTMLElement): void {
		const footer = append(container, $('div.vw-footer'));

		const version = append(footer, $('span.vw-footer-version'));
		version.textContent = 'VIBECODER  v0.1.0-alpha  ·  Apache 2.0';

		const authorWrap = append(footer, $('span.vw-footer-author'));
		authorWrap.appendChild(document.createTextNode('Создан '));
		const authorName = append(authorWrap, $('span.vw-footer-author-name'));
		authorName.textContent = VIBECODER_AUTHOR_NAME;
		authorName.setAttribute('role', 'link');
		authorName.setAttribute('tabindex', '0');
		authorName.title = `Открыть ${VIBECODER_AUTHOR_URL}`;

		const handler = () => {
			this.openerService.open(URI.parse(VIBECODER_AUTHOR_URL), { openExternal: true }).catch(err => {
				console.warn('[Vibecoder Welcome] open author URL failed:', err);
			});
		};
		authorName.addEventListener('click', handler);
		authorName.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				handler();
			}
		});
	}
}

export function registerVibecoderWelcomeEditor(): void {
	Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(
			VibecoderWelcomeEditorPane,
			VibecoderWelcomeEditorPane.ID,
			localize('vibecoder.welcomeEditor.label', 'Vibecoder Welcome'),
		),
		[new SyncDescriptor(VibecoderWelcomeEditorInput)],
	);
}
