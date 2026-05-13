/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 9 Cursor-specific skills, портированных из cursor-dump.md (skills-cursor секция).
 *
 * Они описывают паттерны работы агента в стиле Cursor: PR babysitting,
 * Canvas-артефакты, hooks/rules/skills creation, Cursor SDK, splitting work into PRs,
 * status line config, settings.json editing.
 *
 * Часть концепций (Canvas, hooks) специфична для Cursor, но смысл остаётся
 * полезным для аналогичных задач в Vibecoder.
 */

import { URI } from '../../../../../base/common/uri.js';
import { VibecoderSkill } from './skillsService.js';

function builtin(name: string, description: string, body: string): VibecoderSkill {
	return {
		id: name,
		rootUri: URI.parse(`vibecoder-builtin:/skills/${name}`),
		metadata: { name, description, version: '1.0.0', source: 'builtin' },
		body: body.trim(),
	};
}

const SKILL_BABYSIT = builtin(
	'babysit',
	'Use to keep PR in merge-ready state across CI cycles and review comments. Triggers: "поддержи PR", "babysit", "довести PR до merge".',
	`# babysit — Поддержание PR в merge-ready состоянии

Триaging review-комментариев, разрешение конфликтов, починка CI в цикле.

## Алгоритм
1. **Комментарии**:
   - Прочитать ВСЕ комментарии (включая Bugbot/automated)
   - Фиксить только с явным согласием юзера ("да, поправь" / "согласен с замечанием")
   - НЕ молча соглашаться с критикой без обсуждения

2. **Merge-конфликты**:
   - Резолвить только когда интент очевидно совпадает (форматирование, импорты)
   - При неоднозначности — спросить какую версию оставить
   - НЕ оставлять conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`)

3. **CI**:
   - Маленькие scoped-фиксы для каждой упавшей проверки
   - НЕ переделывать большие куски ради одного теста
   - Пересмотр после каждого CI-цикла → есть ли новые комментарии

## Циклы
Каждый цикл: \`git fetch\` → review comments → CI status → fix → push → wait.
Максимум 5 циклов без человеческого ревью, потом стоп и спросить.

## НЕ делать
- Force-push без согласия (\`git push --force\`)
- \`git rebase main\` если есть коллеги работающие в той же ветке
- Squash commits без явной просьбы
- Закрывать комментарии "Resolved" без реального резолюшна`,
);

const SKILL_CANVAS = builtin(
	'canvas',
	'Use to create live React artifact alongside chat for analytical deliverables (tables, charts, dashboards). Triggers: "сделай canvas", "артефакт", quantitative analysis requests.',
	`# canvas — Живой React-артефакт рядом с чатом

Аналог Cursor Canvas — React-компонент с готовыми данными для аналитических deliverables.

## Когда использовать
- Количественный анализ (billing, usage, security audit)
- Данные из MCP (Datadog, Databricks, Linear) как итоговый артефакт
- Таблицы > нескольких строк
- Дашборды с несколькими виджетами

## Когда НЕ использовать
- Простой текстовый ответ (используй markdown)
- Код для проекта юзера (это файл, не canvas)
- Длинные нарративы (это документ)

## Где хранить (адаптировано для Vibecoder)
Workspace: \`.vibecoder/canvases/<name>.canvas.tsx\` или текущая папка проекта.

## Правила
- Один \`.canvas.tsx\` файл, без helper-файлов
- **Данные инлайн** — не делать \`fetch()\` в runtime (это снапшот)
- React functional component с default export
- TypeScript типы для данных
- Минимум зависимостей: React + tailwind/css-modules

## Шаблон
\`\`\`tsx
import React from 'react';

interface Row {
  service: string;
  uptime: number;
  errors: number;
}

const DATA: Row[] = [
  { service: 'auth', uptime: 99.9, errors: 12 },
  { service: 'api',  uptime: 99.5, errors: 47 },
];

export default function CanvasArtifact() {
  return (
    <table className="...">
      {/* render DATA */}
    </table>
  );
}
\`\`\``,
);

