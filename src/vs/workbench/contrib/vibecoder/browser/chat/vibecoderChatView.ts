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
import { Codicon } from '../../../../../base/common/codicons.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { $, append } from '../../../../../base/browser/dom.js';
import { IVibecoderLLMRouter } from '../llm/llmRouter.js';
import { VibecoderChatMessage, VibecoderModelInfo } from '../llm/llmProvider.js';
import { IVibecoderSkillsService } from '../skills/skillsService.js';
import { VibecoderProviderId } from '../../common/vibecoder.js';
import { buildChatSystemPrompt } from '../prompts/systemPrompts.js';

export const VIBECODER_VIEW_CONTAINER_ID = 'workbench.view.vibecoder';
export const VIBECODER_CHAT_VIEW_ID = 'vibecoder.chatView';

const vibecoderViewIcon = registerIcon(
	'vibecoder-view-icon',
	Codicon.sparkle,
	localize('vibecoderViewIcon', 'View icon of the Vibecoder chat view.')
);

/**
 * Сайдбар с чатом.
 * MVP: vanilla DOM (без React, чтобы не тащить tsx pipeline сейчас).
 * Полноценный React UI - в следующей итерации.
 */
export class VibecoderChatView extends ViewPane {

	static readonly ID = VIBECODER_CHAT_VIEW_ID;

	private messagesContainer!: HTMLElement;
	private inputElement!: HTMLTextAreaElement;
	private sendButton!: HTMLButtonElement;
	private stopButton!: HTMLButtonElement;
	private statusLine!: HTMLElement;
	private providerSelect!: HTMLSelectElement;
	private modelSelect!: HTMLSelectElement;

	private readonly history: VibecoderChatMessage[] = [];
	private abortController: AbortController | undefined;

	/** Кеш моделей по провайдеру; обновляется при смене провайдера */
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
		@ITelemetryService telemetryService: ITelemetryService,
		@IVibecoderLLMRouter private readonly llmRouter: IVibecoderLLMRouter,
		@IVibecoderSkillsService private readonly skillsService: IVibecoderSkillsService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('vibecoder-chat-view');
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';
		container.style.padding = '8px';
		container.style.fontFamily = 'var(--vscode-font-family)';
		container.style.fontSize = 'var(--vscode-font-size)';

		// Header с провайдером/моделью
		const header = append(container, $('div'));
		header.style.padding = '4px 0 8px 0';
		header.style.borderBottom = '1px solid var(--vscode-panel-border)';
		header.style.marginBottom = '8px';
		header.style.display = 'flex';
		header.style.gap = '4px';
		header.style.alignItems = 'center';

		const title = append(header, $('span'));
		title.textContent = 'Vibecoder';
		title.style.fontWeight = '600';
		title.style.marginRight = '8px';

		this.providerSelect = append(header, $('select')) as HTMLSelectElement;
		this.styleSelect(this.providerSelect);
		this.providerSelect.style.flex = '1';
		for (const p of [
			{ id: 'lmstudio', label: 'LM Studio (local)' },
			{ id: 'anthropic', label: 'Anthropic' },
			{ id: 'openai', label: 'OpenAI' },
			{ id: 'gemini', label: 'Gemini' },
			{ id: 'openrouter', label: 'OpenRouter' },
		] as Array<{ id: VibecoderProviderId; label: string }>) {
			const opt = append(this.providerSelect, $('option')) as HTMLOptionElement;
			opt.value = p.id;
			opt.textContent = p.label;
		}

		this.modelSelect = append(header, $('select')) as HTMLSelectElement;
		this.styleSelect(this.modelSelect);
		this.modelSelect.style.flex = '2';

		this.providerSelect.addEventListener('change', () => this.onProviderChange());

		// Messages
		this.messagesContainer = append(container, $('div'));
		this.messagesContainer.style.flex = '1';
		this.messagesContainer.style.overflowY = 'auto';
		this.messagesContainer.style.padding = '4px';
		this.messagesContainer.style.gap = '8px';
		this.messagesContainer.style.display = 'flex';
		this.messagesContainer.style.flexDirection = 'column';

