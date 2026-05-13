/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Брендирование UI Vibecoder.
 *
 * Добавляет кастомные элементы поверх стандартного workbench VS Code:
 *  - Лого "V" в верхней части Activity Bar (слева, ::before на .content)
 *  - Status bar items: "⚡ NIT" слева (открывает NIT справа),
 *    "vibecoder · vibecoding.by" справа (открывает Welcome)
 *  - Кастомный CSS для title bar, активной вкладки, scrollbar и т.д.
 *
 * Запускается на LifecyclePhase.Restored — workbench уже отрисован.
 *
 * Файл лежит в `src/vs/workbench/contrib/vibecoder/browser/branding/`,
 * на один уровень глубже чем `browser/`. Поэтому импорты к OSS-файлам
 * требуют ОДНОГО лишнего `../` по сравнению с импортами из browser/.
 */

import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { localize } from '../../../../../nls.js';
import { VibecoderCommands } from '../../common/vibecoder.js';

const VIBECODER_BRAND_CSS = `
/* ── Activity Bar: добавляем брендированный лого сверху ────────────────── */
.monaco-workbench .activitybar > .content::before {
	content: 'V';
	display: flex;
	align-items: center;
	justify-content: center;
	height: 44px;
	width: 100%;
	font-family: 'Orbitron', 'Rajdhani', 'Segoe UI', sans-serif;
	font-weight: 800;
	font-size: 22px;
	letter-spacing: 1px;
	background: linear-gradient(135deg, #ff3cc8 0%, #00f0ff 100%);
	-webkit-background-clip: text;
	background-clip: text;
	-webkit-text-fill-color: transparent;
	text-shadow: 0 0 14px rgba(255, 60, 200, 0.55);
	border-bottom: 1px solid rgba(255, 60, 200, 0.22);
	margin-bottom: 6px;
	cursor: default;
	user-select: none;
}

/* ── Title Bar: лёгкое свечение по нижней границе ──────────────────────── */
.monaco-workbench .part.titlebar {
	box-shadow: 0 1px 0 rgba(255, 60, 200, 0.45), 0 4px 14px -6px rgba(255, 60, 200, 0.35);
}

/* ── Заголовок окна: моноширный с трекингом ────────────────────────────── */
.monaco-workbench .part.titlebar .window-title {
	font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
	font-size: 12px;
	letter-spacing: 0.6px;
	opacity: 0.95;
}

/* ── Active tab: неоновая полоска и magenta-текст ──────────────────────── */
.monaco-workbench .part.editor > .content .editor-group-container .tabs-container .tab.active {
	box-shadow: inset 0 2px 0 0 #ff3cc8, 0 -1px 6px -2px rgba(255, 60, 200, 0.45);
}

/* ── Status bar items: брендовый шрифт ─────────────────────────────────── */
.monaco-workbench .part.statusbar .statusbar-item {
	font-family: 'JetBrains Mono', monospace;
	letter-spacing: 0.4px;
	font-size: 11.5px;
}

/* ── Status bar Vibecoder-айтем: магента-акцент ────────────────────────── */
.monaco-workbench .part.statusbar .statusbar-item[id*='vibecoder.statusbar.brand'] {
	color: #ff3cc8 !important;
	font-weight: 600;
	text-shadow: 0 0 6px rgba(255, 60, 200, 0.45);
}

/* ── Status bar NIT-айтем: cyan-акцент ─────────────────────────────────── */
.monaco-workbench .part.statusbar .statusbar-item[id*='vibecoder.statusbar.nit'] {
	color: #00f0ff !important;
	font-weight: 600;
	text-shadow: 0 0 6px rgba(0, 240, 255, 0.45);
}

/* ── Notifications: brand-аксент ───────────────────────────────────────── */
.monaco-workbench .notifications-toasts .notification-toast {
	border-left: 3px solid #ff3cc8;
	box-shadow: 0 6px 20px -6px rgba(255, 60, 200, 0.4);
}

/* ── Command Palette: больше "своих" вибраций ──────────────────────────── */
.quick-input-widget {
	box-shadow: 0 8px 24px -8px rgba(255, 60, 200, 0.45), 0 0 0 1px rgba(255, 60, 200, 0.25) !important;
}

/* ── Scrollbar: тонкий magenta ─────────────────────────────────────────── */
.monaco-scrollable-element > .scrollbar > .slider {
	background: rgba(255, 60, 200, 0.35) !important;
}
.monaco-scrollable-element > .scrollbar > .slider:hover {
	background: rgba(255, 60, 200, 0.6) !important;
}
`;

/**
 * Контрибьюшн который инжектит брендовый CSS и регистрирует status bar items.
 *
 * Status bar items живут пока живёт сам контрибьюшн — управление disposable
 * идёт через _register(), нет нужды хранить ссылки на entry accessors.
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
		// Левый: ⚡ NIT — клик открывает NIT-сайдбар (AuxiliaryBar справа)
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
				text: 'vibecoder · vibecoding.by',
				ariaLabel: 'Vibecoder by vibecoding.by',
				tooltip: localize('vibecoder.statusbar.brand.tooltip', 'Vibecoder IDE · построен на VS Code OSS · Apache 2.0\nКлик — открыть Welcome'),
				command: VibecoderCommands.OpenWelcome,
			},
			'vibecoder.statusbar.brand',
			StatusbarAlignment.RIGHT,
			999
		));
	}
}
