/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Skills loader Vibecoder.
 *
 * Skill — это набор инструкций для LLM, активируемый по триггерным фразам.
 * Источники (в порядке возрастания приоритета — последующие перебивают предыдущие):
 *   1. Built-in (см. builtinSkills.ts) — 23 встроенных, доступны сразу
 *   2. Workspace: .vibecoder/skills/<name>/SKILL.md — для проектных override'ов
 *
 * Файл SKILL.md:
 *
 *   ---
 *   name: code-review
 *   description: Use when reviewing pull requests or commits...
 *   version: 1.0.0
 *   ---
 *
 *   # Code Review Skill
 *   ...
 *
 * В системный промпт агента подгружаются только descriptions (короткие),
 * полный SKILL.md грузится через tool `vibecoder_read_skill` по решению LLM.
 * Это паттерн Anthropic Skills - экономит контекст.
 */

import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { BUILTIN_SKILLS } from './builtinSkills.js';

export const IVibecoderSkillsService = createDecorator<IVibecoderSkillsService>('vibecoderSkillsService');

export interface VibecoderSkillMetadata {
	name: string;
	description: string;
	version?: string;
	[key: string]: unknown;
}

export interface VibecoderSkill {
	id: string;
	rootUri: URI;
	metadata: VibecoderSkillMetadata;
	body: string;
}

export interface IVibecoderSkillsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSkills: Event<void>;

	reload(): Promise<void>;
	getAllSkills(): readonly VibecoderSkill[];
	getSkill(id: string): VibecoderSkill | undefined;
	getDescriptionsForPrompt(): string;
}

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

		i++;
		while (i < lines.length && /^\s+\S/.test(lines[i])) {
			value += ' ' + lines[i].trim();
			i++;
		}

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
		this.reload().catch(err => console.error('[Vibecoder] Skills load failed:', err));

		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => {
			this.reload().catch(err => console.error('[Vibecoder] Skills reload failed:', err));
		}));
	}

	async reload(): Promise<void> {
		this.skills.clear();

		// 1. Сначала built-in (23 шт из builtinSkills.ts) — всегда доступны
		for (const skill of BUILTIN_SKILLS) {
			this.skills.set(skill.id, skill);
		}

		// 2. Потом workspace .vibecoder/skills/ — перебивает built-in по id
		const folders = this.workspaceService.getWorkspace().folders;
		for (const folder of folders) {
			const skillsRoot = URI.joinPath(folder.uri, '.vibecoder', 'skills');
			await this.loadSkillsFromDir(skillsRoot);
		}

		console.log(`[Vibecoder Skills] loaded ${this.skills.size} skills (${BUILTIN_SKILLS.length} built-in + ${this.skills.size - BUILTIN_SKILLS.length} workspace)`);
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
					metadata: { ...metadata, name, description, source: 'workspace' },
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
