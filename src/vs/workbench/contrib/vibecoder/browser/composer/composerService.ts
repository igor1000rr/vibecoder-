/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Composer Vibecoder.
 *
 * Парсер и применятор Aider-style search/replace блоков.
 *
 * Формат вывода LLM (стандарт Aider, поддерживается всеми моделями):
 *
 *   path/to/file.ts
 *   <<<<<<< SEARCH
 *   old content
 *   =======
 *   new content
 *   >>>>>>> REPLACE
 *
 * Композер:
 *  1. Парсит ответ LLM на блоки изменений
 *  2. Каждый блок применяет к файлу (resolve uri → read → replace → write)
 *  3. Открывает diff editor (vscode.diff) для review каждого изменения
 *  4. Юзер делает Accept All / Accept per-file / Reject
 *
 * Line endings:
 *  - parseSearchReplaceBlocks делит на строки через /\r?\n/ и join'ит \n,
 *    то есть search/replace ВСЕГДА с LF
 *  - На Windows файл может быть с CRLF — поиск делается с CRLF fallback
 *    через findUniqueWithCrlfFallback из fsTools
 */

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { findUniqueWithCrlfFallback } from '../agentTools/fsTools.js';

/**
 * Один блок изменений: для одного файла - один search + один replace.
 * Если LLM хочет несколько изменений в одном файле - выдаёт несколько блоков
 * с одинаковым filePath.
 */
export interface ComposerSearchReplaceBlock {
	/** Путь файла относительно корня workspace, или абсолютный URI */
	filePath: string;
	/** Что искать (точный текст, может быть многострочный) */
	search: string;
	/** На что заменить */
	replace: string;
	/** Если search пустой - это создание нового файла */
	isCreation: boolean;
}

/**
 * Парсит текст ответа LLM в массив search/replace блоков.
 *
 * Robust: пропускает преамбулу/постамбулу, неполные блоки игнорирует.
 */
export function parseSearchReplaceBlocks(text: string): ComposerSearchReplaceBlock[] {
	const blocks: ComposerSearchReplaceBlock[] = [];

	const lines = text.split(/\r?\n/);
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		// Ищем маркер начала
		if (line.match(/^<{5,}\s*SEARCH\b/)) {
			// Найдём filePath: последняя непустая строка выше, не содержит ``` и не маркер
			let pathLineIndex = i - 1;
			while (pathLineIndex >= 0) {
				const candidate = lines[pathLineIndex].trim();
				if (!candidate) { pathLineIndex--; continue; }
				if (candidate.startsWith('```')) { pathLineIndex--; continue; }
				if (candidate.match(/^[=<>]{5,}/)) { break; }
				break;
			}

			if (pathLineIndex < 0) { i++; continue; }
			const filePath = lines[pathLineIndex].trim()
				.replace(/^[`*]+|[`*]+$/g, '')
				.replace(/^File:\s*/i, '')
				.replace(/^Path:\s*/i, '');
			if (!filePath || filePath.includes(' ') && !filePath.includes('/')) {
				i++; continue;
			}

			// Собираем search до =======
			const searchLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].match(/^={5,}\s*$/)) {
				searchLines.push(lines[i]);
				i++;
			}
			if (i >= lines.length) { break; }

			// Собираем replace до >>>>>>> REPLACE
			const replaceLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].match(/^>{5,}\s*REPLACE\b/)) {
				replaceLines.push(lines[i]);
				i++;
			}
			if (i >= lines.length) { break; }

			const search = searchLines.join('\n');
			const replace = replaceLines.join('\n');

			blocks.push({
				filePath,
				search,
				replace,
				isCreation: search.trim().length === 0,
			});

			i++;
			continue;
		}
		i++;
	}

	return blocks;
}

export interface ApplyBlockResult {
	block: ComposerSearchReplaceBlock;
	uri: URI;
	originalContent: string;
	newContent: string;
	status: 'ok' | 'search_not_found' | 'multiple_matches' | 'error';
	errorMessage?: string;
}

/**
 * Применяет один блок к workspace - resolves filePath, читает файл, делает замену,
 * возвращает результат (БЕЗ записи на диск). Запись отдельным шагом writeApplyResult,
 * чтобы можно было показать diff и попросить approve.
 *
 * Использует findUniqueWithCrlfFallback для поиска — толерантно к смешению
 * CRLF (Windows-файл) и LF (LLM генерит).
 */
export async function dryRunApplyBlock(
	block: ComposerSearchReplaceBlock,
	workspaceService: IWorkspaceContextService,
	fileService: IFileService,
): Promise<ApplyBlockResult> {
	// Resolve URI
	let uri: URI;
	if (block.filePath.startsWith('/') || block.filePath.match(/^[a-zA-Z]:[\\\/]/) || block.filePath.startsWith('file://')) {
		uri = block.filePath.startsWith('file://') ? URI.parse(block.filePath) : URI.file(block.filePath);
	} else {
		const folders = workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			return {
				block, uri: URI.parse('file:///'),
				originalContent: '', newContent: '',
				status: 'error',
				errorMessage: 'Нет открытого workspace - не могу резолвить относительный путь',
			};
		}
		uri = URI.joinPath(folders[0].uri, block.filePath);
	}

	// Создание нового файла
	if (block.isCreation) {
		try {
			const exists = await fileService.exists(uri);
			if (exists) {
				return {
					block, uri,
					originalContent: '', newContent: block.replace,
					status: 'error',
					errorMessage: 'Search пустой, но файл уже существует. Используй непустой SEARCH чтобы заменить часть.',
				};
			}
			return {
				block, uri,
				originalContent: '', newContent: block.replace,
				status: 'ok',
			};
		} catch (e) {
			return {
				block, uri,
				originalContent: '', newContent: '',
				status: 'error',
				errorMessage: e instanceof Error ? e.message : String(e),
			};
		}
	}

	// Чтение файла
	let original: string;
	try {
		const buf = await fileService.readFile(uri);
		original = buf.value.toString();
	} catch (e) {
		return {
			block, uri,
			originalContent: '', newContent: '',
			status: 'error',
			errorMessage: `Не могу прочитать файл ${uri.fsPath}: ${e instanceof Error ? e.message : String(e)}`,
		};
	}

	// Поиск с CRLF fallback — на Windows файл с CRLF, search от LLM с LF
	const match = findUniqueWithCrlfFallback(original, block.search, block.replace);
	if (!match.found) {
		return {
			block, uri,
			originalContent: original, newContent: original,
			status: 'search_not_found',
			errorMessage: 'Search-текст не найден в файле. Возможно LLM пропустила пробелы или отступы.',
		};
	}
	if (match.count > 1) {
		return {
			block, uri,
			originalContent: original, newContent: original,
			status: 'multiple_matches',
			errorMessage: `Search-текст встречается ${match.count}+ раз - неоднозначно. Добавь больше контекста в search.`,
		};
	}

	const newContent =
		match.workText.slice(0, match.index) +
		match.newTextNormalized +
		match.workText.slice(match.index + match.needleLength);

	return {
		block, uri,
		originalContent: original, newContent,
		status: 'ok',
	};
}

/**
 * Записывает результат на диск. Вызывается после approve в UI.
 */
export async function writeApplyResult(
	result: ApplyBlockResult,
	fileService: IFileService,
): Promise<void> {
	if (result.status !== 'ok') {
		throw new Error(`Не могу записать блок с ошибкой: ${result.errorMessage}`);
	}
	await fileService.writeFile(result.uri, VSBuffer.fromString(result.newContent));
}
