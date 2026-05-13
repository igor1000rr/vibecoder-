/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Apply Panel — UI-блок под сообщением ассистента в чате NIT.
 *
 * Когда модель выдала ответ с search/replace блоками (см. composerService),
 * мы рендерим под сообщением панель с per-file Apply-кнопками и
 * collapsible diff preview.
 *
 * Вынесено в отдельный модуль чтобы NitChatView не разрастался,
 * и чтобы тот же UI можно было использовать в других местах (composer view,
 * preview command, etc).
 */

import { $, append } from '../../../../../base/browser/dom.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ComposerSearchReplaceBlock, dryRunApplyBlock, writeApplyResult } from '../composer/composerService.js';

export interface ApplyPanelDependencies {
	readonly fileService: IFileService;
	readonly workspaceService: IWorkspaceContextService;
	readonly editorService: IEditorService;
}

/**
 * Рендерит панель Apply-кнопок под parent-сообщением.
 *
 *  - Заголовок: "▸ N edit(s) ready"
 *  - На каждый блок:
 *      ┌────────────────────────────────────────────────────┐
 *      │ path/to/file.ts        ▼ diff   ▶ Apply           │
 *      │ (скрытый по умолчанию) <pre>search</pre>           │
 *      │                        <pre>replace</pre>          │
 *      └────────────────────────────────────────────────────┘
 *  - Если блоков > 1: общая кнопка "▶ Apply All (N)"
 */
export function renderApplyPanel(
	parent: HTMLElement,
	blocks: readonly ComposerSearchReplaceBlock[],
	deps: ApplyPanelDependencies,
): void {
	const panel = append(parent, $('div'));
	panel.style.marginTop = '12px';
	panel.style.paddingTop = '10px';
	panel.style.borderTop = '1px solid rgba(255, 60, 200, 0.25)';
	panel.style.display = 'flex';
	panel.style.flexDirection = 'column';
	panel.style.gap = '6px';

	const headerEl = append(panel, $('div'));
	headerEl.style.fontSize = '10px';
	headerEl.style.color = 'var(--vscode-descriptionForeground)';
	headerEl.style.fontFamily = 'monospace';
	headerEl.style.letterSpacing = '0.5px';
	headerEl.style.marginBottom = '4px';
	headerEl.textContent = `▸ ${blocks.length} edit(s) ready · click ▼ to preview, ▶ to apply`;

	const rowAccessors: Array<() => Promise<boolean>> = [];

	for (const block of blocks) {
		const blockBox = append(panel, $('div'));
		blockBox.style.background = 'rgba(0, 240, 255, 0.04)';
		blockBox.style.border = '1px solid rgba(0, 240, 255, 0.15)';
		blockBox.style.borderRadius = '4px';
		blockBox.style.display = 'flex';
		blockBox.style.flexDirection = 'column';
		blockBox.style.overflow = 'hidden';

		// Верхняя строка: имя файла + diff toggle + apply
		const topRow = append(blockBox, $('div'));
		topRow.style.display = 'flex';
		topRow.style.gap = '6px';
		topRow.style.alignItems = 'center';
		topRow.style.padding = '4px 8px';

		const fileEl = append(topRow, $('div'));
		fileEl.style.flex = '1';
		fileEl.style.fontFamily = 'monospace';
		fileEl.style.fontSize = '11px';
		fileEl.style.color = '#00f0ff';
		fileEl.style.overflow = 'hidden';
		fileEl.style.textOverflow = 'ellipsis';
		fileEl.style.whiteSpace = 'nowrap';
		fileEl.title = block.filePath;
		fileEl.textContent = block.isCreation ? `+ new: ${block.filePath}` : block.filePath;

		const diffBtn = append(topRow, $('button')) as HTMLButtonElement;
		diffBtn.textContent = '▼ diff';
		styleSmallGhost(diffBtn);

		const applyBtn = append(topRow, $('button')) as HTMLButtonElement;
		applyBtn.textContent = '▶ Apply';
		styleApplyBtn(applyBtn);

		// Нижняя часть: скрытый по умолчанию preview
		const previewBox = append(blockBox, $('div'));
		previewBox.style.display = 'none';
		previewBox.style.padding = '6px 8px 8px 8px';
		previewBox.style.borderTop = '1px dashed rgba(0, 240, 255, 0.2)';
		previewBox.style.gap = '4px';
		previewBox.style.flexDirection = 'column';

		renderDiffPreview(previewBox, block);

		diffBtn.addEventListener('click', () => {
			const open = previewBox.style.display !== 'none';
			previewBox.style.display = open ? 'none' : 'flex';
			diffBtn.textContent = open ? '▼ diff' : '▲ diff';
		});

		const accessor = async () => applyOneBlock(block, applyBtn, deps);
		rowAccessors.push(accessor);
		applyBtn.addEventListener('click', () => { accessor(); });
	}

	if (blocks.length > 1) {
		const allBtn = append(panel, $('button')) as HTMLButtonElement;
		allBtn.textContent = `▶ Apply All (${blocks.length})`;
		styleApplyBtn(allBtn);
		allBtn.style.marginTop = '4px';
		allBtn.style.padding = '5px 14px';
		allBtn.style.fontSize = '12px';

		allBtn.addEventListener('click', async () => {
			allBtn.disabled = true;
			allBtn.textContent = '...';
			let okCount = 0;
			let failCount = 0;
			for (const accessor of rowAccessors) {
				const ok = await accessor();
				if (ok) { okCount++; } else { failCount++; }
			}
			if (failCount === 0) {
				allBtn.textContent = `✓ Applied ${okCount}/${blocks.length}`;
				styleSuccessBtn(allBtn);
			} else {
				allBtn.textContent = `${okCount} ok, ${failCount} failed`;
				styleDangerBtn(allBtn);
			}
		});
	}
}

