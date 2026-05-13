/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Welcome-редактор Vibecoder.
 *
 * Стандартный VS Code-style Welcome page: две колонки (Start / Help),
 * action-items в виде ссылок, нейтральные цвета через --vscode-* переменные.
 *
 * Открывается как обычный таб через VS Code OSS IEditorPaneRegistry.
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

/** Автор Vibecoder — Дмитрий Орлов, https://github.com/antsincgame */
const VIBECODER_AUTHOR_NAME = 'Дмитрий Орлов';
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
		return Codicon.info;
	}

	override matches(other: EditorInput | unknown): boolean {
		return other instanceof VibecoderWelcomeEditorInput;
	}
}

const WELCOME_STYLES = `
.vibecoder-welcome-editor {
	height: 100%;
	width: 100%;
	overflow: auto;
	background: var(--vscode-editor-background);
	color: var(--vscode-foreground);
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
}

.vw-container {
	max-width: 1100px;
	margin: 0 auto;
	padding: 60px 40px 40px 40px;
}

.vw-header {
	margin-bottom: 12px;
}

.vw-title {
	font-size: 36px;
	font-weight: 300;
	line-height: 1.2;
	margin: 0 0 8px 0;
	color: var(--vscode-foreground);
}

.vw-subtitle {
	font-size: 16px;
	font-weight: 400;
	color: var(--vscode-descriptionForeground);
	margin: 0;
	line-height: 1.5;
}

.vw-author-line {
	font-size: 13px;
	color: var(--vscode-descriptionForeground);
	margin: 8px 0 36px 0;
}

.vw-author-link {
	color: var(--vscode-textLink-foreground);
	text-decoration: none;
	cursor: pointer;
}

.vw-author-link:hover {
	color: var(--vscode-textLink-activeForeground);
	text-decoration: underline;
}

.vw-columns {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 60px;
}

@media (max-width: 760px) {
	.vw-columns { grid-template-columns: 1fr; gap: 32px; }
	.vw-container { padding: 40px 24px 32px 24px; }
	.vw-title { font-size: 28px; }
}

.vw-section-title {
	font-size: 18px;
	font-weight: 600;
	margin: 0 0 16px 0;
	color: var(--vscode-foreground);
}

.vw-action-list {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.vw-action {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	padding: 8px 10px;
	border-radius: 4px;
	cursor: pointer;
	color: var(--vscode-textLink-foreground);
	text-decoration: none;
	transition: background-color 0.1s ease;
}

.vw-action:hover {
	background: var(--vscode-list-hoverBackground);
	color: var(--vscode-textLink-activeForeground);
}

.vw-action:focus {
	outline: 1px solid var(--vscode-focusBorder);
	outline-offset: -1px;
}

.vw-action-icon {
	font-size: 16px;
	line-height: 20px;
	flex-shrink: 0;
	width: 20px;
	text-align: center;
}

.vw-action-body {
	flex: 1;
	min-width: 0;
}

.vw-action-label {
	font-size: 13px;
	line-height: 20px;
}

.vw-action-desc {
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	margin-top: 2px;
	line-height: 1.4;
}

.vw-footer {
	margin-top: 48px;
	padding-top: 20px;
	border-top: 1px solid var(--vscode-panel-border);
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}

.vw-footer-author {
	font-size: 12px;
}
`;

interface WelcomeAction {
	readonly icon: string;
	readonly label: string;
	readonly description?: string;
	readonly commandId?: string;
	readonly url?: string;
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
		// Layout управляется CSS — flexbox/grid
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

		// ── Header ──
		const header = append(container, $('div.vw-header'));
		const title = append(header, $('h1.vw-title'));
		title.textContent = 'Welcome to Vibecoder';
		const subtitle = append(header, $('p.vw-subtitle'));
		subtitle.textContent = 'AI-IDE с упором на локальные модели и приватность. NIT — встроенный AI-ассистент справа.';

