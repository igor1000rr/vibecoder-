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
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { IVibecoderLLMRouter } from '../llm/llmRouter.js';
import { VibecoderChatMessage, VibecoderModelInfo } from '../llm/llmProvider.js';
import { IVibecoderSkillsService } from '../skills/skillsService.js';
import { VibecoderProviderId } from '../../common/vibecoder.js';
import { buildChatSystemPrompt } from '../prompts/systemPrompts.js';

export const VIBECODER_VIEW_CONTAINER_ID = 'workbench.view.vibecoder';
export const VIBECODER_CHAT_VIEW_ID = 'vibecoder.nitView';

/**
 * Sparkle иконка в Activity Bar - вход в NIT.
 */
const nitViewIcon = registerIcon(
	'vibecoder-nit-icon',
	Codicon.sparkle,
	localize('vibecoderNitIcon', 'NIT — AI-ассистент Vibecoder.')
);

/**
 * NIT — AI-сайдбар Vibecoder.
 *
 * Регистрируется в AuxiliaryBar (правая панель, как в Cursor).
 * При первом подключении к провайдеру автоматически выбирает первую модель.
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
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@IVibecoderLLMRouter private readonly llmRouter: IVibecoderLLMRouter,
		@IVibecoderSkillsService private readonly skillsService: IVibecoderSkillsService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
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

		// ── Header: бренд NIT + provider/model selectors ─────────────────────
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
		brand.innerHTML = `
			<span style="
				font-family: 'Orbitron', 'Rajdhani', monospace;
				font-weight: 700;
				font-size: 16px;
				letter-spacing: 3px;
				background: linear-gradient(90deg, #ff3cc8 0%, #00f0ff 100%);
				-webkit-background-clip: text;
				background-clip: text;
				-webkit-text-fill-color: transparent;
				text-shadow: 0 0 12px rgba(255, 60, 200, 0.3);
			">NIT</span>
			<span style="
				font-size: 10px;
				color: var(--vscode-descriptionForeground);
				margin-left: 8px;
				letter-spacing: 1px;
			">AI ASSISTANT</span>
		`;

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

	private renderWelcome(): void {
		this.welcomeContainer.innerHTML = '';
		this.welcomeContainer.style.flex = '1';
		this.welcomeContainer.style.overflowY = 'auto';
		this.welcomeContainer.style.padding = '20px 16px';
		this.welcomeContainer.style.display = 'flex';
		this.welcomeContainer.style.flexDirection = 'column';
		this.welcomeContainer.style.gap = '16px';

		const logo = append(this.welcomeContainer, $('div'));
		logo.style.textAlign = 'center';
		logo.style.padding = '20px 0';
		logo.innerHTML = `
			<div style="
				font-family: 'Orbitron', 'Rajdhani', monospace;
				font-weight: 700;
				font-size: 42px;
				letter-spacing: 8px;
				background: linear-gradient(135deg, #ff3cc8 0%, #00f0ff 50%, #ff3cc8 100%);
				background-size: 200% auto;
				-webkit-background-clip: text;
				background-clip: text;
				-webkit-text-fill-color: transparent;
				text-shadow: 0 0 24px rgba(255, 60, 200, 0.4);
				animation: nit-shimmer 4s linear infinite;
			">NIT</div>
			<div style="
				font-family: monospace;
				font-size: 10px;
				color: var(--vscode-descriptionForeground);
				margin-top: 4px;
				letter-spacing: 4px;
				opacity: 0.7;
			">▸ NEURAL INTERFACE TERMINAL ◂</div>
		`;

		const styleEl = append(this.welcomeContainer, $('style'));
		styleEl.textContent = `
			@keyframes nit-shimmer {
				0% { background-position: 0% center; }
				100% { background-position: 200% center; }
			}
			.nit-action-card:hover {
				border-color: #ff3cc8 !important;
				box-shadow: 0 0 12px rgba(255, 60, 200, 0.25) !important;
				transform: translateY(-1px);
			}
			.nit-action-card {
				transition: all 0.15s ease;
			}
		`;

		const subtitle = append(this.welcomeContainer, $('div'));
		subtitle.style.textAlign = 'center';
		subtitle.style.color = 'var(--vscode-foreground)';
		subtitle.style.fontSize = '13px';
		subtitle.style.lineHeight = '1.5';
		subtitle.style.padding = '0 12px';
		subtitle.innerHTML = `AI-ассистент Vibecoder с упором на<br><b style="color: #ff3cc8;">локальные модели</b> и <b style="color: #00f0ff;">приватность</b>.`;

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

		const actionsGrid = append(this.welcomeContainer, $('div'));
		actionsGrid.style.display = 'flex';
		actionsGrid.style.flexDirection = 'column';
		actionsGrid.style.gap = '8px';
		actionsGrid.style.marginTop = '8px';

		for (const action of actions) {
			const card = append(actionsGrid, $('div'));
			card.className = 'nit-action-card';
			card.style.padding = '10px 12px';
			card.style.background = 'var(--vscode-editor-background)';
			card.style.border = '1px solid var(--vscode-panel-border)';
			card.style.borderRadius = '6px';
			card.style.cursor = 'pointer';
			card.style.display = 'flex';
			card.style.gap = '10px';
			card.style.alignItems = 'flex-start';

			const iconEl = append(card, $('div'));
			iconEl.style.fontSize = '18px';
			iconEl.style.lineHeight = '1';
			iconEl.style.paddingTop = '2px';
			iconEl.textContent = action.icon;

			const textBlock = append(card, $('div'));
			textBlock.style.flex = '1';

			const titleEl = append(textBlock, $('div'));
			titleEl.style.fontWeight = '600';
			titleEl.style.fontSize = '12px';
			titleEl.textContent = action.title;

			const descEl = append(textBlock, $('div'));
			descEl.style.fontSize = '11px';
			descEl.style.color = 'var(--vscode-descriptionForeground)';
			descEl.style.marginTop = '2px';
			descEl.textContent = action.description;

			card.addEventListener('click', () => {
				this.commandService.executeCommand(action.commandId).catch(err => {
					console.error('NIT action failed:', err);
				});
			});
		}

		const footer = append(this.welcomeContainer, $('div'));
		footer.style.marginTop = 'auto';
		footer.style.padding = '12px 0 0 0';
		footer.style.borderTop = '1px solid var(--vscode-panel-border)';
		footer.style.fontSize = '10px';
		footer.style.color = 'var(--vscode-descriptionForeground)';
		footer.style.fontFamily = 'monospace';
		footer.style.lineHeight = '1.6';
		footer.style.letterSpacing = '0.3px';
		footer.innerHTML = `▸ <b>Ctrl+Shift+P</b> → "Vibecoder" для всех команд<br>▸ Напиши что-нибудь снизу — welcome скроется автоматически`;
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

	private async onProviderChange(): Promise<void> {
		const providerId = this.providerSelect.value as VibecoderProviderId;
		this.modelSelect.innerHTML = '';
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
			this.modelSelect.innerHTML = '';
			const errOpt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			errOpt.textContent = '(unavailable)';
			const message = e instanceof Error ? e.message : String(e);
			this.statusLine.textContent = `▸ ${providerId}: ${message}`;
			// Для LM Studio показываем чёткую подсказку прямо в чате
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

		this.modelSelect.innerHTML = '';
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

		// АВТО-ВЫБОР первой модели чтобы юзеру не приходилось тыкать в dropdown
		if (models.length > 0) {
			this.modelSelect.value = models[0].id;
		}

		this.statusLine.textContent = `▸ ${providerId}: ${models.length} model(s) · ${models[0].displayName} selected · ready`;
	}

	private resetConversation(): void {
		this.history.length = 0;
		this.messagesContainer.innerHTML = '';
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

		if (this.history.length === 0) {
			const skillsIndex = this.skillsService.getDescriptionsForPrompt();
			this.history.push({
				role: 'system',
				content: buildChatSystemPrompt({ skillsIndex }),
			});
		}

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
				this.statusLine.textContent = `▸ done · ${accumulated.length} chars`;
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
