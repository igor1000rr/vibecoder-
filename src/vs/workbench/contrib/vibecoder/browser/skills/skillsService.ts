/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Skills loader Vibecoder.
 *
 * Skill — это папка `.vibecoder/skills/<name>/` с файлом `SKILL.md`,
 * содержащим YAML frontmatter с метаданными (name, description, version)
 * и markdown с инструкциями для LLM.
 *
 * Формат совместим с Anthropic Skills (claude.ai), поэтому юзер может
 * переиспользовать skills между Claude и Vibecoder без конвертации.
 *
 * Файл SKILL.md:
 *
 *   ---
 *   name: code-review
 *   description: Use when reviewing pull requests or commits. Reviews code for
 *     security issues, style, and clarity.
 *   version: 1.0.0
 *   ---
 *
 *   # Code Review Skill
 *
 *   When the user asks for a code review:
 *   1. Check for security issues...
 *   2. Check for style...
 *
 * В системный промпт агента подгружаются только descriptions (короткие),
 * а полный SKILL.md грузится LLM-агентом через специальный tool `read_skill`
 * по решению модели. Это паттерн Anthropic Skills - экономит контекст.
 */

import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export const IVibecoderSkillsService = createDecorator<IVibecoderSkillsService>('vibecoderSkillsService');

export interface VibecoderSkillMetadata {
	name: string;
	description: string;
	version?: string;
	/** дополнительные поля frontmatter, доступные через индексирование */
	[key: string]: unknown;
}

export interface VibecoderSkill {
	/** Уникальный идентификатор skill - его имя из frontmatter */
	id: string;
	/** Путь к директории скилла */
	rootUri: URI;
	/** Метаданные из YAML frontmatter */
	metadata: VibecoderSkillMetadata;
	/** Полный markdown-контент SKILL.md (без frontmatter) */
	body: string;
}

export interface IVibecoderSkillsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSkills: Event<void>;

	/**
	 * Загрузить все skills из workspace (`.vibecoder/skills/`) и из глобальной
	 * пользовательской директории (`~/.vibecoder/skills/`).
	 */
	reload(): Promise<void>;

	/** Все известные skills */
	getAllSkills(): readonly VibecoderSkill[];

	/** Получить skill по id (= name из frontmatter) */
	getSkill(id: string): VibecoderSkill | undefined;

	/**
	 * Краткий "оглавление skills" для системного промпта.
	 * Только id + description, без body. Используется так:
	 *
	 *   System prompt:
	 *     "У тебя есть набор skills. Каждый - инструкция как делать
	 *     специфичную задачу. Список:
	 *     - code-review: Use when reviewing pull requests...
	 *     - api-design: Use when designing REST APIs...
	 *     Если задача попадает под один из них - вызови tool
	 *     read_skill({id: 'code-review'}) чтобы получить полную инструкцию."
	 */
	getDescriptionsForPrompt(): string;
}

/**
 * Простой парсер YAML frontmatter.
 * Поддерживает только то что встречается в SKILL.md: плоский map строка-строка,
 * многострочные значения через отступ.
 *
 * Полноценный YAML-парсер не используем намеренно: чтобы не тянуть зависимость.
 */
function parseFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (!match) {
		return { metadata: {}, body: text };
	}
	const [, yamlBlock, body] = match;
	const metadata: Record<string, string> = {};

	const lines = yamlBlock.split(/\r?\n/);
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const keyValueMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
		if (!keyValueMatch) { i++; continue; }
		const [, key, valueStart] = keyValueMatch;
		let value = valueStart.trim();

		// Multi-line continuation: следующие строки с отступом
		i++;
		while (i < lines.length && /^\s+\S/.test(lines[i])) {
			value += ' ' + lines[i].trim();
			i++;
		}

		// Снимаем кавычки если есть
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		metadata[key] = value;
	}

	return { metadata, body };
}