/**
 * Рендерит preview одного блока: красная зона "до" + зелёная зона "после".
 * Для создания файла — только зелёная (search пустой).
 * Для удаления — только красная (replace пустой).
 */
function renderDiffPreview(container: HTMLElement, block: ComposerSearchReplaceBlock): void {
	const MAX_PREVIEW_LINES = 30;
	const MAX_PREVIEW_CHARS = 2000;

	if (block.search.trim().length > 0) {
		const label = append(container, $('div'));
		label.style.fontSize = '9px';
		label.style.fontFamily = 'monospace';
		label.style.color = '#ff6b6b';
		label.style.opacity = '0.8';
		label.style.marginTop = '2px';
		label.textContent = '─── ─ search (будет удалено) ─ ───';

		const pre = append(container, $('pre'));
		styleCodePre(pre, 'remove');
		pre.textContent = truncatePreview(block.search, MAX_PREVIEW_LINES, MAX_PREVIEW_CHARS);
	}

	if (block.replace.trim().length > 0) {
		const label = append(container, $('div'));
		label.style.fontSize = '9px';
		label.style.fontFamily = 'monospace';
		label.style.color = '#7aff5c';
		label.style.opacity = '0.8';
		label.style.marginTop = '2px';
		label.textContent = '─── + replace (будет вставлено) ─ ───';

		const pre = append(container, $('pre'));
		styleCodePre(pre, 'add');
		pre.textContent = truncatePreview(block.replace, MAX_PREVIEW_LINES, MAX_PREVIEW_CHARS);
	}

	if (block.search.trim().length === 0 && block.replace.trim().length === 0) {
		const note = append(container, $('div'));
		note.style.fontSize = '10px';
		note.style.color = 'var(--vscode-descriptionForeground)';
		note.style.fontStyle = 'italic';
		note.textContent = '(empty block)';
	}
}

function truncatePreview(text: string, maxLines: number, maxChars: number): string {
	const lines = text.split('\n');
	let result = lines.slice(0, maxLines).join('\n');
	if (lines.length > maxLines) {
		result += `\n... (+${lines.length - maxLines} ещё строк)`;
	}
	if (result.length > maxChars) {
		result = result.slice(0, maxChars) + `\n... (обрезано, всего ${text.length} символов)`;
	}
	return result;
}

