/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Полноэкранный анимированный Welcome-редактор Vibecoder.
 *
 * Это кастомный EditorPane, который открывается как обычный таб в editor area
 * и занимает всё доступное пространство. Внутри — большой hero-блок с лого NIT,
 * cyber-grid фоном, плавающими частицами, и grid'ом action-карточек 2×3.
 *
 * Регистрируется через стандартный VS Code OSS `IEditorPaneRegistry`:
 *  - `VibecoderWelcomeEditorInput` — descriptor таба (имя, иконка, URI)
 *  - `VibecoderWelcomeEditorPane` — DOM-рендер этого таба
 *  - `registerVibecoderWelcomeEditor()` — связывает Input ↔ Pane через
 *     EditorPaneDescriptor + SyncDescriptor
 *
 * Trusted Types: весь рендер через `document.createElement` / `$`,
 * никакого `innerHTML`. Стили — одним `<style>` тэгом через `textContent`
 * (это разрешено: style-тэги текст не парсят как HTML).
 */

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorPaneDescriptor, IEditorPaneRegistry, EditorExtensions } from '../../../../browser/editor.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
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

/**
 * EditorInput для welcome-таба.
 *
 * Простой singleton-style input — не имеет DI зависимостей, не хранит state,
 * только метаданные таба (имя, ресурс, иконка).
 */
export class VibecoderWelcomeEditorInput extends EditorInput {

	static readonly ID = 'vibecoder.welcomeEditor.input';

	/**
	 * Виртуальный URI таба. Scheme `vibecoder-welcome` — собственный,
	 * не пересекается с file/untitled/etc.
	 */
	static readonly RESOURCE = URI.from({ scheme: 'vibecoder-welcome', authority: 'nit', path: '/welcome' });

	override get typeId(): string {
		return VibecoderWelcomeEditorInput.ID;
	}

	override get resource(): URI {
		return VibecoderWelcomeEditorInput.RESOURCE;
	}

	override getName(): string {
		return localize('vibecoder.welcomeEditor.name', 'Welcome — Vibecoder');
	}

	override getIcon(): ThemeIcon | undefined {
		return Codicon.sparkle;
	}

	override matches(other: EditorInput | unknown): boolean {
		return other instanceof VibecoderWelcomeEditorInput;
	}
}

/**
 * Большой CSS для welcome-страницы. Все классы с префиксом `.vw-`.
 * Инжектится через `<style>` тэг — Trusted Types safe.
 */