const SKILL_CREATE_HOOK = builtin(
	'create-hook',
	'Use to create automation hooks for agent events (before/after tool use, file edits, sessions). Triggers: "сделай хук", "автоматизируй событие", /create-hook.',
	`# create-hook — Создание хуков автоматизации

Хуки автоматизируют действия по событиям агента (Cursor Hooks-style).

## Ключевые события
- \`beforeShellExecution\` — блокировка опасных команд (\`rm -rf /\`, \`git push --force\`)
- \`afterFileEdit\` — авто-форматирование после правок (prettier, eslint --fix)
- \`preToolUse\` / \`postToolUse\` — контроль использования tools
- \`subagentStart\` / \`subagentStop\` — управление под-агентами
- \`sessionStart\` / \`sessionEnd\` — setup/audit сессии

## 2 формата хуков
### Command hooks
Скрипт получает event JSON через stdin, отдает решение через stdout:
\`\`\`json
{ "event": "beforeShellExecution", "command": "rm -rf /" }
\`\`\`
Stdout:
\`\`\`json
{ "decision": "block", "reason": "опасная команда" }
\`\`\`

### Prompt hooks
LLM-политика через промпт: "Это безопасная команда? Объясни."

## Принципы
- Хуки идемпотентны (повторный вызов даёт тот же результат)
- Быстрые (< 200ms) чтобы не блокировать UX
- Логировать решения для аудита
- НЕ молча модифицировать данные — только blocking decision или passthrough

## Хранение (для Vibecoder)
\`.vibecoder/hooks/<event-name>.{js,sh}\` в workspace
или \`~/.vibecoder/hooks/\` для глобальных`,
);

const SKILL_CREATE_RULE = builtin(
	'create-rule',
	'Use to create persistent rules that apply context to every agent message (alwaysApply or glob-based). Triggers: "сделай правило", "создай rule", /create-rule.',
	`# create-rule — Создание правил постоянного контекста

Правила автоматически инжектят инструкции в каждое сообщение агента.

## Конфигурации
- \`alwaysApply: true\` — применяется ко всем запросам
- \`globs: "**/*.ts"\` — только для файлов соответствующих паттерну
- \`globs: "*.tsx"\` — только React-файлы
- \`appliesTo: "edit" | "chat"\` — где использовать

## Структура файла (для Vibecoder)
\`.vibecoder/rules/<name>.md\`:
\`\`\`markdown
---
alwaysApply: true
description: "Правило для Russian commits"
---

# Always commit in Russian

Все commit сообщения — на русском, не более 72 символа.
Формат: "Глагол + что", без точки в конце.
\`\`\`

## Длина
- Описание ≤ 200 символов
- Тело правила ≤ 500 строк (если больше — разбить на несколько правил)
- Каждое правило — одна тема

## Антипаттерны
- Слишком общие ("пиши хороший код") — бесполезны
- Противоречивые правила (одно говорит А, другое не-А)
- Дублирование с conventions.md — single source of truth
- Скрытые секреты в правилах (правила в git)`,
);

const SKILL_CREATE_SKILL = builtin(
	'create-skill',
	'Use to create new Agent Skills (SKILL.md). Triggers: "сделай скилл", "создай навык", /create-skill.',
	`# create-skill — Создание новых Skills

Скилл = инструкция для агента активируемая по триггерным фразам.

## Структура
\`\`\`
skill-name/
├── SKILL.md              # Обязательно — главная инструкция
├── reference.md          # Опционально — справочная инфа
├── examples.md           # Опционально — примеры
└── scripts/              # Опционально — helper-скрипты
\`\`\`

## Где хранить
- \`.vibecoder/skills/<name>/\` — проектные (в git)
- \`~/.vibecoder/skills/<name>/\` — личные глобальные

## Правила SKILL.md
- Размер < 500 строк (длиннее → разбить на reference.md)
- **Description в third person** с WHAT + WHEN + trigger terms
- Пример: "Use when reviewing PRs. Triggers: /review, 'проверь код'."
- НЕ "I review PRs" (от первого лица)

## Frontmatter
\`\`\`yaml
---
name: skill-id-here
description: Use when X. Triggers: /command, "phrase 1", "phrase 2".
version: 1.0.0
---
\`\`\`

## Тело
1. **Заголовок** — что это и когда применять
2. **Алгоритм** — пошагово что делать
3. **Антипаттерны** — что НЕ делать
4. **Формат вывода** — как структурировать ответ

## Проверка
После создания: вызвать \`vibecoder.reloadSkills\` → проверить что появился в Settings → проверить что NIT использует при триггерной фразе`,
);

