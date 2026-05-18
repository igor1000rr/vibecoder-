/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Файловые tools для Vibecoder Agent.
 *
 * 7 tools через IFileService (тот же что workspace uses — поэтому работает
 * cross-platform и с remote/SSH transparent).
 *
 * Tools:
 *   - read_file       — чтение, опционально с обрезкой по max_chars
 *   - write_file      — создание/перезапись (dangerous)
 *   - edit_file       — search/replace, требует уникальности old_text (dangerous)
 *   - delete_file     — удаление файла или папки (dangerous)
 *   - list_dir        — листинг с типами и размерами
 *   - search_files    — поиск по подстроке в путях и содержимом
 *   - mkdir           — создание директорий рекурсивно (medium)
 *
 * Пути:
 *   - абсолютные (начинаются с / или X:\) → URI.file(path) напрямую
 *   - относительные → разрешаются относительно первой workspace folder
 *   - всегда нормализуются через URI.file() — кросс-платформенно
 *
 * Все методы возвращают { content: string; isError: boolean } для совместимости
 * с тем как toolLoop ожидает MCP результаты.
 */

import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IFileService, FileType } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { isAbsolute as isAbsolutePosix } from '../../../../../base/common/path.js';
import { VibecoderTool } from '../llm/llmProvider.js';

/** Лимит для read_file/search по умолчанию (защита от случайного загруза 100MB) */
const DEFAULT_READ_MAX_CHARS = 50_000;
const HARD_READ_MAX_CHARS = 500_000;

/** Лимит для list_dir */
const DEFAULT_LIST_MAX_ENTRIES = 200;
const HARD_LIST_MAX_ENTRIES = 5000;

/** Лимит для search_files */
const DEFAULT_SEARCH_MAX_RESULTS = 50;
const HARD_SEARCH_MAX_RESULTS = 500;

/** Search не заходит в эти директории — нет смысла, шумят */
const SEARCH_SKIP_DIRS = new Set([
	'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
	'.next', '.nuxt', 'target', '__pycache__', '.venv', 'venv',
	'.idea', '.vscode-test', 'coverage', '.cache',
]);

/** Search пропускает файлы больше этого размера (бинарники, дампы) */
const SEARCH_FILE_MAX_BYTES = 1_000_000;

export interface AgentToolResult {
	readonly content: string;
	readonly isError: boolean;
}