const WELCOME_STYLES = `
@keyframes vw-shimmer {
	0%   { background-position: 0% center; }
	100% { background-position: 200% center; }
}

@keyframes vw-pulse-glow {
	0%, 100% {
		text-shadow:
			0 0 30px rgba(255, 60, 200, 0.50),
			0 0 60px rgba(255, 60, 200, 0.25),
			0 0 120px rgba(0, 240, 255, 0.15);
	}
	50% {
		text-shadow:
			0 0 45px rgba(255, 60, 200, 0.85),
			0 0 90px rgba(0, 240, 255, 0.50),
			0 0 180px rgba(157, 78, 221, 0.30);
	}
}

@keyframes vw-spotlight-pulse {
	0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); }
	50%      { opacity: 1.00; transform: translate(-50%, -50%) scale(1.12); }
}

@keyframes vw-grid-scroll {
	0%   { background-position: 0 0; }
	100% { background-position: 60px 60px; }
}

@keyframes vw-fade-in {
	from { opacity: 0; transform: translateY(20px); }
	to   { opacity: 1; transform: translateY(0); }
}

@keyframes vw-particle-1 {
	0%   { transform: translate(0, 0);        opacity: 0; }
	20%  {                                    opacity: 0.7; }
	100% { transform: translate(60px, -120px); opacity: 0; }
}
@keyframes vw-particle-2 {
	0%   { transform: translate(0, 0);         opacity: 0; }
	25%  {                                     opacity: 0.6; }
	100% { transform: translate(-80px, -110px); opacity: 0; }
}
@keyframes vw-particle-3 {
	0%   { transform: translate(0, 0);        opacity: 0; }
	30%  {                                    opacity: 0.5; }
	100% { transform: translate(40px, -140px); opacity: 0; }
}

.vibecoder-welcome-editor {
	position: relative;
	height: 100%;
	width: 100%;
	overflow: auto;
	background: var(--vscode-editor-background);
	color: var(--vscode-foreground);
	font-family: var(--vscode-font-family);
}

/* ── Cyber-grid фон ────────────────────────────────────────────── */
.vw-grid-bg {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 0;
	background-image:
		linear-gradient(rgba(255, 60, 200, 0.05) 1px, transparent 1px),
		linear-gradient(90deg, rgba(0, 240, 255, 0.05) 1px, transparent 1px);
	background-size: 60px 60px;
	animation: vw-grid-scroll 20s linear infinite;
	mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, black 0%, transparent 80%);
	-webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, black 0%, transparent 80%);
}

/* ── Плавающие частицы ─────────────────────────────────────────── */
.vw-particles {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 1;
	overflow: hidden;
}

.vw-particle {
	position: absolute;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	box-shadow: 0 0 16px currentColor;
}

.vw-particle.p1  { top: 25%; left: 12%; color: #ff3cc8; animation: vw-particle-1 8s ease-out infinite; }
.vw-particle.p2  { top: 70%; left: 85%; color: #00f0ff; animation: vw-particle-2 9s ease-out infinite 1s; }
.vw-particle.p3  { top: 45%; left: 18%; color: #9d4edd; animation: vw-particle-3 10s ease-out infinite 2s; }
.vw-particle.p4  { top: 30%; left: 78%; color: #ff3cc8; animation: vw-particle-1 11s ease-out infinite 3s; }
.vw-particle.p5  { top: 60%; left: 50%; color: #00f0ff; animation: vw-particle-2 9.5s ease-out infinite 1.5s; }
.vw-particle.p6  { top: 80%; left: 22%; color: #ff3cc8; animation: vw-particle-3 8.5s ease-out infinite 2.5s; }
.vw-particle.p7  { top: 15%; left: 60%; color: #9d4edd; animation: vw-particle-1 10s ease-out infinite 0.5s; }
.vw-particle.p8  { top: 55%; left: 8%;  color: #00f0ff; animation: vw-particle-2 11s ease-out infinite 3.5s; }
.vw-particle.p9  { top: 75%; left: 65%; color: #ff3cc8; animation: vw-particle-3 9s ease-out infinite 1.8s; }
.vw-particle.p10 { top: 35%; left: 92%; color: #9d4edd; animation: vw-particle-1 10.5s ease-out infinite 2.2s; }
.vw-particle.p11 { top: 50%; left: 38%; color: #00f0ff; animation: vw-particle-2 8.5s ease-out infinite 3.2s; }
.vw-particle.p12 { top: 90%; left: 45%; color: #ff3cc8; animation: vw-particle-3 11s ease-out infinite 0.8s; }

/* ── Hero-секция (центральный экран) ───────────────────────────── */
.vw-hero {
	position: relative;
	z-index: 2;
	text-align: center;
	padding: 80px 20px 60px 20px;
	min-height: 56vh;
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: center;
	animation: vw-fade-in 0.8s ease-out;
}

.vw-spotlight {
	position: absolute;
	top: 50%;
	left: 50%;
	width: 600px;
	height: 600px;
	pointer-events: none;
	border-radius: 50%;
	background: radial-gradient(circle, rgba(255, 60, 200, 0.18) 0%, rgba(0, 240, 255, 0.08) 40%, transparent 70%);
	filter: blur(50px);
	animation: vw-spotlight-pulse 5s ease-in-out infinite;
	z-index: -1;
}

.vw-logo {
	font-family: 'Orbitron', 'Rajdhani', monospace;
	font-weight: 900;
	font-size: clamp(80px, 14vw, 160px);
	letter-spacing: clamp(12px, 2vw, 28px);
	line-height: 1;
	background: linear-gradient(135deg, #ff3cc8 0%, #00f0ff 50%, #ff3cc8 100%);
	background-size: 200% auto;
	-webkit-background-clip: text;
	background-clip: text;
	-webkit-text-fill-color: transparent;
	animation: vw-shimmer 4s linear infinite, vw-pulse-glow 3s ease-in-out infinite;
	user-select: none;
}

.vw-subtitle {
	margin-top: 16px;
	font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
	font-size: clamp(11px, 1.2vw, 15px);
	letter-spacing: clamp(4px, 0.8vw, 10px);
	color: var(--vscode-descriptionForeground);
	opacity: 0.8;
	animation: vw-fade-in 1s ease-out 0.3s both;
}

.vw-tagline {
	margin-top: 36px;
	font-size: clamp(14px, 1.5vw, 18px);
	color: var(--vscode-foreground);
	opacity: 0.9;
	max-width: 720px;
	line-height: 1.5;
	animation: vw-fade-in 1s ease-out 0.5s both;
}

.vw-tagline .vw-accent-m { color: #ff3cc8; font-weight: 600; }
.vw-tagline .vw-accent-c { color: #00f0ff; font-weight: 600; }
.vw-tagline .vw-accent-p { color: #9d4edd; font-weight: 600; }

.vw-madhya {
	margin-top: 18px;
	font-style: italic;
	font-size: 13px;
	color: var(--vscode-descriptionForeground);
	opacity: 0.7;
	letter-spacing: 3px;
	animation: vw-fade-in 1s ease-out 0.7s both;
}

/* ── Action grid ───────────────────────────────────────────────── */
.vw-actions {
	position: relative;
	z-index: 2;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	gap: 16px;
	max-width: 920px;
	margin: 0 auto 60px auto;
	padding: 0 24px;
	animation: vw-fade-in 1s ease-out 0.9s both;
}

.vw-card {
	position: relative;
	padding: 22px 22px 22px 28px;
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-panel-border);
	border-radius: 12px;
	cursor: pointer;
	transition: all 0.22s ease;
	overflow: hidden;
}

.vw-card::before {
	content: '';
	position: absolute;
	left: 0; top: 0; bottom: 0;
	width: 4px;
	background: linear-gradient(180deg, #ff3cc8 0%, #00f0ff 100%);
	opacity: 0.5;
	transition: opacity 0.22s ease;
}

.vw-card::after {
	content: '';
	position: absolute;
	inset: 0;
	background: radial-gradient(circle at 50% -20%, rgba(255, 60, 200, 0.18) 0%, transparent 60%);
	opacity: 0;
	transition: opacity 0.22s ease;
	pointer-events: none;
}

.vw-card:hover {
	border-color: rgba(255, 60, 200, 0.6);
	box-shadow: 0 8px 32px rgba(255, 60, 200, 0.20), 0 0 0 1px rgba(255, 60, 200, 0.15);
	transform: translateY(-3px);
}

.vw-card:hover::before { opacity: 1; }
.vw-card:hover::after  { opacity: 1; }

.vw-card-icon {
	font-size: 28px;
	line-height: 1;
	margin-bottom: 12px;
	filter: drop-shadow(0 0 8px rgba(255, 60, 200, 0.45));
}

.vw-card-title {
	font-weight: 700;
	font-size: 15px;
	margin-bottom: 6px;
	color: var(--vscode-foreground);
	letter-spacing: 0.3px;
}

.vw-card-desc {
	font-size: 12.5px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.5;
}

/* ── Footer ────────────────────────────────────────────────────── */
.vw-footer {
	position: relative;
	z-index: 2;
	text-align: center;
	padding: 24px 20px 40px 20px;
	font-family: 'JetBrains Mono', monospace;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	opacity: 0.65;
	letter-spacing: 2px;
	animation: vw-fade-in 1s ease-out 1.1s both;
}

.vw-footer .vw-footer-version {
	color: #00f0ff;
	font-weight: 600;
}

.vw-footer .vw-footer-brand {
	color: #ff3cc8;
	font-weight: 600;
}
`;