		// ── Author line (под subtitle) ──
		const authorLine = append(container, $('div.vw-author-line'));
		authorLine.appendChild(document.createTextNode('Создатель: '));
		const authorLink = append(authorLine, $('span.vw-author-link')) as HTMLSpanElement;
		authorLink.textContent = VIBECODER_AUTHOR_NAME;
		authorLink.title = VIBECODER_AUTHOR_URL;
		authorLink.setAttribute('role', 'link');
		authorLink.setAttribute('tabindex', '0');
		const openAuthor = () => {
			this.openerService.open(URI.parse(VIBECODER_AUTHOR_URL), { openExternal: true }).catch(err => {
				console.warn('[Vibecoder Welcome] open author URL failed:', err);
			});
		};
		authorLink.addEventListener('click', openAuthor);
		authorLink.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openAuthor();
			}
		});

		// ── Columns ──
		const columns = append(container, $('div.vw-columns'));

		// Левая: Start
		const startCol = append(columns, $('div'));
		const startTitle = append(startCol, $('div.vw-section-title'));
		startTitle.textContent = 'Начало работы';
		const startList = append(startCol, $('div.vw-action-list'));

		const startActions: WelcomeAction[] = [
			{
				icon: '📂',
				label: 'Открыть папку...',
				commandId: 'workbench.action.files.openFolder',
			},
			{
				icon: '🕓',
				label: 'Открыть недавнее',
				commandId: 'workbench.action.openRecent',
			},
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
				icon: '✨',
				label: 'Открыть NIT-сайдбар',
				description: 'Чат с AI в правой панели',
				commandId: 'vibecoder.openNit',
			},
		];

		for (const action of startActions) {
			this.renderActionItem(startList, action);
		}

		// Правая: Help
		const helpCol = append(columns, $('div'));
		const helpTitle = append(helpCol, $('div.vw-section-title'));
		helpTitle.textContent = 'Помощь и документация';
		const helpList = append(helpCol, $('div.vw-action-list'));

		const helpActions: WelcomeAction[] = [
			{
				icon: '👤',
				label: 'О создателе',
				description: `${VIBECODER_AUTHOR_NAME} · github.com/antsincgame`,
				url: VIBECODER_AUTHOR_URL,
			},
			{
				icon: '📜',
				label: 'Манифест Срединного пути',
				description: 'Как осознанно использовать AI в коде',
				url: 'https://github.com/igor1000rr/vibecoder-/blob/main/docs/MANIFESTO.md',
			},
			{
				icon: '📖',
				label: 'README проекта',
				url: 'https://github.com/igor1000rr/vibecoder-/blob/main/README.md',
			},
			{
				icon: '🛠',
				label: 'Системный промпт NIT',
				description: 'Что NIT получает в каждый запрос',
				url: 'https://github.com/igor1000rr/vibecoder-/blob/main/docs/NIT_SYSTEM_PROMPT.md',
			},
			{
				icon: '🗺',
				label: 'Roadmap',
				url: 'https://github.com/igor1000rr/vibecoder-/blob/main/docs/ROADMAP.md',
			},
			{
				icon: '🐛',
				label: 'Сообщить о баге',
				url: 'https://github.com/igor1000rr/vibecoder-/issues',
			},
		];

		for (const action of helpActions) {
			this.renderActionItem(helpList, action);
		}

		// ── Footer (два блока: слева версия, справа автор) ──
		const footer = append(container, $('div.vw-footer'));

		const footerLeft = append(footer, $('span'));
		footerLeft.textContent = 'Vibecoder v0.1.0 alpha · Apache 2.0';

		const footerRight = append(footer, $('span.vw-footer-author'));
		footerRight.appendChild(document.createTextNode('Создан '));
		const footerAuthorLink = append(footerRight, $('span.vw-author-link')) as HTMLSpanElement;
		footerAuthorLink.textContent = VIBECODER_AUTHOR_NAME;
		footerAuthorLink.title = VIBECODER_AUTHOR_URL;
		footerAuthorLink.setAttribute('role', 'link');
		footerAuthorLink.setAttribute('tabindex', '0');
		footerAuthorLink.addEventListener('click', openAuthor);
		footerAuthorLink.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openAuthor();
			}
		});
	}

	private renderActionItem(parent: HTMLElement, action: WelcomeAction): void {
		const item = append(parent, $('div.vw-action'));
		item.setAttribute('role', 'button');
		item.setAttribute('tabindex', '0');

		const iconEl = append(item, $('div.vw-action-icon'));
		iconEl.textContent = action.icon;

		const body = append(item, $('div.vw-action-body'));
		const labelEl = append(body, $('div.vw-action-label'));
		labelEl.textContent = action.label;
		if (action.description) {
			const descEl = append(body, $('div.vw-action-desc'));
			descEl.textContent = action.description;
		}

		const handler = () => this.handleAction(action);
		item.addEventListener('click', handler);
		item.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				handler();
			}
		});
	}

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