export class VibecoderSkillsService extends Disposable implements IVibecoderSkillsService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeSkills = this._register(new Emitter<void>());
	readonly onDidChangeSkills: Event<void> = this._onDidChangeSkills.event;

	private readonly skills = new Map<string, VibecoderSkill>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IInstantiationService _instantiationService: IInstantiationService,
	) {
		super();
		// Первая загрузка
		this.reload().catch(err => console.error('[Vibecoder] Skills load failed:', err));

		// Перезагружать при смене workspace
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => {
			this.reload().catch(err => console.error('[Vibecoder] Skills reload failed:', err));
		}));
	}

	async reload(): Promise<void> {
		this.skills.clear();

		const folders = this.workspaceService.getWorkspace().folders;
		for (const folder of folders) {
			const skillsRoot = URI.joinPath(folder.uri, '.vibecoder', 'skills');
			await this.loadSkillsFromDir(skillsRoot);
		}

		this._onDidChangeSkills.fire();
	}

	private async loadSkillsFromDir(rootUri: URI): Promise<void> {
		let exists = false;
		try {
			exists = await this.fileService.exists(rootUri);
		} catch {
			return;
		}
		if (!exists) { return; }

		let stat;
		try {
			stat = await this.fileService.resolve(rootUri);
		} catch {
			return;
		}
		if (!stat.isDirectory || !stat.children) { return; }

		for (const child of stat.children) {
			if (!child.isDirectory) { continue; }
			const skillMdUri = URI.joinPath(child.resource, 'SKILL.md');
			try {
				const fileExists = await this.fileService.exists(skillMdUri);
				if (!fileExists) { continue; }
				const content = await this.fileService.readFile(skillMdUri);
				const text = content.value.toString();
				const { metadata, body } = parseFrontmatter(text);

				const name = metadata.name?.trim();
				if (!name) {
					console.warn(`[Vibecoder Skills] ${skillMdUri.toString()}: пропущен - нет поля 'name' в frontmatter`);
					continue;
				}
				const description = metadata.description?.trim() ?? '';

				this.skills.set(name, {
					id: name,
					rootUri: child.resource,
					metadata: { ...metadata, name, description },
					body,
				});
			} catch (e) {
				console.warn(`[Vibecoder Skills] не удалось загрузить ${skillMdUri.toString()}:`, e);
			}
		}
	}

	getAllSkills(): readonly VibecoderSkill[] {
		return Array.from(this.skills.values());
	}

	getSkill(id: string): VibecoderSkill | undefined {
		return this.skills.get(id);
	}

	getDescriptionsForPrompt(): string {
		if (this.skills.size === 0) { return ''; }
		const lines = ['## Available Skills', ''];
		for (const skill of this.skills.values()) {
			lines.push(`- **${skill.id}**: ${skill.metadata.description}`);
		}
		lines.push('');
		lines.push(
			'When a user request matches one of these skills, call tool ' +
			'`vibecoder_read_skill({id: "..."})` to load the full instruction before responding.'
		);
		return lines.join('\n');
	}

	/**
	 * Утилита: записать новый skill в workspace.
	 * Полезна для будущего UI "Create Skill".
	 */
	async writeSkillToWorkspace(skill: { name: string; description: string; body: string; version?: string }): Promise<URI | undefined> {
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length === 0) { return undefined; }
		const root = folders[0].uri;
		const dir = URI.joinPath(root, '.vibecoder', 'skills', skill.name);
		const file = URI.joinPath(dir, 'SKILL.md');

		const yaml = [
			'---',
			`name: ${skill.name}`,
			`description: ${skill.description.replace(/\n/g, ' ')}`,
			...(skill.version ? [`version: ${skill.version}`] : []),
			'---',
			'',
			skill.body,
		].join('\n');

		await this.fileService.createFolder(dir);
		await this.fileService.writeFile(file, VSBuffer.fromString(yaml));
		await this.reload();
		return file;
	}
}