		this.appendMessage('system', 'Vibecoder Chat (alpha). Выбери провайдера и модель сверху, потом напиши сообщение. Для облачных провайдеров: Ctrl+Shift+P → "Vibecoder: Set API Key".');

		// Status
		this.statusLine = append(container, $('div'));
		this.statusLine.style.padding = '4px 0';
		this.statusLine.style.fontSize = '11px';
		this.statusLine.style.color = 'var(--vscode-descriptionForeground)';
		this.statusLine.textContent = 'Загрузка моделей...';

		// Input row
		const inputRow = append(container, $('div'));
		inputRow.style.display = 'flex';
		inputRow.style.flexDirection = 'column';
		inputRow.style.gap = '4px';
		inputRow.style.borderTop = '1px solid var(--vscode-panel-border)';
		inputRow.style.paddingTop = '8px';

		this.inputElement = append(inputRow, $('textarea')) as HTMLTextAreaElement;
		this.inputElement.placeholder = 'Спроси что-нибудь (Enter — отправить, Shift+Enter — перенос строки)';
		this.inputElement.rows = 3;
		this.inputElement.style.background = 'var(--vscode-input-background)';
		this.inputElement.style.color = 'var(--vscode-input-foreground)';
		this.inputElement.style.border = '1px solid var(--vscode-input-border)';
		this.inputElement.style.borderRadius = '4px';
		this.inputElement.style.padding = '6px';
		this.inputElement.style.resize = 'vertical';
		this.inputElement.style.fontFamily = 'inherit';
		this.inputElement.style.fontSize = 'inherit';

		const buttonRow = append(inputRow, $('div'));
		buttonRow.style.display = 'flex';
		buttonRow.style.gap = '4px';
		buttonRow.style.justifyContent = 'flex-end';

		this.stopButton = append(buttonRow, $('button')) as HTMLButtonElement;
		this.stopButton.textContent = 'Stop';
		this.styleButton(this.stopButton, 'secondary');
		this.stopButton.disabled = true;
		this.stopButton.addEventListener('click', () => this.abortController?.abort());

		const clearButton = append(buttonRow, $('button')) as HTMLButtonElement;
		clearButton.textContent = 'New Chat';
		this.styleButton(clearButton, 'secondary');
		clearButton.addEventListener('click', () => this.resetConversation());

		this.sendButton = append(buttonRow, $('button')) as HTMLButtonElement;
		this.sendButton.textContent = 'Send';
		this.styleButton(this.sendButton, 'primary');
		this.sendButton.addEventListener('click', () => this.sendCurrent());

