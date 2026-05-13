# Vibecoder Roadmap

> *"Минимально достаточный дизайн с точками роста. Решения по факту наблюдаемых
> данных, не по фантазиям о масштабировании."* — Кодекс NIT (Madhya)

Дорожная карта Vibecoder. Что есть, что в плане, что **сознательно** не делаем.

Базовый принцип — честность об ограничениях. Vibecoder разрабатывает один
человек (igor1000rr), Cursor — компания с $400M funding и 50+ инженерами.
До паритета по фичам пока далеко, и обещать обратное было бы ложью.
Но архитектура совместима с движением туда.

---

## Что работает СЕЙЧАС (v0.1.0 alpha)

### Ядро
- ✅ Форк VS Code OSS с собственным брендом и темой (Vibecoder Cyberpunk)
- ✅ NIT-сайдбар справа в AuxiliaryBar (Cursor-style)
- ✅ Streaming чат с 5 провайдерами:
  - LM Studio (локально, OpenAI-совместимый API)
  - Anthropic (Claude Opus/Sonnet/Haiku)
  - OpenAI (GPT-5, o3)
  - Google Gemini (2.5 Pro/Flash)
  - OpenRouter (агрегатор)
- ✅ Прокси-режим (`vibecoder.proxy.mode`) для пользователей из санкционных регионов
- ✅ API-ключи в системном keychain (никогда в settings.json или git)

### Composer (правки кода через AI)
- 🟡 MVP через "Apply Changes from Clipboard":
  1. Скопировал ответ LLM с search/replace блоками
  2. `Ctrl+Shift+P` → `Vibecoder: Apply Changes from Clipboard`
  3. Подтверждение → Apply / Preview / Cancel
- ❌ Apply-кнопки **прямо в чате** под сообщением — нет (только через clipboard)
- ❌ Diff editor side-by-side перед применением — нет (Preview только открывает файл)
- ❌ Per-block accept/reject — нет

### Skills (кастомные инструкции для NIT)
- ✅ Загрузка `.vibecoder/skills/<name>/SKILL.md` из workspace
- ✅ Формат совместим с Anthropic Skills (YAML frontmatter + markdown)
- ✅ Описания skills попадают в системный промпт NIT автоматически

### MCP (Model Context Protocol)
- 🟡 HTTP/SSE серверы — health check работает, но JSON-RPC handshake/tools/list не реализован
- ❌ stdio-серверы (требует канала к electron-main)

### Этика / прозрачность
- ✅ Манифест Срединного пути (`docs/MANIFESTO.md`)
- ✅ Открытый системный промпт NIT (`docs/NIT_SYSTEM_PROMPT.md`)
- ✅ Кодекс Madhya встроен в каждый ответ модели

---

## ПЛАНЫ — что реально сделать (1-4 недели каждое)

Сортировка по value/effort.

### 🔥 Приоритет 1 — то что отличает IDE от чата

#### 1.1. Apply кнопки прямо в чате
**Эффект**: огромный. Сейчас юзер копирует → вставляет → подтверждает.
С кнопкой — один клик после ответа модели.

**Что делать**: парсить ответ NIT в `NitChatView.sendCurrent()`, если есть
search/replace блоки — рендерить под сообщением кнопки "Apply this block"
и "Apply all". Логика применения уже есть в `composerService.ts`.

**Сложность**: низкая. 1-2 дня.

#### 1.2. Tab autocomplete (FIM — Fill In the Middle)
**Эффект**: главная "вау"-фича Cursor. Без неё мы — улучшенный чат, не IDE.

**Что делать**:
- Реализовать `ILanguageFeaturesService.inlineCompletionsProvider.register`
  (сейчас в `autocompleteService.ts` заглушка)
- Использовать FIM-формат LM Studio: `<|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>`
- Дебаунс 200-500ms, отмена при печатании
- Маленькая модель (Qwen 2.5 Coder 1.5B/3B) — быстрая, локальная

**Сложность**: средняя. 3-5 дней. Главная сложность — performance: модель
должна отвечать <1сек чтобы юзер не зацикливался.

#### 1.3. Cmd+K inline edit
**Эффект**: вторая главная фича Cursor. Выделил код → Cmd+K → "сделай Х" →
diff inline → принять/отклонить.

**Что делать**:
- Хоткей `Cmd+K` / `Ctrl+K` на выделение в редакторе
- Inline-popup с input полем
- Отправка в LLM с контекстом: выделение + соседние строки + язык файла
- Применение через `editor.executeEdits()` с inline-diff декорациями
- Кнопки Accept/Reject в декорации

**Сложность**: средняя-высокая. 4-7 дней. Требует работы с monaco-editor API
(декорации, view zones).

### 🟡 Приоритет 2 — улучшения UX

#### 2.1. @-mentions файлов в input NIT
**Эффект**: можно указать конкретный файл для контекста, не копировать его руками.

**Что делать**:
- Автокомплит по `@` в textarea → список файлов workspace
- При выборе — содержимое файла включается в `workspaceContext` для LLM