const SKILL_SDK = builtin(
	'sdk',
	'Use when writing code that programmatically invokes AI agents (Cursor SDK pattern). Triggers: "SDK", "agent.prompt", "программно вызвать агента".',
	`# sdk — Программный запуск AI-агентов

Паттерны для использования \`@cursor/sdk\` или аналогичных SDK для запуска агентов из кода.

## 3 паттерна вызова

### One-shot (fire-and-forget)
\`\`\`ts
const result = await Agent.prompt({
  text: 'Fix lint errors in src/',
  cloud: { repos: ['org/repo'] },
});
console.log(result.status, result.outcome);
\`\`\`

### Multi-turn streaming
\`\`\`ts
const agent = await Agent.create({ cloud: { repos: [...] } });
try {
  for await (const chunk of agent.send('First question')) {
    process.stdout.write(chunk.text);
  }
  for await (const chunk of agent.send('Follow-up')) { /* ... */ }
} finally {
  await agent[Symbol.asyncDispose]();
}
\`\`\`

### Resume existing
\`\`\`ts
const agent = await Agent.resume({ id: 'agent_xyz' });
const run = await agent.send('Continue from before');
await run.wait();
\`\`\`

## Топ-5 ловушек
1. **Нет \`cloud.repos\`** → тихо падает в local-mode без доступа к репо
2. **\`CursorAgentError\` (startup) ≠ \`result.status='error'\` (run)** — два разных типа ошибок, проверять оба
3. **Забытый \`await agent[Symbol.asyncDispose]()\`** → утечки соединений
4. **Пропуск \`run.wait()\`** → нет результата (промис не разрешён)
5. **Не все Run-операции доступны на всех runtime** — проверить документацию

## Принципы
- Всегда try/finally с dispose
- Логировать agent.id для traceability
- Timeouts на send() (default может быть бесконечный)
- Не блокировать main thread на длинных операциях`,
);

const SKILL_SPLIT_TO_PRS = builtin(
	'split-to-prs',
	'Use to split large local changes into small reviewable PRs. Triggers: "разбей на PR", "split into PRs", /split-to-prs.',
	`# split-to-prs — Разбивка изменений на маленькие PR

Большой diff → серия маленьких reviewable PR.

## Правила
- НЕ создавать ветки до одобрения плана пользователем
- Никаких деструктивных git-команд без явного согласия:
  - \`git reset --hard\`
  - \`git branch -D\`
  - \`git push --force\`
- Stage **named files/hunks** (\`git add -p\`), не \`git add -A\`

## Workflow
1. **Анализ diff**: \`git diff main\` → cгруппировать по темам
2. **Предложить план**:
   \`\`\`
   PR 1: Refactor auth module (12 файлов, ~200 строк)
   PR 2: Add OAuth provider (5 файлов, ~150 строк) — зависит от PR 1
   PR 3: Update tests (8 файлов, ~80 строк)
   \`\`\`
3. **Подтверждение**: юзер согласен с разбивкой?
4. **Для каждого PR**:
   - \`git checkout -b feature/<name>\`
   - \`git add -p\` → stage только нужные hunks
   - \`git commit -m "..."\`
   - \`git push -u origin feature/<name>\`
   - Создать PR с описанием
5. **Сохранить остальное**: оставшиеся изменения в working tree для следующего PR

## Размер
- Идеал: < 200 строк изменений
- Максимум: 400 строк
- Если больше — ещё дробить

## Зависимости между PR
- Линейные (PR2 после PR1) — указать в описании "Depends on #N"
- Параллельные (независимые) — можно открыть одновременно`,
);

