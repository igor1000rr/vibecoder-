/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * История чатов NIT.
 *
 * Хранит список чатов и их сообщения в IStorageService (workspace scope —
 * чаты привязаны к проекту). При reload window/IDE история восстанавливается.
 *
 * Каждый чат имеет:
 *   - id (uuid-like)
 *   - title (первое сообщение юзера, обрезанное)
 *   - createdAt / updatedAt (timestamps)
 *   - messages (VibecoderChatMessage[])
 *
 * Лимиты:
 *   - максимум 50 чатов (старые удаляются)
 *   - максимум 200 сообщений в одном чате (старые ассистенские обрезаются)
 *   - чаты старше 60 дней удаляются автоматически
 *
 * Формат в storage: один ключ 'vibecoder.chats.index' (список метаданных) +
 * по ключу 'vibecoder.chat.<id>' на каждый чат (сообщения).
 *
 * Такая структура: список можно загрузить быстро (для UI dropdown), а полный
 * чат только по запросу.
 */

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { VibecoderChatMessage } from '../llm/llmProvider.js';

export const IVibecoderChatHistoryService = createDecorator<IVibecoderChatHistoryService>('vibecoderChatHistoryService');

export interface VibecoderChatMetadata {
	readonly id: string;
	readonly title: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly messageCount: number;
}

export interface VibecoderChatSession {
	readonly id: string;
	readonly title: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly messages: VibecoderChatMessage[];
}

export interface IVibecoderChatHistoryService {
	readonly _serviceBrand: undefined;

	/** Срабатывает когда список чатов изменился (добавлен/удалён/переименован) */
	readonly onDidChangeChats: Event<void>;

	/** Получить список метаданных чатов (для UI). Отсортирован по updatedAt desc. */
	getChats(): readonly VibecoderChatMetadata[];

	/** Создать новый чат. Возвращает id. */
	createChat(): string;

	/** Загрузить чат полностью (с сообщениями). undefined если не найден. */
	loadChat(id: string): VibecoderChatSession | undefined;

	/** Сохранить сообщения чата (вызывается после каждой отправки). */
	saveMessages(id: string, messages: VibecoderChatMessage[]): void;

	/** Удалить чат по id. */
	deleteChat(id: string): void;

	/** Удалить все чаты. */
	clearAll(): void;
}

const STORAGE_KEY_INDEX = 'vibecoder.chats.index';
const STORAGE_KEY_PREFIX_CHAT = 'vibecoder.chat.';
const MAX_CHATS = 50;
const MAX_MESSAGES_PER_CHAT = 200;
const CHAT_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 дней
const TITLE_MAX_CHARS = 60;

interface StoredIndex {
	chats: VibecoderChatMetadata[];
}

interface StoredSession {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: VibecoderChatMessage[];
}

