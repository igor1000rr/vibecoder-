/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
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
import { VibecoderChatMessage } from '../llm/llmProvider.js';

export const VIBECODER_VIEW_CONTAINER_ID = 'workbench.view.vibecoder';
export const VIBECODER_CHAT_VIEW_ID = 'vibecoder.chatView';

const vibecoderViewIcon = registerIcon(
	'vibecoder-view-icon',
	Codicon.sparkle,
	localize('vibecoderViewIcon', 'View icon of the Vibecoder chat view.')
);

/**
 * Минимальный сайдбар с чатом.
 * Цель этой итерации - доказать что пайплайн "ввод → LLM router → стриминг ответа → DOM"
 * работает end-to-end. React/Tailwind UI добавим в следующей итерации,
 * когда восстановим buildreact pipeline.
 */
export class VibecoderChatView extends ViewPane {

	static readonly ID = VIBECODER_CHAT_VIEW_ID;

	private messagesContainer!: HTMLElement;
	private inputElement!: HTMLTextAreaElement;
	private sendButton!: HTMLButtonElement;
	private statusLine!: HTMLElement;

	private readonly history: VibecoderChatMessage[] = [];
	private abortController: AbortController | undefined;

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

		// Header
		const header = append(container, $('div'));
		header.style.padding = '4px 4px 8px 4px';
		header.style.borderBottom = '1px solid var(--vscode-panel-border)';
		header.style.marginBottom = '8px';
		header.style.fontWeight = '600';
		header.textContent = 'Vibecoder Chat (alpha)';

		// Messages
		this.messagesContainer = append(container, $('div'));
		this.messagesContainer.style.flex = '1';
		this.messagesContainer.style.overflowY = 'auto';
		this.messagesContainer.style.padding = '4px';
		this.messagesContainer.style.gap = '8px';
		this.messagesContainer.style.display = 'flex';
		this.messagesContainer.style.flexDirection = 'column';

		this.appendMessage('system', 'Это alpha-версия чата. Сейчас работает только с LM Studio (localhost:1234). Запусти LM Studio + загрузи модель, потом напиши сообщение.');

		// Status
		this.statusLine = append(container, $('div'));
		this.statusLine.style.padding = '4px 0';
		this.statusLine.style.fontSize = '11px';
		this.statusLine.style.color = 'var(--vscode-descriptionForeground)';
		this.statusLine.textContent = 'Готов. Провайдер: LM Studio (default)';

		// Input row
		const inputRow = append(container, $('div'));
		inputRow.style.display = 'flex';
		inputRow.style.gap = '4px';
		inputRow.style.borderTop = '1px solid var(--vscode-panel-border)';
		inputRow.style.paddingTop = '8px';

		this.inputElement = append(inputRow, $('textarea')) as HTMLTextAreaElement;
		this.inputElement.placeholder = 'Спроси что-нибудь (Enter — отправить, Shift+Enter — перенос строки)';
		this.inputElement.rows = 3;
		this.inputElement.style.flex = '1';
		this.inputElement.style.background = 'var(--vscode-input-background)';
		this.inputElement.style.color = 'var(--vscode-input-foreground)';
		this.inputElement.style.border = '1px solid var(--vscode-input-border)';
		this.inputElement.style.borderRadius = '4px';
		this.inputElement.style.padding = '6px';
		this.inputElement.style.resize = 'vertical';
		this.inputElement.style.fontFamily = 'inherit';
		this.inputElement.style.fontSize = 'inherit';

		this.sendButton = append(inputRow, $('button')) as HTMLButtonElement;
		this.sendButton.textContent = 'Send';
		this.sendButton.style.alignSelf = 'flex-end';
		this.sendButton.style.padding = '6px 12px';
		this.sendButton.style.background = 'var(--vscode-button-background)';
		this.sendButton.style.color = 'var(--vscode-button-foreground)';
		this.sendButton.style.border = 'none';
		this.sendButton.style.borderRadius = '4px';
		this.sendButton.style.cursor = 'pointer';

		this._register({
			dispose: () => {
				this.inputElement.removeEventListener('keydown', onKeyDown);
				this.sendButton.removeEventListener('click', onSendClick);
			}
		});

		const onSendClick = () => this.sendCurrent();
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendCurrent();
			}
		};
		this.sendButton.addEventListener('click', onSendClick);
		this.inputElement.addEventListener('keydown', onKeyDown);
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
			this.statusLine.textContent = 'Запрос уже выполняется. Подожди завершения.';
			return;
		}

		this.appendMessage('user', text);
		this.history.push({ role: 'user', content: text });
		this.inputElement.value = '';

		const assistantBlock = this.appendMessage('assistant', '');
		this.statusLine.textContent = 'Запрос к LM Studio...';
		this.sendButton.disabled = true;
		this.abortController = new AbortController();

		// Получим первую загруженную модель LM Studio
		const lmstudio = this.llmRouter.getProvider('lmstudio');
		if (!lmstudio) {
			assistantBlock.remove();
			this.appendMessage('error', 'LM Studio провайдер не зарегистрирован.');
			this.statusLine.textContent = 'Ошибка.';
			this.sendButton.disabled = false;
			this.abortController = undefined;
			return;
		}

		let model: string;
		try {
			const models = await lmstudio.listModels();
			if (models.length === 0) {
				assistantBlock.remove();
				this.appendMessage('error', 'LM Studio: ни одной модели не загружено. Загрузи модель в LM Studio.');
				this.statusLine.textContent = 'Готов.';
				this.sendButton.disabled = false;
				this.abortController = undefined;
				return;
			}
			model = models[0].id;
		} catch (e) {
			assistantBlock.remove();
			const message = e instanceof Error ? e.message : String(e);
			this.appendMessage('error', `LM Studio недоступна: ${message}\nЗапусти LM Studio → Developer → Start Server.`);
			this.statusLine.textContent = 'Ошибка.';
			this.sendButton.disabled = false;
			this.abortController = undefined;
			return;
		}

		this.statusLine.textContent = `Стриминг от ${model}...`;

		let accumulated = '';
		try {
			const stream = this.llmRouter.chat({
				messages: this.history,
				model,
				providerHint: 'lmstudio',
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
				} else if (chunk.type === 'finish') {
					// final
				}
			}

			if (accumulated) {
				this.history.push({ role: 'assistant', content: accumulated });
			}
			this.statusLine.textContent = `Готов. Последний ответ: ${accumulated.length} символов.`;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (!accumulated) { assistantBlock.remove(); }
			this.appendMessage('error', `Ошибка: ${message}`);
			this.statusLine.textContent = 'Ошибка.';
		} finally {
			this.sendButton.disabled = false;
			this.abortController = undefined;
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		// текущая layout-логика делается через flex; ничего дополнительного не требуется
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
		order: 1, // высокий приоритет — рядом с Explorer
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

const _options: IViewPaneOptions = { id: '', title: localize2('_', '') };
void _options;