const SKILL_STATUSLINE = builtin(
	'statusline',
	'Use to configure CLI status line shown above prompt. Triggers: "настрой statusline", "status line config".',
	`# statusline — Конфигурация CLI Status Line

Строка статуса над промптом CLI — показывает контекст (git branch, model, tokens).

## Конфиг
\`~/.cursor/cli-config.json\` (Cursor) или \`~/.vibecoder/cli-config.json\`:
\`\`\`json
{
  "statusLine": {
    "type": "command",
    "command": "vibecoder-statusline-helper",
    "padding": 0,
    "refreshInterval": 2000
  }
}
\`\`\`

## Полезные элементы
- Git branch + dirty indicator: \`$(git rev-parse --abbrev-ref HEAD)\`
- Текущая модель: \`$(cat ~/.vibecoder/current-model)\`
- Token usage: \`$(vibecoder-tokens-today)\`
- Workspace name
- Время последнего автосейва

## Принципы
- Быстро (< 200ms на refresh)
- Информативно но не перегружено (< 80 символов)
- Цвета через ANSI escape codes
- Цвета должны контрастировать с фоном терминала
- НЕ показывать секреты/токены в statusline

## Шаблон команды
\`\`\`bash
#!/bin/bash
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "-")
model="claude-opus-4.7"
echo -e "\\033[36m$branch\\033[0m | \\033[33m$model\\033[0m"
\`\`\``,
);

const SKILL_UPDATE_SETTINGS = builtin(
	'update-settings',
	'Use to safely modify user settings.json. Triggers: "поменяй settings", "update settings.json", /update-cursor-settings.',
	`# update-settings — Безопасная правка settings.json

## Местоположения
| OS | Путь |
|----|------|
| Windows | \`%APPDATA%\\\\Code\\\\User\\\\settings.json\` (VSCode) или \`%APPDATA%\\\\Cursor\\\\User\\\\settings.json\` (Cursor) |
| macOS | \`~/Library/Application Support/Code/User/settings.json\` |
| Linux | \`~/.config/Code/User/settings.json\` |
| Vibecoder | \`%APPDATA%\\\\code-oss-dev\\\\User\\\\settings.json\` (форк OSS) |

## Workflow
1. **Найти файл** для текущей OS
2. **Прочитать существующий JSON** (если есть)
3. **Распарсить** с учётом trailing commas и комментариев (JSON5/JSONC)
4. **Изменить** только нужные ключи (НЕ перезаписывать весь файл)
5. **Сохранить** с тем же форматированием (отступы, переносы)

## Правила
- НЕ удалять чужие настройки которые не касаются задачи
- Сохранять JSON-comments (если файл их использует)
- Сохранять trailing commas если есть
- Indent: 4 spaces (по умолчанию VSCode)
- НЕ ломать структуру если файл невалидный — спросить юзера

## Опасные ключи
- \`workbench.colorTheme\` — может сломать UI если темы нет
- \`files.exclude\` — может скрыть нужные файлы
- \`terminal.integrated.defaultProfile\` — может сломать терминал
- \`extensions.autoCheckUpdates\` — security implications

## Откат
Перед правкой — сделать backup:
\`\`\`bash
cp settings.json settings.json.bak.$(date +%s)
\`\`\``,
);

/**
 * Все 9 Cursor-style скиллов. Импортируются в builtinSkills.ts и
 * добавляются в общий BUILTIN_SKILLS массив.
 */
export const CURSOR_SKILLS: readonly VibecoderSkill[] = [
	SKILL_BABYSIT,
	SKILL_CANVAS,
	SKILL_CREATE_HOOK,
	SKILL_CREATE_RULE,
	SKILL_CREATE_SKILL,
	SKILL_SDK,
	SKILL_SPLIT_TO_PRS,
	SKILL_STATUSLINE,
	SKILL_UPDATE_SETTINGS,
];