**Сложность**: средняя. 2-3 дня.

#### 2.2. Auto-include открытого файла
**Эффект**: NIT всегда знает что у юзера на экране без явных команд.

**Что делать**: в `sendCurrent()` добавлять текущий активный файл в `workspaceContext`.

**Сложность**: низкая. Полдня.

#### 2.3. Diff editor перед apply
**Эффект**: безопаснее применять — видно ДО.

**Что делать**: открывать `vscode.diff` команду с предпросмотром в `composerCommands.ts`.

**Сложность**: средняя. 1-2 дня.

#### 2.4. Сохранение истории чатов между сессиями
**Эффект**: NIT помнит о чём говорили вчера.

**Что делать**: SQLite-хранилище через `IStorageService` + UI списка прошлых чатов.

**Сложность**: средняя. 3-5 дней.

### 🟢 Приоритет 3 — полировка

- Кастомные иконки Activity Bar (свои киберпанковые SVG вместо codicon)
- Splash screen с лого Vibecoder при запуске
- Убрать сломанные extensions (open-remote-wsl, voideditor.open-remote-ssh)
- Команда `Vibecoder: Setup Wizard` с пошаговой настройкой LM Studio
- README, SETUP, contributing docs

---

## НЕ ДЕЛАЕМ (или делаем позже когда найдётся время/команда)

### Codebase indexing (`@codebase`, Cmd+Enter в Cursor)
**Почему нет**: требует embedding-сервиса (nomic-embed-text или OpenAI text-embedding-3-small),
vector store (LanceDB / sqlite-vec), smart chunking, инвалидации при изменениях.
**Оценка**: 2-3 месяца работы одного человека.
**Минимальная альтернатива сейчас**: `@`-mentions конкретных файлов + skills.

### Agent mode (Cmd+I в Cursor)
**Почему нет**: self-loop tool use требует:
- 15-20 инструментов (read_file, edit_file, run_terminal, search_codebase, run_tests, …)
- retry-логика, контекст между шагами, лимиты на стоимость
- безопасность: sandbox для terminal, разрешения на каждый edit
**Оценка**: 2-3 месяца работы.
**Минимальная альтернатива**: MCP-серверы (если реализовать tools/list/call).

### Background agents
**Почему нет**: серьёзная инфраструктура (изолированные окружения, мониторинг,
безопасность). Это уровень $20M-funded стартапа, не одного фрилансера.
**Оценка**: 6+ месяцев.

### Bug Finder
**Почему нет**: Cursor использует специально натренированную модель.
Воспроизвести без датасета и тренировки нереально.
**Альтернатива**: попросить NIT через обычный chat "найди баги в этом файле".

### MCP stdio-серверы
**Почему нет (сейчас)**: требует канала renderer ↔ electron-main для spawn'а
child processes. Это **возможно**, но архитектурная работа.
**Оценка**: 1-1.5 недели.
**Сейчас**: только HTTP/SSE MCP-серверы.

---

## Дебаг — как сейчас отлаживать сам Vibecoder

### Логи NIT-провайдеров
- DevTools в окне Vibecoder: `Help → Toggle Developer Tools` → Console
- Префикс `[Vibecoder]` — общие сообщения
- Префикс `[Vibecoder][LMStudio]` — события LM Studio (SSE parsing errors, пустой список моделей)

### Диагностика провайдеров
- `Vibecoder: Test LM Studio Connection` — детальный пинг + список моделей
- `Vibecoder: List All Available Models` — все доступные модели всех провайдеров

### Если NIT не отвечает или говорит ошибку
1. Проверь `Vibecoder: Test LM Studio Connection` (если используешь LM Studio)
2. Проверь API-ключ через `Vibecoder: Set API Key for Provider` (если облачный)
3. Открой DevTools Console, отправь сообщение, посмотри что в логах

### Дебаг кода юзера (не Vibecoder)
Стандартный VS Code debugger работает как есть. F5 → Run and Debug.

---

## Версионирование

- `v0.1.x` — alpha. Текущая. Главная цель: довести Composer + Tab + Cmd+K до рабочего состояния.
- `v0.2.x` — beta. Цель: @-mentions, история чатов, MCP stdio.
- `v0.3.x` — rc. Цель: подписанные сборки (Apple Dev + Windows code signing).
- `v1.0.x` — stable. Когда основные фичи работают надёжно.

Versioning через GitHub Releases (CI workflow уже готов: `.github/workflows/release.yml`).

---

## Принципы выбора фич

Из манифеста Срединного пути:

> "Это улучшение снижает реальный риск — или только гладит эго?"

Каждая фича оценивается по двум осям:
1. **Value**: насколько часто этим пользуются? насколько ускоряет работу?
2. **Effort**: реально оценённое время одного человека

В roadmap фичи отсортированы по value/effort. Срединный путь —
не делать всё сразу и не делать ничего из страха, а делать то, что
максимально полезно за обозримое время.

---

*Roadmap живой документ. Правится по факту, не по плану.*
