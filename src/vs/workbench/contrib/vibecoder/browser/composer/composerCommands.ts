/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Команды Composer: парсинг ответа LLM, показ diff-ов, применение.
 *
 * Сейчас это MVP - apply через "Apply All from Clipboard". В следующей итерации:
 *  - встроить кнопку Apply прямо в ChatView под ассистент-сообщением
 *  - открывать diff editor для каждого блока ДО применения
 *  - per-block accept/reject
 */

import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize2 } from '../../../../../nls.js';
import { parseSearchReplaceBlocks, dryRunApplyBlock, writeApplyResult, ApplyBlockResult } from './composerService.js';

/**
 * Команда: парсит содержимое буфера обмена как ответ LLM с search/replace блоками,
 * показывает diff-ы и применяет одобренные изменения.
 *
 * Использование:
 *  1. Скопируй ответ LLM (из ChatView или из чата Claude/ChatGPT/любой другой)
 *  2. Ctrl+Shift+P → "Vibecoder: Apply Changes from Clipboard"
 *  3. Подтверди или отклони каждое изменение
 */
class VibecoderApplyFromClipboardAction extends Action2 {
	constructor() {
		super({
			id: 'vibecoder.applyFromClipboard',
			title: localize2('vibecoder.applyFromClipboard.title', 'Vibecoder: Apply Changes from Clipboard'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const quickInput = accessor.get(IQuickInputService);
		const clipboardService = accessor.get(IClipboardService);
		const fileService = accessor.get(IFileService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const editorService = accessor.get(IEditorService);

		const text = await clipboardService.readText();
		if (!text || text.trim().length === 0) {
			notificationService.warn('Буфер обмена пуст.');
			return;
		}

		const blocks = parseSearchReplaceBlocks(text);
		if (blocks.length === 0) {
			notificationService.warn('В буфере обмена не найдено search/replace блоков. Формат: filename + <<<<<<< SEARCH / ======= / >>>>>>> REPLACE');
			return;
		}

		// Dry-run на все блоки
		const results: ApplyBlockResult[] = [];
		for (const block of blocks) {
			const result = await dryRunApplyBlock(block, workspaceService, fileService);
			results.push(result);
		}

		const okResults = results.filter(r => r.status === 'ok');
		const errorResults = results.filter(r => r.status !== 'ok');

		if (errorResults.length > 0) {
			const errorSummary = errorResults
				.map(r => `  • ${r.block.filePath}: ${r.errorMessage}`)
				.join('\n');
			notificationService.notify({
				severity: Severity.Warning,
				message: `Найдено блоков: ${blocks.length}. Применимых: ${okResults.length}. С ошибками: ${errorResults.length}\n${errorSummary}`,
			});
		}

		if (okResults.length === 0) {
			return;
		}

		// Подтверждение
		const confirm = await quickInput.pick(
			[
				{ label: `Apply All (${okResults.length})`, description: 'Применить все валидные изменения' },
				{ label: 'Preview Files', description: 'Открыть файлы для просмотра diff-ов перед применением' },
				{ label: 'Cancel', description: 'Отменить' },
			],
			{ placeHolder: `Применить ${okResults.length} изменений?` }
		);

		if (!confirm || confirm.label === 'Cancel') { return; }

		if (confirm.label === 'Preview Files') {
			// Открыть все затронутые файлы в редакторе для review
			const uniqueUris = new Set<string>();
			for (const r of okResults) {
				uniqueUris.add(r.uri.toString());
			}
			for (const uriStr of uniqueUris) {
				await editorService.openEditor({ resource: URI.parse(uriStr) });
			}
			notificationService.info(`Открыто файлов: ${uniqueUris.size}. Запусти Apply Changes from Clipboard ещё раз, когда готов применять.`);
			return;
		}

		// Apply all
		let applied = 0;
		const failed: string[] = [];
		for (const result of okResults) {
			try {
				await writeApplyResult(result, fileService);
				applied++;
			} catch (e) {
				failed.push(`${result.block.filePath}: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		if (failed.length === 0) {
			notificationService.info(`Применено изменений: ${applied} ✅`);
		} else {
			notificationService.error(`Применено: ${applied}. Ошибки записи (${failed.length}):\n${failed.join('\n')}`);
		}
	}
}

export function registerVibecoderComposerCommands(): void {
	registerAction2(VibecoderApplyFromClipboardAction);
}