export class VibecoderChatHistoryService extends Disposable implements IVibecoderChatHistoryService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeChats = this._register(new Emitter<void>());
	readonly onDidChangeChats: Event<void> = this._onDidChangeChats.event;

	private index: VibecoderChatMetadata[] = [];

	constructor(@IStorageService private readonly storageService: IStorageService) {
		super();
		this.loadIndex();
		this.cleanupOldChats();
	}

	getChats(): readonly VibecoderChatMetadata[] {
		return this.index;
	}

	createChat(): string {
		const id = this.generateId();
		const now = Date.now();
		const metadata: VibecoderChatMetadata = {
			id,
			title: '(новый чат)',
			createdAt: now,
			updatedAt: now,
			messageCount: 0,
		};
		this.index.unshift(metadata);
		this.persistIndex();

		const session: StoredSession = {
			id,
			title: metadata.title,
			createdAt: now,
			updatedAt: now,
			messages: [],
		};
		this.persistSession(session);

		this._onDidChangeChats.fire();
		return id;
	}

	loadChat(id: string): VibecoderChatSession | undefined {
		const raw = this.storageService.get(STORAGE_KEY_PREFIX_CHAT + id, StorageScope.WORKSPACE);
		if (!raw) { return undefined; }
		try {
			const session = JSON.parse(raw) as StoredSession;
			return {
				id: session.id,
				title: session.title,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				messages: session.messages ?? [],
			};
		} catch (e) {
			console.warn(`[Vibecoder Chat History] не удалось распарсить чат ${id}:`, e);
			return undefined;
		}
	}

	saveMessages(id: string, messages: VibecoderChatMessage[]): void {
		// Обрезаем слишком длинные чаты (старые сообщения отбрасываем, оставляем
		// первое system + последние N)
		let trimmed = messages;
		if (messages.length > MAX_MESSAGES_PER_CHAT) {
			const systemMsg = messages[0]?.role === 'system' ? [messages[0]] : [];
			const tail = messages.slice(-MAX_MESSAGES_PER_CHAT + systemMsg.length);
			trimmed = [...systemMsg, ...tail];
		}

		const now = Date.now();
		const title = this.deriveTitle(trimmed) ?? '(новый чат)';

		const session: StoredSession = {
			id,
			title,
			createdAt: this.index.find(c => c.id === id)?.createdAt ?? now,
			updatedAt: now,
			messages: trimmed,
		};
		this.persistSession(session);

		// Обновляем index
		const idx = this.index.findIndex(c => c.id === id);
		const metadata: VibecoderChatMetadata = {
			id,
			title,
			createdAt: session.createdAt,
			updatedAt: now,
			messageCount: trimmed.length,
		};
		if (idx === -1) {
			this.index.unshift(metadata);
		} else {
			this.index.splice(idx, 1);
			this.index.unshift(metadata);
		}

		// Лимит по количеству — удаляем самые старые
		while (this.index.length > MAX_CHATS) {
			const removed = this.index.pop();
			if (removed) {
				this.storageService.remove(STORAGE_KEY_PREFIX_CHAT + removed.id, StorageScope.WORKSPACE);
			}
		}

		this.persistIndex();
		this._onDidChangeChats.fire();
	}

	deleteChat(id: string): void {
		this.index = this.index.filter(c => c.id !== id);
		this.persistIndex();
		this.storageService.remove(STORAGE_KEY_PREFIX_CHAT + id, StorageScope.WORKSPACE);
		this._onDidChangeChats.fire();
	}

	clearAll(): void {
		for (const chat of this.index) {
			this.storageService.remove(STORAGE_KEY_PREFIX_CHAT + chat.id, StorageScope.WORKSPACE);
		}
		this.index = [];
		this.persistIndex();
		this._onDidChangeChats.fire();
	}

	// ── Внутрянка ─────────────────────────────────────────────

	private loadIndex(): void {
		const raw = this.storageService.get(STORAGE_KEY_INDEX, StorageScope.WORKSPACE);
		if (!raw) { return; }
		try {
			const parsed = JSON.parse(raw) as StoredIndex;
			if (Array.isArray(parsed.chats)) {
				this.index = parsed.chats;
			}
		} catch (e) {
			console.warn('[Vibecoder Chat History] не удалось распарсить index:', e);
			this.index = [];
		}
	}

	private persistIndex(): void {
		const data: StoredIndex = { chats: this.index };
		this.storageService.store(STORAGE_KEY_INDEX, JSON.stringify(data), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private persistSession(session: StoredSession): void {
		try {
			this.storageService.store(
				STORAGE_KEY_PREFIX_CHAT + session.id,
				JSON.stringify(session),
				StorageScope.WORKSPACE,
				StorageTarget.MACHINE,
			);
		} catch (e) {
			console.warn(`[Vibecoder Chat History] не удалось сохранить чат ${session.id}:`, e);
		}
	}

	private cleanupOldChats(): void {
		const now = Date.now();
		const toRemove = this.index.filter(c => now - c.updatedAt > CHAT_TTL_MS);
		if (toRemove.length === 0) { return; }
		for (const chat of toRemove) {
			this.storageService.remove(STORAGE_KEY_PREFIX_CHAT + chat.id, StorageScope.WORKSPACE);
		}
		this.index = this.index.filter(c => now - c.updatedAt <= CHAT_TTL_MS);
		this.persistIndex();
	}

	/**
	 * Заголовок чата = первое непустое сообщение юзера, обрезанное.
	 */
	private deriveTitle(messages: VibecoderChatMessage[]): string | undefined {
		for (const msg of messages) {
			if (msg.role === 'user' && msg.content.trim().length > 0) {
				const firstLine = msg.content.split('\n')[0].trim();
				return firstLine.length > TITLE_MAX_CHARS
					? firstLine.slice(0, TITLE_MAX_CHARS) + '…'
					: firstLine;
			}
		}
		return undefined;
	}

	private generateId(): string {
		// Простой uuid-like — не нужна криптостойкость
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
	}
}
