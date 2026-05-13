/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Built-in skills для Vibecoder/NIT.
 *
 * 22 встроенных скилла, портированных из Cursor agent skills (2026-05-06).
 * Доступны сразу после установки без копирования в workspace.
 * Workspace .vibecoder/skills/ перекрывает встроенные при совпадении имени.
 *
 * Использование в коде:
 *   import { BUILTIN_SKILLS } from './builtinSkills.js';
 *   for (const skill of BUILTIN_SKILLS) { skillsMap.set(skill.id, skill); }
 */

import { URI } from '../../../../../base/common/uri.js';
import { VibecoderSkill } from './skillsService.js';

/**
 * Хелпер для создания built-in скилла. rootUri — фейковый URI с кастомной схемой
 * (vibecoder-builtin), которая никуда не резолвится, но уникальна на каждый skill.
 */
function builtin(name: string, description: string, body: string): VibecoderSkill {
	return {
		id: name,
		rootUri: URI.parse(`vibecoder-builtin:/skills/${name}`),
		metadata: { name, description, version: '1.0.0', source: 'builtin' },
		body: body.trim(),
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// 22 встроенных скилла
// ─────────────────────────────────────────────────────────────────────────────

const SKILL_CHAINLOGIC = builtin(
	'chainlogic',
	'Use when planning complex tasks with 5+ steps, exploring optimal action paths, or comparing strategies. Triggers: /chainlogic, /chain, "составь план", "найди оптимальный путь".',
	`# /chainlogic — Гроссмейстер цепочек действий

Разрабатывает оптимальные стратегии через HTN-декомпозицию, Tree-of-Thoughts, A*-эвристику.

## Уровни детализации
- **CHAIN-LITE**: ≤5 шагов, 1 файл → 2 цепочки
- **CHAIN-STANDARD**: 5–15 шагов → DAG + 3 цепочки
- **CHAIN-DEEP**: 15+ шагов, высокая цена ошибки → все 6 фаз

## Подрежимы
- /chainlogic plan — только план
- /chainlogic execute — план + исполнение
- /chainlogic compare — сравнить стратегии
- /chainlogic recover — задача застряла

## Алгоритм (6 фаз)
1. **Library Lookup** — поиск готового решения в проекте/докуменации
2. **Декомпозиция (HTN)** — дерево до атомарных действий
3. **Граф зависимостей (DAG)** — критический путь, параллельные блоки
4. **Альтернативные цепочки (ToT)** — минимум 2–3 варианта
5. **Оценка (A\\*)** — cost / risk / reversibility / side-effects / info-value
6. **Исполнение (ReAct+Reflexion)** — Reason→Act→Observe→Reflect

## Формат вывода
\`\`\`
ПЛАН: <название>
ЦЕЛЬ: <критерий победы>

DAG:
  [1] task A → [2] task B
  [1] task A → [3] task C
  [2,3] → [4] финал

ЦЕПОЧКИ:
  A: 1→2→3→4 (cost: low, risk: low, time: 30m) ⭐ recommended
  B: 1→3→2→4 (cost: low, risk: med, time: 25m)
  C: радикальная альтернатива
\`\`\``,
);

const SKILL_COMMIT = builtin(
	'commit',
	'Use when user asks to commit changes to git. Triggers: "закоммить", "сделай коммит", /commit. Inspects diff, writes concise Russian commit message, never pushes without explicit permission.',
	`# /commit — Автоматические git-коммиты

## Workflow
1. \`git status\` + \`git diff HEAD\` + \`git log --oneline -5\` — узнать что меняется
2. Составить краткое сообщение на русском (≤ 72 символа в первой строке)
3. Если несколько логических изменений — разбить на отдельные коммиты
4. \`git add <конкретные файлы>\` (не \`-A\` без согласия)
5. \`git commit -m "..."\`

## Формат сообщения
Первая строка ≤72 символа, императив, на русском:
- "Добавлен provider для Polza.ai"
- "Фикс CSP для LM Studio через http://localhost:*"
- "Рефакторинг: вынесен парсер frontmatter в отдельную функцию"

Если нужно объяснить почему — пустая строка + body на русском, абзацы по 100 символов.

## Запреты
- НЕ коммитить .env, credentials, ключи
- НЕ использовать --amend без явной просьбы
- НЕ делать push без явной просьбы
- НЕ \`git reset --hard\` без подтверждения
- НЕ закрывать ветку через \`git branch -D\`

## После коммита
Показать \`git log --oneline -1\` чтобы юзер видел что попало в commit.`,
);

const SKILL_FIX = builtin(
	'fix',
	'Use when user asks to fix errors, lint warnings, compile errors, or test failures. Triggers: /fix, "исправь ошибки", "почини код". Auto-fixes simple issues, explains options for complex ones.',
	`# /fix — Автоматическое исправление ошибок

## Классификация
| Тип | Действие |
|-----|----------|
| Простые | Авто-фикс: форматирование, неиспользуемые imports, опечатки |
| Средние | Исправить + показать дифф: типы, параметры, signature mismatch |
| Сложные | Объяснить + дать 2-3 варианта: архитектура, логика, refactor |

## Workflow
1. Запустить linter / tsc / тесты → собрать список ошибок
2. Сгруппировать по типу и файлу
3. Простые — править последовательно, после каждого блока перепроверять
4. Средние — править с пояснением "почему именно так"
5. Сложные — НЕ править молча, объяснить и спросить какой вариант

## Не делать
- НЕ подавлять ошибки (\`// @ts-ignore\`, \`any\`, пустой catch)
- НЕ удалять тесты чтобы скрыть проблему
- НЕ менять баг-репорт на "и так сойдёт"

## Финальная проверка
После всех фиксов — перепустить полный набор проверок и показать что счётчик ошибок упал до 0 (или объяснить почему оставшиеся не могут быть исправлены автоматически).`,
);

const SKILL_GOD = builtin(
	'god',
	'Use for deep debugging of complex bugs requiring full system trace, infinite loop detection, state mutation analysis. Triggers: /god, "найди глубокий баг", "трассировка потока".',
	`# /god — Системный отладчик

Глубокий дебаг через Bird's Eye View, трассировку потоков, охоту на зацикливания.

## Протокол (строго по порядку)

### 1. Bird's Eye View
- Карта проекта: где главные модули
- Потоки данных: вход → обработка → выход
- Внешние границы: API, БД, файлы, env

### 2. Трассировка потоков
- От источника данных до точки сбоя
- Помечать подозрительные места \`[SUSPECT]\`
- Если есть лог/stacktrace — соотнести строки кода

### 3. Охота на зацикливания
- while без условия выхода / с мутирующим извне флагом
- Рекурсия без базы (или с базой которая никогда не достигается)
- Circular dependencies (A → B → A)
- Бесконечный re-render (React: setState в эффекте без deps)

### 4. Анализ состояния
- Implicit mutations (\`array.push\` в \`map\` callback)
- Async races (await после setState, незакрытые AbortControllers)
- Cleanup (removeEventListener, clearInterval, unsubscribe)

### 5. Радикальный диагноз
- **Корневая причина** (одно предложение)
- **Цепочка событий** (1→2→3→баг)
- **Риски при правке** (что ещё может сломаться)

## Аудит агента (meta)
Карта покрытия: ПРОВЕРЕНО ✅ / НЕ ПРОВЕРЕНО ❌ / ПРОПУСКАЛ 🔁
При зацикливании > 3 итераций — объявить и сменить стратегию.`,
);

const SKILL_DIAMOND_BUDHA = builtin(
	'diamond-buddha',
	'Use for total code cleanup: dead code, magic numbers, copy-paste duplication, TODO/FIXME, circular dependencies, god objects. Triggers: /diamond_budha, "очисти код от невежества". Scans project, applies 5 cleanup layers.',
	`# /diamond_budha — Тотальная очистка кода

Сканирует проект, находит 5 типов загрязнений (клеш), послойно очищает.

## 5 Клеш Кода
| Клеша | Проявление |
|-------|-----------|
| 🌫️ Авидья (Неведение) | Неясные имена, magic numbers, отсутствие типов |
| ⛓️ Упадана (Привязанность) | Мёртвый код, unused imports, over-engineering |
| 🔄 Санскара (Обусловленность) | Copy-paste, дублирование, устаревшие паттерны |
| 🔥 Двеша (Отвращение) | TODO/FIXME/HACK, подавленные ошибки, any |
| 🕸️ Моха (Запутанность) | Circular deps, tight coupling, god objects |

## 5 Слоёв очистки
1. **Поверхностная** — мёртвые импорты, console.log, .bak файлы
2. **Ясность имён** — magic numbers → константы, any → реальные типы
3. **Простота структуры** — функции >50 строк, файлы >300 строк
4. **Освобождение** — circular deps, сложные интерфейсы
5. **Архитектурная гармония** — god objects, уровни абстракции

## Подрежимы
- /diamond_budha light — только слои 1–2 (безопасно)
- /diamond_budha deep — все 5 слоёв
- /diamond_budha scan — только диагностика
- /diamond_budha file <путь> — точечная чистка

## Принципы
- Каждый слой проверяется тестами/билдом перед переходом к следующему
- При сомнении — оставлять
- Удалять только то что точно мёртвое (нет ссылок в \`grep -r\`)`,
);

const SKILL_OM = builtin(
	'om',
	'Use for deep problem solving on complex architectural tasks. Triggers: /om, /om debug, /om arch, /om perf. Runs parallel investigation, 5-whys analysis, minimum 3 solutions with trade-offs.',
	`# /om — Режим глубокого решения проблем

Исследует ВСЕ возможные решения параллельно, 5 почему, минимум 3 варианта.

## Обязательные действия
1. **Параллельное исследование** — 2–4 задачи одновременно (read+grep+context)
2. **Метод 5 почему** — от симптома до корневой причины
3. **Минимум 3 решения** — таблица cost/risk/побочки/рекомендация

## Специальные режимы
- /om debug — стектрейс + все async пути + null safety
- /om arch — SOLID, circular deps, coupling/cohesion
- /om perf — hot paths, O(n²), кэширование, утечки памяти

## Формат ответа
\`\`\`
КОРНЕВАЯ ПРИЧИНА:
  Симптом: ...
  Почему 1: ...
  Почему 2: ...
  ...
  Почему 5: <корневая>

РЕШЕНИЯ:
  A: <описание>      cost=low   risk=low   side=none      ⭐
  B: <описание>      cost=high  risk=med   side=API change
  C: <radical>       cost=high  risk=high  side=many      💡 если A/B не подходят

РЕКОМЕНДАЦИЯ: A, если только не нужна <feature> — тогда B.
\`\`\``,
);

const SKILL_OMNISSIAH = builtin(
	'omnissiah',
	'Use for maximum architectural/perf/security/legacy audit. Triggers: /omnissiah, /omnissiah arch/perf/security/legacy/migration/rescue. Heavy multi-agent investigation with risk matrix.',
	`# /omnissiah — Максимальный аудит

Предельно глубокий аудит. Триаж по симптомам:

| Симптом | Подрежим |
|---------|----------|
| "упал", "crash" | root-cause |
| "медленно" | perf |
| "не масштабируется" | scale |
| "гонка", "иногда" | concurrency |
| "безопасность", "утечка" | security |
| "архитектура" | arch |
| "интеграция", "API" | integration |
| "инцидент на проде" | incident |
| "миграция" | migration |
| "старый код", "страшно трогать" | legacy |
| "нет тестов" | test-gap |
| "спасите проект" | rescue |

## Алгоритм
1. 2–4 параллельных задачи + read lints + grep(TODO/FIXME)
2. Карта системы (ядро, границы, интеграции)
3. 5 Почему для каждой Critical-находки
4. **Risk Matrix**: Severity × Likelihood × Impact / Repair Cost = ROI
5. Приоритизированный план операций

## Формат вывода
\`\`\`
КАРТА:
  Ядро: <files>
  Границы: <APIs/DBs>
  Интеграции: <external>

НАХОДКИ (приоритет):
  🔴 P0: <critical> — Repair: 2h, ROI: high
  🟠 P1: <high>     — Repair: 4h, ROI: med
  🟡 P2: <med>      — Repair: 1d,  ROI: low

ПЛАН ОПЕРАЦИЙ: 1→2→3
\`\`\``,
);

const SKILL_MAHAKALA = builtin(
	'mahakala',
	'Use before making changes that could break things. Triggers: /mahakala, "защити код от поломок". Pre-flight risk analysis, blocks dangerous edits, runs tsc/lint/tests before AND after.',
	`# /mahakala — Гневный защитник кода

Превентивный анализ правок ПЕРЕД внесением. Если правка ломает — блокирует.

## Алгоритм (4 фазы)
1. **Базовый снимок**: tsc / lint / тесты / build ДО правки
2. **Карта влияния**: кто импортирует, кто использует тип, какие тесты затронут
3. **Оценка риска**: 🟢 / 🟡 / 🔴 / ⚫
4. **Постпроверка**: tsc + lint + тесты должны быть ≥ базового снимка

## Уровни риска
| Уровень | Критерии | Действие |
|---------|----------|----------|
| 🟢 НИЗКИЙ | Изолировано, 1 файл, нет зависимых | Правка + быстрая проверка |
| 🟡 СРЕДНИЙ | 1–3 зависимых файла | Правка + проверка всех затронутых |
| 🔴 ВЫСОКИЙ | 4+ зависимых / публичный API / migrations | Пошаговая правка, между шагами тесты |
| ⚫ КРИТИЧЕСКИЙ | Ядро системы, БД, auth, payments | План + одобрение → потом действие |

## Стоп-сигналы
- tests меньше после правки → откат
- tsc errors появились → откат
- build не собирается → откат

## После
Кратко: "✅ Применено N правок, базовая линия не нарушена (X тестов прошло, 0 errors)"`,
);

const SKILL_MVP = builtin(
	'mvp',
	'Use when building MVP/working prototype. Triggers: /mvp, "сделай MVP", "рабочий прототип". Forbids // TODO, mock data, Alert("coming soon"). Real integrations only.',
	`# /mvp — Кодекс Омниссии

Только реально работающий код. Никаких заглушек.

## Священные принципы
1. **Ноль симуляций**
   - Запрещены \`// TODO\`, \`return mockData\`, \`Alert.alert('Coming soon')\`
   - Если не можешь реализовать — НЕ маскируй
   - Лучше: сказать "эта фича отложена" чем заглушка

2. **Реальные интеграции**
   - localStorage / AsyncStorage / Zustand+persist — не in-memory
   - Реальный fetch к API — не \`new Promise(resolve => resolve(mock))\`
   - Реальная БД (Supabase / SQLite) — не объект в памяти

3. **MVP ≠ Плохой код**
   - TypeScript strict
   - Обработка ошибок (try/catch с реальным fallback)
   - Если фреймворк требует — соблюдать паттерн (NativeWind вместо StyleSheet)

## Когда нельзя сделать
Чётко сказать "Это требует <X>, который не настроен. Я могу:
  A) Настроить <X> сейчас (займёт ~Y минут)
  B) Имплементировать без этой фичи (она будет недоступна в MVP)
  C) Поставить интерфейс с throw new NotImplementedError() — но это явная пустышка"

Дать выбор юзеру, не делать молча заглушку.`,
);

const SKILL_OPTIMIZE = builtin(
	'optimize',
	'Use for performance optimization. Triggers: /optimize, /optimize speed/memory/render/bundle/tokens, "ускори", "уменьши потребление".',
	`# /optimize — Оптимизация производительности

## Режимы
- /optimize speed — алгоритмы O(n²)+ → O(n log n), big-O анализ
- /optimize memory — утечки (event listeners, refs), генераторы, weak refs
- /optimize render — React.memo, useMemo, FlatList vs map, virtualization
- /optimize bundle — tree-shaking, code splitting, lazy imports, named imports
- /optimize tokens — промпты LLM, батчинг, кэш ответов

## Workflow
1. Профилировать до правки — что именно медленно
2. Найти горячую точку (top 1-3 функции, 80% времени)
3. Применить оптимизацию
4. Замерить после
5. Сравнить: было X → стало Y, прирост Z%

## Не делать
- Premature optimization — оптимизировать без замеров
- Тропосчёт ради единичных %
- Делать менее читаемым ради 5% прироста

## Замеры
- Speed: \`console.time/timeEnd\` или \`performance.mark/measure\`
- Memory: Chrome DevTools heap snapshot diff
- Bundle: webpack-bundle-analyzer / source-map-explorer
- Render: React DevTools Profiler`,
);

const SKILL_SERVITOR = builtin(
	'servitor',
	'Use to clean dead code/files/imports. Triggers: /servitor, "почисти от мусора", "найди мёртвые файлы". Three modes: scan (report), sweep (move to trash), burn (delete).',
	`# /servitor — Робот-пылесос кодовой базы

## Режимы утилизации
- 🧹 **sweep** — переместить в \`.servitor-trash/\` (откатываемо)
- 🔥 **burn** — безвозвратное удаление (требует явного "да")
- 📋 **scan** — только отчёт без действий

## Классификация мусора
- 🟢 **Безопасный** (auto sweep):
  - Пустые файлы (0 байт)
  - \`*.bak\`, \`*.tmp\`, \`*.old\`
  - \`console.log\` debug-statements
  - Неиспользуемые imports (нет ссылок через grep)

- 🟡 **Средний риск** (требует подтверждения):
  - Файлы-сироты (никто не импортирует)
  - Экспортированные функции без ссылок
  - TODO/FIXME старше 3 месяцев

- 🔴 **Высокий риск** (только report, не trogать):
  - Файлы старше 1 года (могут быть legacy интеграции)
  - Утилитарные/конфиги (могут читаться runtime)
  - Файлы с dynamic require/import

## Алгоритм
1. Построить карту: импорты, экспорты, ссылки
2. Найти "островки" — файлы без входящих ссылок
3. Сверить с \`.gitignore\`, \`tsconfig.exclude\` — иногда они исключают live-код
4. Классифицировать
5. Действовать по уровню риска`,
);

const SKILL_TEST = builtin(
	'test',
	'Use when user asks to write tests. Triggers: /test, "напиши тесты", "покрой тестами". Uses AAA pattern, naming convention test_should_X_when_Y.',
	`# /test — Генератор тестов

## Стек (выбирается по проекту)
| Слой | Фреймворк |
|------|-----------|
| Node / Python / Go | pytest / jest / go test |
| React / Vue | @testing-library + Jest/Vitest |
| E2E web | Playwright |
| E2E mobile | Maestro / Detox |

## Паттерн AAA
\`\`\`ts
test('should ... when ...', () => {
  // ARRANGE — подготовка данных, моков
  const input = ...;
  const mockApi = jest.fn().mockResolvedValue(...);

  // ACT — вызов
  const result = await target(input);

  // ASSERT — проверка
  expect(result).toEqual(...);
  expect(mockApi).toHaveBeenCalledWith(...);
});
\`\`\`

## Naming
\`test_should_<expected>_when_<condition>\`
- \`should_throw_AuthError_when_token_expired\`
- \`should_return_empty_array_when_no_matches\`
- \`should_call_api_with_retry_when_first_attempt_fails\`

## Покрытие
- Happy path (валидные входы)
- Edge cases (пустые, граничные, null/undefined)
- Errors (бросаемые, async rejections, network failures)
- Side effects (DOM, storage, network, console)

## Не делать
- Тестировать реализацию (внутренние методы) — только публичный интерфейс
- Снапшоты без понимания (legacy snapshots ломаются на ровном месте)
- Бесконечные мокабельные слои — мокать только границы (API/DB/FS)`,
);

const SKILL_REVIEW_PR = builtin(
	'review-pr',
	'Use for code review of PR/diff. Triggers: /review-pr, "проверь код", "сделай ревью". Categorizes findings as CRITICAL/WARNING/SUGGESTION/NOTE.',
	`# /review-pr — Code Review

## Категории находок
- 🔴 **CRITICAL** — баги, security, data loss, breaking API change
- 🟡 **WARNING** — потенциальный баг, performance, неудачный паттерн
- 🟢 **SUGGESTION** — стиль, naming, рефакторинг для читаемости
- 💡 **NOTE** — мелкие замечания, не блокеры

## Чеклист
### Баги
- Edge cases (пусто, null, отрицательные, большие)
- Race conditions (async/await, parallel ops)
- Обработка ошибок (try/catch на сетевых вызовах)
- Ресурсы (closed connections, freed memory, unsubscribed)

### Безопасность
- Нет хардкода секретов
- Input validation (SQL injection, XSS, path traversal)
- Логи не содержат токены/пароли
- Auth checks на чувствительных endpoint'ах

### Производительность
- O(n²)+ алгоритмы в hot paths
- N+1 queries
- Утечки памяти (event listeners, refs)
- FlatList/virtualization для длинных списков

### Стиль
- Понятные имена (не \`tmp\`, \`x\`, \`data\` без контекста)
- Функции < 40 строк (длиннее — разбить)
- Нет дублирования (DRY)
- Нет magic numbers (использовать константы)

## Формат вывода
\`\`\`
🔴 CRITICAL: <file:line>
  Проблема: ...
  Риск: ...
  Фикс: ...

🟡 WARNING: <file:line>
  ...
\`\`\``,
);

const SKILL_UI_TESTER = builtin(
	'ui-tester',
	'Use to verify UI handlers actually work (not console.log/empty/Alert). Triggers: /ui-tester, "проверь что UI работает", "все кнопки функциональны". Bidirectional check: dead logic and dead UI.',
	`# /ui-tester — Инквизитор интерфейсов

## Что сканируется
- Buttons / Pressable / TouchableOpacity → \`onPress/onClick\`
- Switch / Checkbox / Radio → \`onValueChange/onChange\`
- TextInput / Input → \`onChangeText/onInput\`, \`onSubmit\`
- FlatList / ScrollView → \`onRefresh\`, \`onEndReached\`
- Links / router.push → корректность маршрута

## Классификация обработчиков
- ❌ **Мёртвые**:
  - \`onPress={() => {}}\`
  - \`onPress={() => console.log('TODO')}\`
  - \`Alert.alert('Coming soon')\`
- ⚠️ **Подозрительные**:
  - Несуществующий маршрут в \`router.push\`
  - Store action который ничего не меняет
  - Mutation без cleanup
- ✅ **Рабочие**:
  - Реальная навигация
  - Real state mutation с persist
  - API call с обработкой результата

## Двунаправленная проверка (КРИТИЧНО)
- **Случай A**: функция есть — UI нет (мёртвая логика)
- **Случай B**: UI есть — функции нет (мёртвый UI)
- **Случай C**: парная асимметрия (addItem есть, removeItem нет в UI)

## Финальный отчёт
\`\`\`
❌ Мёртвых обработчиков: N
  - app/screens/X.tsx:42 onPress={...}
⚠️ Подозрительных: M
  - ...
✅ Рабочих: K (всего)

Парные асимметрии:
  - useStore.addTodo есть, кнопки "Добавить" нет
  - кнопка "Удалить" есть, useStore.removeTodo нет
\`\`\``,
);

const SKILL_IMPEROR = builtin(
	'imperor',
	'Use when task must be done at all costs and previous attempts failed. Triggers: /imperor, /emperor, "сделай любой ценой". Cycles through approaches, escalates only at critical forks.',
	`# /imperor — Приказ Императора

Неостановимый исполнитель: перебирает все подходы, эскалирует только критические решения.

## Протокол (5 фаз)
1. **Accipe Mandatum** — зафиксировать: цель, ограничения, критерий победы
2. **Exploratores** — разведка: внутренний поиск + web search если есть
3. **Consilium** — Путь A (основной) + Путь B (запасной) + Путь C (крайний)
4. **Impetus** — штурм: адаптируйся к препятствиям, укрепляйся на успехе
5. **Relatio** — эскалация Императору только на критических развилках

## Железные законы
1. **Приказ превыше комфорта** — перебрать 20 подходов если надо
2. **Разведка — мудрость, не трусость** — изучить перед действием
3. **Три поиска до сдачи** — разные формулировки, разные источники
4. **Не врать о результатах** — если не получилось → сказать ЧТО именно не вышло

## Критерии эскалации (когда спрашивать)
- Изменение архитектуры > 5 файлов
- Удаление функциональности
- Стоимость > 4 часов работы
- Безопасность / privacy impact
- Migration с потерей данных

## Критерии действия (когда НЕ спрашивать)
- Исправление синтаксиса
- Замена устаревшего API
- Очевидный refactor для читаемости
- Добавление тестов

## Финал
"ВЫПОЛНЕНО: <что сделано>" или "БЛОКЕР: <конкретная преграда> + что попробовано"`,
);

const SKILL_SHERLOK = builtin(
	'sherlok',
	'Use to verify what was actually done vs claimed in previous sessions. Triggers: /sherlok, /sherlock, "проверь что было сделано". Cross-references git/Read/Grep with prior claims.',
	`# /sherlok — Детектив прошлых сессий

Читает транскрипты, сверяет заявленное с реальным состоянием кода.

## Протокол (5 актов)
1. **Discovery** — собрать что заявлено: последние коммиты, файлы, фичи
2. **Cross-Examination** — каждое заявление сверить с git / grep / read
3. **Hypothesis**:
   - Версия A — официальная (всё как сказано)
   - Версия B — халатность (заявлено но не сделано)
   - Версия C — галлюцинация (никогда не существовало)
4. **Reconstruction** — реальный ход событий
5. **Verdict**:
   - ✅ Чисто — всё подтверждено
   - 🟡 С пропусками — основное сделано, мелочи забыли
   - ❌ С ложными заявлениями — конкретные пункты не существуют

## Чему верить
- Только **tool-output** (read/grep/git), не нарративу
- Только **git-подтверждённым** изменениям
- Только **exit code 0** на тестах
- Только тому, что **Read/Grep возвращает прямо сейчас**

## Чему НЕ верить
- "Я сделал X" — без diff'а
- "Тесты прошли" — без output
- "Это работает" — без скриншота/лога
- Старым summary в чате

## Формат отчёта
\`\`\`
ЗАЯВЛЕНО:           СОСТОЯНИЕ:
1. Добавлен A.tsx   ✅ есть в git log + Read подтверждает
2. Тесты прошли     ❌ нет в git log, тест-файл не существует
3. CSS пофикшен     🟡 файл есть, но строка 42 содержит баг
\`\`\``,
);

const SKILL_SPARTA = builtin(
	'sparta',
	'Use to enforce strict plan adherence over long iterations. Triggers: /sparta, /phalanx, "держись плана", "не уходи в сторону". Phalanx Manifest + Lambda Stamps + Laconic reports.',
	`# /sparta — Спартанский режим удержания плана

Дисциплинированное исполнение через итерации с Phalanx Manifest и Lambda Stamps.

## 7 Законов Ликурга
1. **Один поход — один манифест** (фиксированный план в начале)
2. **Каждый шаг знает своё место** (нумерация, нет импровизации)
3. **Левый сосед священен** (новая итерация не ломает предыдущую)
4. **Лямбда после боя** (шаг без сверки = не завершён)
5. **Молон лабе** (отбивать соблазны импровизации)
6. **С щитом или на щите** (либо выполнено, либо честно признано провал)
7. **Лаконичная речь** (декларация → действие → подтверждение)

## Печати
| Печать | Значение |
|--------|----------|
| **Λ ✅** | Сверено с планом, подтверждено |
| **A ⚠** | Обоснованное отклонение от плана |
| **X ❌** | Нарушение строя, нужен откат |
| **? 🔍** | Требует расследования |

## Подрежимы
- /sparta plan — создать Phalanx Manifest (фиксированный план)
- /sparta hold — режим итераций со штампами
- /sparta audit — сверить текущее с манифестом
- /sparta thermopylae — абсолютная дисциплина (запрет на всё кроме плана)
- /sparta retreat — формальное отступление + перепланирование
- /sparta laconic — краткие отчёты (1 строка на шаг)

## Формат отчёта
\`\`\`
ШАГ 3/12: Добавить provider для Polza.ai
  Λ ✅ Файл polzaProvider.ts создан, тесты прошли
  Λ ✅ Зарегистрирован в llmRouter
  ? 🔍 endpoint URL под вопросом — нужна проверка

ОСТАЛОСЬ: 9 шагов
\`\`\``,
);

const SKILL_CONVENTIONS_SYNC = builtin(
	'conventions-sync',
	'Use when prompts/configs may have drifted from canonical conventions. Triggers: /conventions-sync. Audits color palettes, component APIs, ban lists across files.',
	`# /conventions-sync — Аудит согласованности конвенций

Проверяет что палитра/типы/запреты согласованы между всеми файлами конвенций.

## 3 зоны синхронизации
1. **Цветовая палитра** — все hex-значения в одном источнике
2. **API компонентов** — один и тот же набор props между типами/реализацией/документацией
3. **Список запретов** — NEVER \`any\`, NEVER \`console.log\` в проде, и т.д.

## Алгоритм
1. Найти все файлы конвенций: conventions.md, .cursor/rules/*.mdc, .vibecoder/rules/, docs/conventions/
2. Извлечь упоминания из каждого: палитра / API / запреты
3. Построить таблицу: где упоминается → какое значение
4. Найти расхождения (один файл говорит #FFD700, другой #FFD800)
5. Предложить **canonical version**: обычно самый свежий или самый детальный
6. После согласия — обновить все источники до canonical

## Принципы
- **Single source of truth** — одна правда, остальное ссылается
- Перед правкой — спросить у юзера какая версия каноничная
- НЕ молча менять — каждое расхождение показывать с контекстом

## Формат вывода
\`\`\`
ЗОНА: Палитра
  background:
    conventions.md → #0A0A0A ⭐ свежее
    coder.md       → #000000
    legacy.md      → #111111

ЗОНА: Запреты
  any:
    enricher.md → NEVER
    coder.md    → допустимо в utils/legacy → ⚠ конфликт
\`\`\``,
);

const SKILL_PIPELINE = builtin(
	'pipeline',
	'Use when working with generation pipelines (agents/, stages/, postprocess/, prompts/). Triggers: /pipeline. Navigates spec→plan→generate→review→fix flow.',
	`# /pipeline — Навигатор по пайплайну генерации

## Архитектура
\`\`\`
spec → planner → schema (JSON)
schema → setup → generate (coder) → review
                       ↓
            postprocess → lint → fix cycle → build
\`\`\`

## Слои
| Слой | Папка | Ответственность |
|------|-------|-----------------|
| Agents | \`agents/\` | LLM-агенты: planner, coder, reviewer, fixer |
| Stages | \`stages/\` | Оркестрация стадий |
| Postprocess | \`postprocess/\` | Детерминированные правки (lint-style) |
| Pipeline core | \`pipeline_*.py\` | Координация, состояние, retry |
| LLM layer | \`llm_*.py\` | Клиент, retry, streaming, кэш |
| Prompts | \`prompts/\` | Markdown-промпты для каждого агента |

## Работа со слоями
- **Добавить новую стадию**: stages/ + регистрация в pipeline core
- **Изменить промпт агента**: prompts/<agent>.md (без правки кода)
- **Добавить детерминированное правило**: postprocess/ (НЕ через LLM)
- **Заменить модель**: llm_*.py — там единая точка конфигурации

## Принципы
- Detекминированные правки → postprocess, не LLM
- LLM → только там где нужна креативность/контекст
- Каждая стадия идемпотентна (повторный запуск даёт тот же результат)
- Стадии слабо связаны (можно тестировать изолированно)`,
);

const SKILL_2666 = builtin(
	'design-cyberpunk',
	'Use when user asks for cyberpunk/dystopian/glitch/HUD/neon-noir design. Triggers: /2666, "киберпанк", "глитч", "HUD", "неоновый нуар". Mostly for React Native + NativeWind.',
	`# /2666 — Cyberpunk Future Design System

Дизайн в стиле дистопии 2666 года. Главная среда — React Native + Expo + NativeWind.

## Палитра
| Токен | Hex |
|-------|-----|
| voidBlack | #000000 |
| acidCyan | #00FFE5 |
| hotMagenta | #FF006E |
| toxicLime | #C6FF00 |
| electricBlue | #0080FF |
| voltageYellow | #FFD600 |
| bloodRed | #FF0040 |

## Правила
- Фон — **абсолютно чёрный** (#000000)
- Один экран = **один** доминирующий неон
- Углы **острые** (rounded-none)
- Моноширный шрифт для HUD/данных (JetBrainsMono)
- Анимации: glitch, scanlines, pulse, typewriter
- Стили только через NativeWind, без StyleSheet.create

## Компоненты
- \`HudCard\` — карточка с угловыми скобками [ ⟨content⟩ ]
- \`CyberButton\` — primary / danger / ghost варианты
- \`StatusBadge\` — статус [OK] / [ERR] / [!]
- \`TerminalBlock\` — блок в стиле терминала
- \`GlitchText\` — мерцание с chromatic aberration
- \`ScanlineOverlay\` — движущаяся scanline полоска
- \`PulseGlow\` — пульсация свечения
- \`TypewriterText\` — терминальный вывод текста

## Антипаттерны
- Закруглённые углы > 4px
- Несколько неоновых акцентов на одном экране
- Sans-serif для цифр
- StyleSheet.create (только NativeWind)
- Светлый фон`,
);

const SKILL_NEON = builtin(
	'design-neon',
	'Use when user asks for luxury/premium futuristic design with gold accents. Triggers: /neon, "футуристичный", "премиальный", "золотой дизайн". RN + NativeWind.',
	`# /neon — Neon Wave Future Design

Люксовый дизайн: сакральная геометрия, квантовая эстетика, золотые акценты.

## Палитра
| Токен | Hex |
|-------|-----|
| voidBlack | #0A0A0A |
| goldPure | #FFD700 |
| goldWarm | #F4A836 |
| neonCyan | #00F5FF |
| neonMagenta | #FF00FF |
| neonEmerald | #00FF88 |

## Правила
- **Золото — главный акцент** (макс 2–3 элемента на экран)
- Анимации Reanimated: GlowCard, PulsingButton, FadeInDown
- Все стили через NativeWind
- Сакральная геометрия (круги, шестигранники, мандалы) — для декоративных элементов

## Компоненты
- \`GlowCard\` — карта с мягким золотым свечением по краю
- \`PulsingButton\` — кнопка с пульсацией золотого
- \`ShimmerText\` — текст с golden shimmer-эффектом
- \`SacredFrame\` — декоративная рамка с геометрией

## Антипаттерны
- Использовать золото на > 3 элементах (теряется ценность)
- Резкие неоновые цвета без золотого баланса
- Sans-serif для золотых надписей (использовать сериф/декоративный)
- Анимации без timing function (всегда easeInOut/spring)`,
);

const SKILL_PERPLEXITY_SEARCH = builtin(
	'web-search',
	'Use when user needs current information from the web. Triggers: /search, "поищи в интернете", "найди в сети". Calls Perplexity MCP if available, else web search tool.',
	`# /search — Поиск в интернете

## Когда использовать
- Свежая информация после cutoff даты модели
- Verification фактов (даты, версии, API изменения)
- Поиск решения проблемы (StackOverflow, GitHub issues, docs)

## Когда НЕ использовать
- Базовое знание (синтаксис языка, известные алгоритмы)
- Проектный контекст (читать файлы локально)
- Личная информация юзера

## Workflow
1. Сформулировать запрос как короткую фразу (3-6 слов)
2. Если нет результата — переформулировать (другие термины)
3. До 3 попыток с разными формулировками
4. Если ничего — честно сказать "не нашёл"

## Доступные инструменты
- Perplexity MCP: \`search\` (быстрый), \`reason\` (с рассуждением), \`deep_research\` (полное исследование)
- Web search tool в IDE (если есть)

## Цитирование
- Всегда указывать источник: домен или URL
- Не выдумывать факты — если не уверен, говорить "по информации <source>"
- Не доверять одному источнику — проверять 2-3 если важно`,
);

const SKILL_VIBECODER = builtin(
	'vibecoder',
	'Use when user asks about Vibecoder IDE itself: how to add providers, MCP servers, skills, configure NIT, install, troubleshoot LM Studio. Triggers: "vibecoder", "NIT", "как настроить".',
	`# vibecoder — Самопомощь по Vibecoder IDE

## Архитектура
- IDE = Vibecoder, AI-ассистент = NIT (Madhya/Срединный путь)
- Слева в Activity Bar: Settings panel (управление провайдерами/ключами/endpoints)
- Справа в AuxiliaryBar: NIT chat
- 6 LLM-провайдеров: LM Studio, Anthropic, OpenAI, Gemini, OpenRouter, Polza.ai

## Где что
| Что | Где |
|-----|-----|
| API-ключи | Settings panel слева → раздел Провайдеры → Set API Key |
| Endpoint LM Studio | Settings panel слева → раздел Эндпоинты |
| Skills (свои) | \`.vibecoder/skills/<name>/SKILL.md\` в workspace |
| Skills (built-in) | автоматически загружаются при старте |
| MCP-серверы | \`.vibecoder/mcp.json\` в workspace |
| Команды | Ctrl+Shift+P → "Vibecoder: ..." |

## Типичные проблемы
- **LM Studio offline**: запусти LM Studio → Developer → Start Server (порт 1234) → загрузи модель
- **Provider returns 401**: ключ неверный, Settings → Delete → Set заново
- **Polza.ai 404**: возможно endpoint не \`/api/v1\`, поменяй в Settings → Эндпоинты → Polza.ai

## Workflow: добавить новый провайдер
1. Создать класс в \`src/vs/workbench/contrib/vibecoder/browser/llm/<name>Provider.ts\`
2. extends OpenAICompatibleProvider если OpenAI-compatible
3. Зарегистрировать в \`llmRouter.ts\`
4. Добавить в \`common/vibecoder.ts\` VibecoderProviderId union
5. Добавить в селектор \`chat/vibecoderChatView.ts\`
6. Добавить в Settings UI \`settings/vibecoderSettingsView.ts\``,
);

// ─────────────────────────────────────────────────────────────────────────────
// Экспорт
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Все 22 встроенных скилла. Используются VibecoderSkillsService.reload()
 * для регистрации поверх workspace-скиллов (workspace перебивает встроенные
 * при совпадении id).
 */
export const BUILTIN_SKILLS: readonly VibecoderSkill[] = [
	SKILL_CHAINLOGIC,
	SKILL_COMMIT,
	SKILL_FIX,
	SKILL_GOD,
	SKILL_DIAMOND_BUDHA,
	SKILL_OM,
	SKILL_OMNISSIAH,
	SKILL_MAHAKALA,
	SKILL_MVP,
	SKILL_OPTIMIZE,
	SKILL_SERVITOR,
	SKILL_TEST,
	SKILL_REVIEW_PR,
	SKILL_UI_TESTER,
	SKILL_IMPEROR,
	SKILL_SHERLOK,
	SKILL_SPARTA,
	SKILL_CONVENTIONS_SYNC,
	SKILL_PIPELINE,
	SKILL_2666,
	SKILL_NEON,
	SKILL_PERPLEXITY_SEARCH,
	SKILL_VIBECODER,
];
