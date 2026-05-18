/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Goal / TodoList tools для Vibecoder Agent.
 *
 * Концепция как в Claude Code TodoWrite: модель планирует многошаговую
 * задачу через set_goal, по ходу работы обновляет статусы через
 * update_step, в конце закрывает через complete_goal.
 *
 * UI отображает текущий goal как живой чек-лист сверху чата —
 * юзер видит прогресс реал-тайм через EventEmitter onDidChange.
 *
 * Все 3 tools — safe (auto-approve), потому что они только меняют
 * UI-состояние, не трогают файлы и систему.
 */

import { Event, Emitter } from '../../../../../base/common/event.js';
import { VibecoderTool } from '../llm/llmProvider.js';
import { AgentToolResult } from './fsTools.js';

export type GoalStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface GoalStep {
	readonly id: string;
	readonly title: string;
	readonly status: GoalStepStatus;
	readonly note?: string;
}

export interface GoalState {
	readonly title: string;
	readonly steps: GoalStep[];
	readonly createdAt: number;
	readonly completedAt?: number;
	readonly summary?: string;
}

export class GoalTools {
	private current: GoalState | null = null;
	private readonly _onDidChange = new Emitter<GoalState | null>();
	readonly onDidChange: Event<GoalState | null> = this._onDidChange.event;

	getCurrent(): GoalState | null {
		return this.current;
	}

	reset(): void {
		if (this.current) {
			this.current = null;
			this._onDidChange.fire(null);
		}
	}

	private success(content: string): AgentToolResult {
		return { content, isError: false };
	}

	private error(content: string): AgentToolResult {
		return { content, isError: true };
	}

	async setGoal(args: { title?: string; steps?: Array<{ id?: string; title?: string }> }): Promise<AgentToolResult> {
		if (typeof args.title !== 'string' || !args.title.trim()) {
			return this.error('set_goal: title обязателен');
		}
		if (!Array.isArray(args.steps) || args.steps.length === 0) {
			return this.error('set_goal: steps[] обязателен (минимум 1 шаг)');
		}
		if (args.steps.length > 30) {
			return this.error(`set_goal: слишком много шагов (${args.steps.length}). Максимум 30 — разбей задачу.`);
		}
		const steps: GoalStep[] = [];
		const seenIds = new Set<string>();
		for (let i = 0; i < args.steps.length; i++) {
			const s = args.steps[i];
			if (!s || typeof s.title !== 'string' || !s.title.trim()) {
				return this.error(`set_goal: steps[${i}].title обязателен`);
			}
			let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `step-${i + 1}`;
			if (seenIds.has(id)) {
				id = `${id}-${i + 1}`;
			}
			seenIds.add(id);
			steps.push({ id, title: s.title.trim(), status: 'pending' });
		}
		this.current = {
			title: args.title.trim(),
			steps,
			createdAt: Date.now(),
		};
		this._onDidChange.fire(this.current);
		const stepsView = steps.map((s, i) => `  ${i + 1}. [${s.id}] ${s.title}`).join('\n');
		return this.success(
			`🎯 Установлена цель: "${this.current.title}"\n` +
			`План (${steps.length} шагов):\n${stepsView}\n\n` +
			`Используй update_step(step_id, status) по ходу работы — in_progress перед, done после.`
		);
	}

	async updateStep(args: { step_id?: string; status?: string; note?: string }): Promise<AgentToolResult> {
		if (!this.current) {
			return this.error('update_step: текущей цели нет — сначала вызови set_goal');
		}
		if (typeof args.step_id !== 'string' || !args.step_id.trim()) {
			return this.error('update_step: step_id обязателен');
		}
		const validStatuses: GoalStepStatus[] = ['pending', 'in_progress', 'done', 'skipped'];
		if (!validStatuses.includes(args.status as GoalStepStatus)) {
			return this.error(`update_step: status должен быть один из ${validStatuses.join(', ')}`);
		}
		const idx = this.current.steps.findIndex(s => s.id === args.step_id);
		if (idx === -1) {
			return this.error(
				`update_step: шаг "${args.step_id}" не найден. ` +
				`Существующие IDs: ${this.current.steps.map(s => s.id).join(', ')}`
			);
		}
		const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim() : undefined;
		const updated: GoalStep = {
			...this.current.steps[idx],
			status: args.status as GoalStepStatus,
			note,
		};
		const newSteps = [...this.current.steps];
		newSteps[idx] = updated;
		this.current = { ...this.current, steps: newSteps };
		this._onDidChange.fire(this.current);
		const icon =
			args.status === 'done' ? '✅' :
				args.status === 'in_progress' ? '⏳' :
					args.status === 'skipped' ? '⏭' : '⬜';
		return this.success(
			`${icon} Шаг "${updated.title}" → ${args.status}${note ? `\nNote: ${note}` : ''}`
		);
	}

