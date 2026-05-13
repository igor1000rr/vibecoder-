/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Брендирование UI Vibecoder.
 *
 * Минимальные дополнения поверх стандартного workbench VS Code:
 *  - Лого "V" сверху Activity Bar (нейтральный цвет, без gradient)
 *  - Status bar items: "NIT" (открывает NIT справа), "vibecoder" (открывает Welcome)
 *
 * Цвета — стандартные VS Code через --vscode-* переменные. Без неона,
 * без gradient'ов, без специальных overrides title bar / scrollbar /
 * notifications / command palette.
 */

import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { localize } from '../../../../../nls.js';
import { VibecoderCommands } from '../../common/vibecoder.js';

/**
 * Минимальный CSS — только лого "V" сверху Activity Bar.
 * Цвет — стандартный foreground, без gradient/неона.
 */
const VIBECODER_BRAND_CSS = `
.monaco-workbench .activitybar > .content::before {
	content: 'V';
	display: flex;
	align-items: center;
	justify-content: center;
	height: 36px;
	width: 100%;
	font-family: var(--vscode-font-family);
	font-weight: 700;
	font-size: 18px;
	color: var(--vscode-activityBar-foreground);
	opacity: 0.85;
	border-bottom: 1px solid var(--vscode-panel-border);
	margin-bottom: 4px;
	cursor: default;
	user-select: none;
}
`;

/**
 * Контрибьюшн: инжектит минимальный CSS (V-лого) и регистрирует status bar items
 * без цветовых акцентов.
 */
export class VibecoderBrandingContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();
		this.injectBrandCss();
		this.registerStatusBarItems();
	}

	private injectBrandCss(): void {
		// Идемпотентность — не плодим <style> при перезагрузке
		const existing = document.getElementById('vibecoder-brand-styles');
		if (existing) { existing.remove(); }

		const styleEl = document.createElement('style');
		styleEl.id = 'vibecoder-brand-styles';
		styleEl.textContent = VIBECODER_BRAND_CSS;
		document.head.appendChild(styleEl);
	}

	private registerStatusBarItems(): void {
		// Левый: NIT — клик открывает NIT-сайдбар (AuxiliaryBar справа)
		this._register(this.statusbarService.addEntry(
			{
				name: localize('vibecoder.statusbar.nit.name', 'NIT'),
				text: '$(sparkle) NIT',
				ariaLabel: 'Open NIT AI assistant',
				tooltip: localize('vibecoder.statusbar.nit.tooltip', 'Открыть NIT — AI-ассистент Vibecoder (справа)'),
				command: VibecoderCommands.OpenNit,
			},
			'vibecoder.statusbar.nit',
			StatusbarAlignment.LEFT,
			{ location: { id: 'status.problems', priority: 100 }, alignment: StatusbarAlignment.LEFT, compact: false }
		));

		// Правый: бренд-надпись — клик открывает Welcome
		this._register(this.statusbarService.addEntry(
			{
				name: localize('vibecoder.statusbar.brand.name', 'Vibecoder'),
				text: 'vibecoder',
				ariaLabel: 'Vibecoder',
				tooltip: localize('vibecoder.statusbar.brand.tooltip', 'Vibecoder IDE · Apache 2.0\nКлик — открыть Welcome'),
				command: VibecoderCommands.OpenWelcome,
			},
			'vibecoder.statusbar.brand',
			StatusbarAlignment.RIGHT,
			999
		));
	}
}