export class FsTools {
	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceService: IWorkspaceContextService,
	) { }

	/**
	 * Превращает строку пути в URI. Поддерживает:
	 *   - абсолютный путь Unix: /home/user/file.ts
	 *   - абсолютный путь Windows: C:\Users\user\file.ts или C:/Users/user/file.ts
	 *   - относительный путь — разрешается от первой workspace folder
	 *
	 * Если path относительный и workspace folder нет — возвращает undefined.
	 */
	private resolvePath(path: string): URI | undefined {
		const trimmed = path.trim();
		if (!trimmed) { return undefined; }

		// Абсолютный?
		const isWindowsAbs = /^[a-zA-Z]:[\\/]/.test(trimmed);
		const isUnixAbs = trimmed.startsWith('/');

		if (isWindowsAbs || isUnixAbs || isAbsolutePosix(trimmed)) {
			return URI.file(trimmed);
		}

		// Относительный — разрешаем от первой workspace folder
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}
		return URI.joinPath(folders[0].uri, trimmed);
	}

	private error(msg: string): AgentToolResult {
		return { content: msg, isError: true };
	}

	private success(content: string): AgentToolResult {
		return { content, isError: false };
	}

	// ── read_file ──────────────────────────────────────────

	async readFile(args: { path?: string; max_chars?: number }): Promise<AgentToolResult> {
		if (typeof args.path !== 'string' || !args.path.trim()) {
			return this.error('read_file: параметр "path" обязателен');
		}
		const uri = this.resolvePath(args.path);
		if (!uri) {
			return this.error(`read_file: путь "${args.path}" относительный, но workspace не открыт. Открой папку или передай абсолютный путь.`);
		}

		const maxChars = Math.min(
			Math.max(1, args.max_chars ?? DEFAULT_READ_MAX_CHARS),
			HARD_READ_MAX_CHARS
		);

		try {
			const exists = await this.fileService.exists(uri);
			if (!exists) {
				return this.error(`read_file: файл не найден: ${uri.fsPath}`);
			}

			const stat = await this.fileService.stat(uri);
			if (stat.isDirectory) {
				return this.error(`read_file: ${uri.fsPath} — это директория, используй list_dir`);
			}

			const content = await this.fileService.readFile(uri);
			const text = content.value.toString();

			if (text.length > maxChars) {
				const truncated = text.slice(0, maxChars);
				return this.success(
					`${truncated}\n\n[... обрезано: показано ${maxChars} из ${text.length} симв. Передай max_chars больше или используй edit_file для точечной правки.]`
				);
			}
			return this.success(text);
		} catch (e) {
			return this.error(`read_file: ${(e as Error).message}`);
		}
	}

	// ── write_file ─────────────────────────────────────────

	async writeFile(args: { path?: string; content?: string }): Promise<AgentToolResult> {
		if (typeof args.path !== 'string' || !args.path.trim()) {
			return this.error('write_file: параметр "path" обязателен');
		}
		if (typeof args.content !== 'string') {
			return this.error('write_file: параметр "content" обязателен (строка, может быть пустой)');
		}
		const uri = this.resolvePath(args.path);
		if (!uri) {
			return this.error(`write_file: путь "${args.path}" относительный, но workspace не открыт.`);
		}

		try {
			// Создаём родительскую директорию если её нет
			const parentUri = URI.joinPath(uri, '..');
			if (!(await this.fileService.exists(parentUri))) {
				await this.fileService.createFolder(parentUri);
			}

			await this.fileService.writeFile(uri, VSBuffer.fromString(args.content));
			const lines = args.content.split('\n').length;
			return this.success(`✅ Записан файл ${uri.fsPath} · ${args.content.length} симв. · ${lines} строк`);
		} catch (e) {
			return this.error(`write_file: ${(e as Error).message}`);
		}
	}

	// ── edit_file (search/replace) ─────────────────────────

	async editFile(args: { path?: string; old_text?: string; new_text?: string }): Promise<AgentToolResult> {
		if (typeof args.path !== 'string' || !args.path.trim()) {
			return this.error('edit_file: параметр "path" обязателен');
		}
		if (typeof args.old_text !== 'string' || !args.old_text) {
			return this.error('edit_file: параметр "old_text" обязателен и не должен быть пустым. Для создания файла используй write_file.');
		}
		if (typeof args.new_text !== 'string') {
			return this.error('edit_file: параметр "new_text" обязателен (может быть пустой строкой для удаления фрагмента)');
		}
		const uri = this.resolvePath(args.path);
		if (!uri) {
			return this.error(`edit_file: путь "${args.path}" относительный, но workspace не открыт.`);
		}

		try {
			if (!(await this.fileService.exists(uri))) {
				return this.error(`edit_file: файл не найден: ${uri.fsPath}. Для создания используй write_file.`);
			}

			const content = await this.fileService.readFile(uri);
			const text = content.value.toString();

			// Подсчитываем кол-во совпадений
			let count = 0;
			let idx = text.indexOf(args.old_text);
			const firstIdx = idx;
			while (idx !== -1) {
				count++;
				if (count > 1) { break; }
				idx = text.indexOf(args.old_text, idx + 1);
			}

			if (count === 0) {
				// Полезная диагностика: ищем какой кусок совпадает частично
				const firstLine = args.old_text.split('\n')[0].slice(0, 80);
				const partialIdx = text.indexOf(firstLine);
				const hint = partialIdx !== -1
					? `\nПодсказка: первая строка old_text встречается в файле на позиции ${partialIdx}, но полностью old_text — нет. Проверь whitespace, табы vs пробелы, переносы строк.`
					: '';
				return this.error(`edit_file: old_text не найден в файле.${hint}`);
			}
			if (count > 1) {
				return this.error(`edit_file: old_text встречается ${count}+ раз — расширь контекст, чтобы он стал уникальным.`);
			}

			const newContent = text.slice(0, firstIdx) + args.new_text + text.slice(firstIdx + args.old_text.length);
			await this.fileService.writeFile(uri, VSBuffer.fromString(newContent));

			const oldLines = args.old_text.split('\n').length;
			const newLines = args.new_text.split('\n').length;
			return this.success(`✅ Заменено в ${uri.fsPath}: −${oldLines} стр. / +${newLines} стр. (Δ ${args.new_text.length - args.old_text.length} симв.)`);
		} catch (e) {
			return this.error(`edit_file: ${(e as Error).message}`);
		}
	}

	// ── delete_file ────────────────────────────────────────

	async deleteFile(args: { path?: string; recursive?: boolean }): Promise<AgentToolResult> {
		if (typeof args.path !== 'string' || !args.path.trim()) {
			return this.error('delete_file: параметр "path" обязателен');
		}
		const uri = this.resolvePath(args.path);
		if (!uri) {
			return this.error(`delete_file: путь "${args.path}" относительный, но workspace не открыт.`);
		}

		try {
			if (!(await this.fileService.exists(uri))) {
				return this.error(`delete_file: не найден: ${uri.fsPath}`);
			}
			const stat = await this.fileService.stat(uri);
			const isDir = stat.isDirectory;

			if (isDir && !args.recursive) {
				const children = await this.fileService.resolve(uri);
				const childCount = children.children?.length ?? 0;
				if (childCount > 0) {
					return this.error(`delete_file: ${uri.fsPath} — непустая директория (${childCount} элементов). Передай recursive: true для рекурсивного удаления.`);
				}
			}

			await this.fileService.del(uri, { recursive: !!args.recursive, useTrash: false });
			return this.success(`✅ Удалён ${isDir ? 'каталог' : 'файл'}: ${uri.fsPath}`);
		} catch (e) {
			return this.error(`delete_file: ${(e as Error).message}`);
		}
	}

	// ── list_dir ───────────────────────────────────────────

	async listDir(args: { path?: string; max_entries?: number }): Promise<AgentToolResult> {
		const pathArg = args.path?.trim() || '.';
		const uri = this.resolvePath(pathArg);
		if (!uri) {
			return this.error(`list_dir: путь "${pathArg}" относительный, но workspace не открыт.`);
		}

		const maxEntries = Math.min(
			Math.max(1, args.max_entries ?? DEFAULT_LIST_MAX_ENTRIES),
			HARD_LIST_MAX_ENTRIES
		);

		try {
			if (!(await this.fileService.exists(uri))) {
				return this.error(`list_dir: не найден: ${uri.fsPath}`);
			}
			const stat = await this.fileService.resolve(uri);
			if (!stat.isDirectory) {
				return this.error(`list_dir: ${uri.fsPath} — не директория, используй read_file`);
			}

			const children = stat.children ?? [];
			const sorted = [...children].sort((a, b) => {
				// Директории сначала, потом по имени
				if (a.isDirectory !== b.isDirectory) {
					return a.isDirectory ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});

			const truncated = sorted.length > maxEntries;
			const shown = sorted.slice(0, maxEntries);

			const lines: string[] = [`# ${uri.fsPath}`];
			for (const child of shown) {
				const marker = child.isDirectory ? '📁' : '📄';
				const size = child.isDirectory ? '' : ` (${this.formatSize(child.size ?? 0)})`;
				lines.push(`${marker} ${child.name}${size}`);
			}
			if (truncated) {
				lines.push(`\n[... обрезано: показано ${maxEntries} из ${sorted.length}. Передай max_entries больше для полного списка.]`);
			}
			return this.success(lines.join('\n'));
		} catch (e) {
			return this.error(`list_dir: ${(e as Error).message}`);
		}
	}

	private formatSize(bytes: number): string {
		if (bytes < 1024) { return `${bytes} B`; }
		if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	// ── search_files ───────────────────────────────────────

	async searchFiles(args: { query?: string; dir?: string; max_results?: number; case_sensitive?: boolean }): Promise<AgentToolResult> {
		if (typeof args.query !== 'string' || !args.query.trim()) {
			return this.error('search_files: параметр "query" обязателен');
		}

		const baseDir = args.dir?.trim() || '.';
		const rootUri = this.resolvePath(baseDir);
		if (!rootUri) {
			return this.error(`search_files: dir "${baseDir}" относительный, но workspace не открыт.`);
		}

		const maxResults = Math.min(
			Math.max(1, args.max_results ?? DEFAULT_SEARCH_MAX_RESULTS),
			HARD_SEARCH_MAX_RESULTS
		);
		const caseSensitive = !!args.case_sensitive;
		const needle = caseSensitive ? args.query : args.query.toLowerCase();

		try {
			if (!(await this.fileService.exists(rootUri))) {
				return this.error(`search_files: dir не найден: ${rootUri.fsPath}`);
			}

			const results: string[] = [];
			let filesScanned = 0;
			let stopped = false;

			const walk = async (uri: URI, depth: number): Promise<void> => {
				if (stopped || depth > 10) { return; }
				let stat;
				try {
					stat = await this.fileService.resolve(uri);
				} catch {
					return;
				}
				if (!stat.children) { return; }

				for (const child of stat.children) {
					if (stopped) { return; }
					if (SEARCH_SKIP_DIRS.has(child.name)) { continue; }

					if (child.isDirectory) {
						await walk(child.resource, depth + 1);
						continue;
					}

					filesScanned++;

					// 1. Проверка имени файла
					const fileName = caseSensitive ? child.name : child.name.toLowerCase();
					if (fileName.includes(needle)) {
						results.push(`📄 ${child.resource.fsPath} (имя файла)`);
						if (results.length >= maxResults) { stopped = true; return; }
						continue;
					}

					// 2. Проверка содержимого (только текстовые, до SEARCH_FILE_MAX_BYTES)
					const size = child.size ?? 0;
					if (size > SEARCH_FILE_MAX_BYTES) { continue; }

					try {
						const content = await this.fileService.readFile(child.resource);
						const text = caseSensitive ? content.value.toString() : content.value.toString().toLowerCase();
						const idx = text.indexOf(needle);
						if (idx !== -1) {
							const lineNumber = text.slice(0, idx).split('\n').length;
							const lineStart = text.lastIndexOf('\n', idx) + 1;
							const lineEnd = text.indexOf('\n', idx);
							const line = content.value.toString().slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
							const preview = line.length > 120 ? line.slice(0, 120) + '…' : line;
							results.push(`📄 ${child.resource.fsPath}:${lineNumber}  ${preview}`);
							if (results.length >= maxResults) { stopped = true; return; }
						}
					} catch {
						// бинарь или нет доступа — пропускаем
					}
				}
			};

			await walk(rootUri, 0);

			if (results.length === 0) {
				return this.success(`🔍 "${args.query}" — не найдено. Просканировано ${filesScanned} файлов.`);
			}
			const truncNote = stopped ? `\n\n[... обрезано: показано ${maxResults} результатов. Уточни запрос для меньшего объёма.]` : '';
			return this.success(`🔍 "${args.query}" — найдено ${results.length}:\n\n${results.join('\n')}${truncNote}`);
		} catch (e) {
			return this.error(`search_files: ${(e as Error).message}`);
		}
	}

	// ── mkdir ──────────────────────────────────────────────

	async mkdir(args: { path?: string }): Promise<AgentToolResult> {
		if (typeof args.path !== 'string' || !args.path.trim()) {
			return this.error('mkdir: параметр "path" обязателен');
		}
		const uri = this.resolvePath(args.path);
		if (!uri) {
			return this.error(`mkdir: путь "${args.path}" относительный, но workspace не открыт.`);
		}

		try {
			if (await this.fileService.exists(uri)) {
				const stat = await this.fileService.stat(uri);
				if (stat.isDirectory) {
					return this.success(`Директория уже существует: ${uri.fsPath}`);
				}
				return this.error(`mkdir: путь существует но это файл: ${uri.fsPath}`);
			}
			await this.fileService.createFolder(uri);
			return this.success(`✅ Создана директория: ${uri.fsPath}`);
		} catch (e) {
			return this.error(`mkdir: ${(e as Error).message}`);
		}
	}

	// ── Tool definitions (JSON Schema для LLM) ─────────────

	getToolDefinitions(): VibecoderTool[] {
		return [
			{
				type: 'function',
				function: {
					name: 'agent__read_file',
					description: '[Agent] Прочитать содержимое файла. Возвращает текст или ошибку. Большие файлы обрезаются (по умолчанию 50000 симв, max 500000).',
					parameters: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Абсолютный путь или относительный от workspace folder' },
							max_chars: { type: 'number', description: 'Лимит символов (default 50000, max 500000)' },
						},
						required: ['path'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'agent__write_file',
					description: '[Agent] Создать или перезаписать файл целиком. Родительские директории создаются автоматически. ОПАСНО — перезаписывает существующий файл, используй edit_file для точечных правок.',
					parameters: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Абсолютный или относительный путь' },
							content: { type: 'string', description: 'Полное новое содержимое файла' },
						},
						required: ['path', 'content'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'agent__edit_file',
					description: '[Agent] Точечная замена в существующем файле через search/replace. old_text должен встречаться РОВНО ОДИН РАЗ — если файл может содержать несколько таких фрагментов, расширь контекст вокруг для уникальности. Для создания нового файла используй write_file.',
					parameters: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Путь к существующему файлу' },
							old_text: { type: 'string', description: 'Фрагмент который нужно заменить — должен быть УНИКАЛЬНЫМ в файле' },
							new_text: { type: 'string', description: 'Новый текст (может быть пустой строкой для удаления)' },
						},
						required: ['path', 'old_text', 'new_text'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'agent__delete_file',
					description: '[Agent] Удалить файл или директорию. ОПАСНО — без корзины. Для непустой директории передай recursive: true.',
					parameters: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Путь' },
							recursive: { type: 'boolean', description: 'Рекурсивно для непустых директорий' },
						},
						required: ['path'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'agent__list_dir',
					description: '[Agent] Получить листинг директории. Возвращает имена с типами (📁 каталог / 📄 файл) и размерами.',
					parameters: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Путь к директории (default "." — workspace root)' },
							max_entries: { type: 'number', description: 'Лимит элементов (default 200, max 5000)' },
						},
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'agent__search_files',
					description: '[Agent] Найти файлы по подстроке в имени ИЛИ в содержимом. Пропускает node_modules/.git/dist и т.п. Для текстовых файлов ищет в содержимом, показывает номер строки и preview. Бинарники и файлы > 1MB пропускаются.',
					parameters: {
						type: 'object',
						properties: {
							query: { type: 'string', description: 'Подстрока для поиска' },
							dir: { type: 'string', description: 'Корневая директория (default "." — workspace root)' },
							max_results: { type: 'number', description: 'Лимит результатов (default 50, max 500)' },
							case_sensitive: { type: 'boolean', description: 'Учитывать регистр (default false)' },
						},
						required: ['query'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'agent__mkdir',
					description: '[Agent] Создать директорию (рекурсивно создаёт промежуточные).',
					parameters: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Путь к новой директории' },
						},
						required: ['path'],
					},
				},
			},
		];
	}

	/**
	 * Возвращает категорию tool — для confirm dialog решения.
	 *   - safe       — read/list/search → auto-approve
	 *   - dangerous  — write/edit/delete → confirm
	 *   - medium     — mkdir → confirm (но менее опасно)
	 */
	static getToolCategory(toolName: string): 'safe' | 'medium' | 'dangerous' {
		switch (toolName) {
			case 'agent__read_file':
			case 'agent__list_dir':
			case 'agent__search_files':
				return 'safe';
			case 'agent__mkdir':
				return 'medium';
			case 'agent__write_file':
			case 'agent__edit_file':
			case 'agent__delete_file':
				return 'dangerous';
			default:
				return 'dangerous';
		}
	}

	/**
	 * Диспатчер — выбирает нужный метод по имени tool.
	 */
	async dispatch(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult> {
		switch (toolName) {
			case 'agent__read_file':
				return this.readFile(args as Parameters<FsTools['readFile']>[0]);
			case 'agent__write_file':
				return this.writeFile(args as Parameters<FsTools['writeFile']>[0]);
			case 'agent__edit_file':
				return this.editFile(args as Parameters<FsTools['editFile']>[0]);
			case 'agent__delete_file':
				return this.deleteFile(args as Parameters<FsTools['deleteFile']>[0]);
			case 'agent__list_dir':
				return this.listDir(args as Parameters<FsTools['listDir']>[0]);
			case 'agent__search_files':
				return this.searchFiles(args as Parameters<FsTools['searchFiles']>[0]);
			case 'agent__mkdir':
				return this.mkdir(args as Parameters<FsTools['mkdir']>[0]);
			default:
				return { content: `fsTools: неизвестный tool ${toolName}`, isError: true };
		}
	}

	static getToolNames(): string[] {
		return [
			'agent__read_file',
			'agent__write_file',
			'agent__edit_file',
			'agent__delete_file',
			'agent__list_dir',
			'agent__search_files',
			'agent__mkdir',
		];
	}
}