		this.inputElement.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendCurrent();
			}
		});

		// Стартовая загрузка моделей
		this.onProviderChange().catch(err => {
			this.statusLine.textContent = `Ошибка загрузки моделей: ${err?.message ?? err}`;
		});
	}

	private styleSelect(el: HTMLSelectElement): void {
		el.style.background = 'var(--vscode-dropdown-background)';
		el.style.color = 'var(--vscode-dropdown-foreground)';
		el.style.border = '1px solid var(--vscode-dropdown-border)';
		el.style.borderRadius = '4px';
		el.style.padding = '2px 4px';
		el.style.fontFamily = 'inherit';
		el.style.fontSize = 'inherit';
	}

	private styleButton(btn: HTMLButtonElement, variant: 'primary' | 'secondary'): void {
		btn.style.padding = '4px 12px';
		btn.style.border = 'none';
		btn.style.borderRadius = '4px';
		btn.style.cursor = 'pointer';
		btn.style.fontFamily = 'inherit';
		btn.style.fontSize = 'inherit';
		if (variant === 'primary') {
			btn.style.background = 'var(--vscode-button-background)';
			btn.style.color = 'var(--vscode-button-foreground)';
		} else {
			btn.style.background = 'var(--vscode-button-secondaryBackground)';
			btn.style.color = 'var(--vscode-button-secondaryForeground)';
		}
	}

	private async onProviderChange(): Promise<void> {
		const providerId = this.providerSelect.value as VibecoderProviderId;
		this.modelSelect.innerHTML = '';
		const loadingOpt = append(this.modelSelect, $('option')) as HTMLOptionElement;
		loadingOpt.textContent = 'Загрузка моделей...';
		this.statusLine.textContent = `Опрос ${providerId}...`;

		const provider = this.llmRouter.getProvider(providerId);
		if (!provider) {
			this.statusLine.textContent = `Провайдер ${providerId} недоступен`;
			return;
		}

		let models: VibecoderModelInfo[] = [];
		try {
			models = this.modelsCache.get(providerId) ?? await provider.listModels();
			this.modelsCache.set(providerId, models);
		} catch (e) {
			this.modelSelect.innerHTML = '';
			const errOpt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			errOpt.textContent = '(ошибка загрузки)';
			const message = e instanceof Error ? e.message : String(e);
			this.statusLine.textContent = `${providerId}: ${message}`;
			return;
		}

		this.modelSelect.innerHTML = '';
		if (models.length === 0) {
			const opt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			opt.textContent = '(нет моделей)';
			this.statusLine.textContent = `${providerId}: нет моделей. Для облачных - задай API key.`;
			return;
		}

		for (const m of models) {
			const opt = append(this.modelSelect, $('option')) as HTMLOptionElement;
			opt.value = m.id;
			opt.textContent = m.displayName;
		}

		this.statusLine.textContent = `${providerId}: ${models.length} модел(и/ей). Готов.`;
	}

	private resetConversation(): void {
		this.history.length = 0;
		this.messagesContainer.innerHTML = '';
		this.appendMessage('system', 'Новый чат. История очищена.');
	}

	private appendMessage(role: 'user' | 'assistant' | 'system' | 'error', text: string): HTMLElement {
		const block = append(this.messagesContainer, $('div'));
		block.style.padding = '8px 10px';
		block.style.borderRadius = '6px';
		block.style.whiteSpace = 'pre-wrap';
		block.style.wordBreak = 'break-word';
		block.style.maxWidth = '100%';

		if (role === 'user') {
			block.style.background = 'var(--vscode-list-activeSelectionBackground)';
			block.style.color = 'var(--vscode-list-activeSelectionForeground)';
			block.style.alignSelf = 'flex-end';
		} else if (role === 'assistant') {
			block.style.background = 'var(--vscode-editor-inactiveSelectionBackground)';
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
			this.statusLine.textContent = 'Запрос уже выполняется. Подожди или нажми Stop.';
			return;
		}

		const providerId = this.providerSelect.value as VibecoderProviderId;
		const model = this.modelSelect.value;
		if (!model || model.startsWith('(')) {
			this.appendMessage('error', 'Сначала выбери модель из списка.');
			return;
		}

		// Если это первое сообщение в истории - добавим system prompt
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
		this.statusLine.textContent = `Стриминг ${providerId}/${model}...`;
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
				this.statusLine.textContent = `Готов. Последний ответ: ${accumulated.length} символов.`;
			} else {
				this.statusLine.textContent = 'Готов (пустой ответ).';
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

/**
 * Регистрирует Vibecoder view container в Activity Bar и chat view внутри него.
 */
export function registerVibecoderChatView(): void {
	const viewContainersRegistry = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry);

	const container: ViewContainer = viewContainersRegistry.registerViewContainer({
		id: VIBECODER_VIEW_CONTAINER_ID,
		title: localize2('vibecoder.viewContainer.title', 'Vibecoder'),
		icon: vibecoderViewIcon,
		order: 1,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIBECODER_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
		hideIfEmpty: false,
	}, ViewContainerLocation.Sidebar, { isDefault: false });

	const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
	viewsRegistry.registerViews([{
		id: VIBECODER_CHAT_VIEW_ID,
		name: localize2('vibecoder.chatView.title', 'Chat'),
		ctorDescriptor: new SyncDescriptor(VibecoderChatView),
		canToggleVisibility: true,
		canMoveView: true,
		containerIcon: vibecoderViewIcon,
		order: 1,
	}], container);
}