	async completeGoal(args: { summary?: string }): Promise<AgentToolResult> {
		if (!this.current) {
			return this.error('complete_goal: текущей цели нет');
		}
		const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
		const pending = this.current.steps.filter(s => s.status === 'pending' || s.status === 'in_progress');
		if (pending.length > 0) {
			return this.error(
				`complete_goal: ${pending.length} шагов не завершены (${pending.map(s => s.id).join(', ')}). ` +
				`Сначала обнови их через update_step (done или skipped).`
			);
		}
		this.current = { ...this.current, completedAt: Date.now(), summary };
		this._onDidChange.fire(this.current);
		const done = this.current.steps.filter(s => s.status === 'done').length;
		const skipped = this.current.steps.filter(s => s.status === 'skipped').length;
		return this.success(
			`🏁 Цель "${this.current.title}" завершена.\n` +
			`✅ ${done} выполнено, ⏭ ${skipped} пропущено.\n` +
			(summary ? `\nSummary: ${summary}` : '')
		);
	}

	getToolDefinitions(): VibecoderTool[] {
		return [
			{
				type: 'function',
				function: {
					name: 'agent__set_goal',
					description:
						'[Agent · Goal] Установить цель и план шагов для долгой многошаговой задачи (3+ действий). ' +
						'План показывается юзеру как живой чек-лист сверху чата. Заменяет текущую цель если есть. ' +
						'НЕ вызывай для тривиальных задач (один read/edit/write).',
					parameters: {
						type: 'object',
						properties: {
							title: { type: 'string', description: 'Краткое название цели (например "Добавить dark mode в Settings")' },
							steps: {
								type: 'array',
								description: 'Конкретные шаги (1-30). Не абстрактные ("подумать"). Каждый — выполнимое действие.',
								items: {
									type: 'object',
									properties: {
										id: { type: 'string', description: 'Короткий ID (опционально — иначе step-N)' },
										title: { type: 'string', description: 'Действие шага' },
									},
									required: ['title'],
								},
							},
						},
						required: ['title', 'steps'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'agent__update_step',
					description:
						'[Agent · Goal] Обновить статус шага текущей цели. Перед началом шага → in_progress, после → done (или skipped).',
					parameters: {
						type: 'object',
						properties: {
							step_id: { type: 'string', description: 'ID шага из set_goal' },
							status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'skipped'] },
							note: { type: 'string', description: 'Опциональный комментарий' },
						},
						required: ['step_id', 'status'],
					},
				},
			},
			{
				type: 'function',
				function: {
					name: 'agent__complete_goal',
					description:
						'[Agent · Goal] Закрыть текущую цель с финальным резюме. Вызывай после того как все шаги done/skipped.',
					parameters: {
						type: 'object',
						properties: {
							summary: { type: 'string', description: 'Краткое резюме что сделано (1-3 предложения)' },
						},
					},
				},
			},
		];
	}

	static getToolCategory(_toolName: string): 'safe' | 'medium' | 'dangerous' {
		return 'safe';
	}

	async dispatch(toolName: string, args: Record<string, unknown>): Promise<AgentToolResult> {
		switch (toolName) {
			case 'agent__set_goal':
				return this.setGoal(args as Parameters<GoalTools['setGoal']>[0]);
			case 'agent__update_step':
				return this.updateStep(args as Parameters<GoalTools['updateStep']>[0]);
			case 'agent__complete_goal':
				return this.completeGoal(args as Parameters<GoalTools['completeGoal']>[0]);
			default:
				return { content: `goalTools: неизвестный tool ${toolName}`, isError: true };
		}
	}

	static getToolNames(): string[] {
		return ['agent__set_goal', 'agent__update_step', 'agent__complete_goal'];
	}
}