/**
 * Применяет один блок и обновляет состояние кнопки.
 */
async function applyOneBlock(
	block: ComposerSearchReplaceBlock,
	btn: HTMLButtonElement,
	deps: ApplyPanelDependencies,
): Promise<boolean> {
	if (btn.disabled) { return false; }
	btn.disabled = true;
	btn.textContent = '...';

	try {
		const result = await dryRunApplyBlock(block, deps.workspaceService, deps.fileService);
		if (result.status !== 'ok') {
			btn.textContent = `✗ ${result.status}`;
			btn.title = result.errorMessage ?? '';
			styleDangerBtn(btn);
			return false;
		}

		await writeApplyResult(result, deps.fileService);
		btn.textContent = '✓ Applied';
		styleSuccessBtn(btn);

		// Открыть изменённый файл в редакторе для review
		deps.editorService.openEditor({ resource: result.uri }).catch(() => { });
		return true;
	} catch (e) {
		btn.textContent = '✗ error';
		btn.title = e instanceof Error ? e.message : String(e);
		styleDangerBtn(btn);
		console.error('[Vibecoder] applyOneBlock failed:', e);
		return false;
	}
}

// ── Стили кнопок и preview-кода ─────────────────────────────────────────────

function styleApplyBtn(btn: HTMLButtonElement): void {
	btn.style.padding = '3px 10px';
	btn.style.border = 'none';
	btn.style.borderRadius = '4px';
	btn.style.cursor = 'pointer';
	btn.style.fontFamily = 'inherit';
	btn.style.fontSize = '11px';
	btn.style.fontWeight = '600';
	btn.style.letterSpacing = '0.3px';
	btn.style.transition = 'all 0.15s';
	btn.style.minWidth = '80px';
	btn.style.background = 'linear-gradient(135deg, #ff3cc8 0%, #ff5db5 100%)';
	btn.style.color = '#fff';
	btn.style.boxShadow = '0 2px 8px rgba(255, 60, 200, 0.25)';
}

function styleSmallGhost(btn: HTMLButtonElement): void {
	btn.style.padding = '3px 8px';
	btn.style.border = '1px solid rgba(0, 240, 255, 0.3)';
	btn.style.borderRadius = '4px';
	btn.style.cursor = 'pointer';
	btn.style.fontFamily = 'monospace';
	btn.style.fontSize = '10px';
	btn.style.background = 'transparent';
	btn.style.color = '#00f0ff';
	btn.style.transition = 'all 0.15s';
}

function styleSuccessBtn(btn: HTMLButtonElement): void {
	btn.style.background = '#7aff5c';
	btn.style.color = '#0a0614';
	btn.style.border = 'none';
}

function styleDangerBtn(btn: HTMLButtonElement): void {
	btn.style.background = 'var(--vscode-inputValidation-errorBackground)';
	btn.style.color = 'var(--vscode-inputValidation-errorForeground)';
	btn.style.border = '1px solid var(--vscode-inputValidation-errorBorder)';
}

function styleCodePre(pre: HTMLElement, kind: 'add' | 'remove'): void {
	pre.style.margin = '0';
	pre.style.padding = '6px 8px';
	pre.style.fontSize = '10.5px';
	pre.style.fontFamily = "'JetBrains Mono', 'Cascadia Code', monospace";
	pre.style.lineHeight = '1.4';
	pre.style.whiteSpace = 'pre';
	pre.style.overflow = 'auto';
	pre.style.maxHeight = '300px';
	pre.style.borderRadius = '3px';
	if (kind === 'add') {
		pre.style.background = 'rgba(122, 255, 92, 0.08)';
		pre.style.color = '#a8ffb5';
		pre.style.borderLeft = '3px solid #7aff5c';
	} else {
		pre.style.background = 'rgba(255, 107, 107, 0.08)';
		pre.style.color = '#ffb5b5';
		pre.style.borderLeft = '3px solid #ff6b6b';
	}
}