/**
 * Описание action-карточки в grid'е.
 */
interface WelcomeAction {
	readonly icon: string;
	readonly title: string;
	readonly description: string;
	/** Команда VS Code OSS или Vibecoder, выполняемая по клику. */
	readonly commandId?: string;
	/** Альтернатива command — открыть внешний URL через openerService. */
	readonly url?: string;
}

/**
 * EditorPane — DOM-рендер welcome-страницы.
 *
 * VS Code OSS вызывает:
 *  - `createEditor(parent)` один раз при создании pane
 *  - `setInput(input, ...)` при открытии нашего таба
 *  - `layout(dim)` при ресайзе
 *  - `focus()` когда таб становится активным
 *  - `dispose()` когда таб закрывается
 *
 * Мы рендерим всё в `createEditor` (один раз), layout не требует ничего
 * (flexbox разрулит), focus только переводит tabindex на root для accessibility.
 */
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
		// Контент статический, ничего больше не нужно
	}

	override layout(_dimension: Dimension): void {
		// Layout управляется flex/grid в CSS — ничего не делаем
	}

	override focus(): void {
		this.rootEl?.focus();
	}

	/**
	 * Основной рендер welcome-страницы.
	 *
	 * Структура:
	 *   .vibecoder-welcome-editor (root)
	 *   ├── <style>
	 *   ├── .vw-grid-bg          (декоративная сетка)
	 *   ├── .vw-particles        (12 плавающих частиц)
	 *   ├── .vw-hero             (центральный hero блок)
	 *   │   ├── .vw-spotlight    (фоновое радиальное свечение)
	 *   │   ├── .vw-logo "NIT"   (огромное анимированное лого)
	 *   │   ├── .vw-subtitle
	 *   │   ├── .vw-tagline
	 *   │   └── .vw-madhya
	 *   ├── .vw-actions          (grid 2×3 action-карточек)
	 *   └── .vw-footer           (версия + бренд)
	 */
	private renderContent(parent: HTMLElement): void {
		parent.classList.add('vibecoder-welcome-editor');
		// tabindex для focus/accessibility
		parent.tabIndex = 0;

		// Стили инжектим один раз
		const styleEl = append(parent, $('style'));
		styleEl.textContent = WELCOME_STYLES;

		// Декоративный фон
		append(parent, $('div.vw-grid-bg'));
		const particles = append(parent, $('div.vw-particles'));
		for (let i = 1; i <= 12; i++) {
			append(particles, $('div.vw-particle.p' + i));
		}

		// ── Hero ──
		const hero = append(parent, $('div.vw-hero'));
		append(hero, $('div.vw-spotlight'));

		const logo = append(hero, $('div.vw-logo'));
		logo.textContent = 'NIT';

		const subtitle = append(hero, $('div.vw-subtitle'));
		subtitle.textContent = '▸ NEURAL INTERFACE TERMINAL ◂';

		const tagline = append(hero, $('div.vw-tagline'));
		tagline.appendChild(document.createTextNode('Vibecoder · '));
		const accAI = append(tagline, $('span.vw-accent-m'));
		accAI.textContent = 'AI-IDE';
		tagline.appendChild(document.createTextNode(' с упором на '));
		const accLocal = append(tagline, $('span.vw-accent-c'));
		accLocal.textContent = 'локальные модели';
		tagline.appendChild(document.createTextNode(' и '));
		const accPriv = append(tagline, $('span.vw-accent-p'));
		accPriv.textContent = 'приватность';
		tagline.appendChild(document.createTextNode('.'));

		const madhya = append(hero, $('div.vw-madhya'));
		madhya.textContent = '« Срединный путь · Madhya »';

		// ── Action grid ──
		const actions: WelcomeAction[] = [
			{
				icon: '📂',
				title: 'Открыть папку',
				description: 'Подключи проект и начни кодить с NIT',
				commandId: 'workbench.action.files.openFolder',
			},
			{
				icon: '🕓',
				title: 'Недавние',
				description: 'Открыть один из последних проектов',
				commandId: 'workbench.action.openRecent',
			},
			{
				icon: '🖥',
				title: 'Подключить LM Studio',
				description: 'Локальная модель — приватно и быстро',
				commandId: 'vibecoder.testLMStudio',
			},
			{
				icon: '🔑',
				title: 'Добавить API-ключ',
				description: 'Anthropic, OpenAI, Gemini, OpenRouter',
				commandId: 'vibecoder.setApiKey',
			},
			{
				icon: '✨',
				title: 'Открыть NIT-сайдбар',
				description: 'Чат с AI справа — Cursor-style',
				commandId: 'vibecoder.openNit',
			},
			{
				icon: '📜',
				title: 'Манифест Срединного пути',
				description: 'Как использовать AI в коде осознанно',
				url: 'https://github.com/igor1000rr/vibecoder-/blob/main/docs/MANIFESTO.md',
			},
		];

		const actionsGrid = append(parent, $('div.vw-actions'));
		for (const action of actions) {
			const card = append(actionsGrid, $('div.vw-card'));
			card.setAttribute('role', 'button');
			card.setAttribute('tabindex', '0');
			card.title = action.commandId
				? `Выполнить: ${action.commandId}`
				: (action.url ?? '');

			const iconEl = append(card, $('div.vw-card-icon'));
			iconEl.textContent = action.icon;

			const titleEl = append(card, $('div.vw-card-title'));
			titleEl.textContent = action.title;

			const descEl = append(card, $('div.vw-card-desc'));
			descEl.textContent = action.description;

			const handler = () => this.handleAction(action);
			card.addEventListener('click', handler);
			card.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					handler();
				}
			});
		}

		// ── Footer ──
		const footer = append(parent, $('div.vw-footer'));
		const fBrand = append(footer, $('span.vw-footer-brand'));
		fBrand.textContent = 'VIBECODER';
		footer.appendChild(document.createTextNode(' · '));
		const fVersion = append(footer, $('span.vw-footer-version'));
		fVersion.textContent = 'v0.1.0 alpha';
		footer.appendChild(document.createTextNode(' · Apache 2.0 · vibecoding.by'));
	}

	/**
	 * Выполняет команду или открывает URL для action-карточки.
	 */
	private handleAction(action: WelcomeAction): void {
		if (action.commandId) {
			this.commandService.executeCommand(action.commandId).catch(err => {
				console.warn('[Vibecoder Welcome] command failed:', action.commandId, err);
			});
			return;
		}
		if (action.url) {
			this.openerService.open(URI.parse(action.url), { openExternal: true }).catch(err => {
				console.warn('[Vibecoder Welcome] open URL failed:', action.url, err);
			});
		}
	}
}

/**
 * Регистрирует Welcome-редактор в VS Code OSS:
 *  - сам EditorPane (DOM-рендер) через `EditorPaneDescriptor`
 *  - связь с `VibecoderWelcomeEditorInput` через `SyncDescriptor`
 *
 * После этой регистрации вызов
 *     editorService.openEditor(new VibecoderWelcomeEditorInput(), ...)
 * автоматически создаст экземпляр VibecoderWelcomeEditorPane и покажет его
 * в editor area.
 */
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
