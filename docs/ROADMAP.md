# Vibecoder Roadmap

> *"Минимально достаточный дизайн с точками роста. Решения по факту наблюдаемых
> данных, не по фантазиям о масштабировании."* — Кодекс NIT (Madhya)

Дорожная карта Vibecoder. Что есть, что в плане, что **сознательно** не делаем.

Базовый принцип — честность об ограничениях. Vibecoder разрабатывает один
человек (igor1000rr), Cursor — компания с $400M funding и 50+ инженерами.
До паритета по фичам пока далеко. Но архитектура совместима с движением туда.

---

## Что работает СЕЙЧАС (v0.1.0 alpha)

### Ядро
- ✅ Форк VS Code OSS с собственным брендом и темой (Vibecoder Cyberpunk)
- ✅ NIT-сайдбар справа в AuxiliaryBar (Cursor-style), авто-открытие при старте
- ✅ Streaming чат с 5 провайдерами:
  - LM Studio (локально, OpenAI-совместимый API)
  - Anthropic (Claude Opus/Sonnet/Haiku)
  - OpenAI (GPT-5, o3)
  - Google Gemini (2.5 Pro/Flash)
  - OpenRouter (агрегатор)
- ✅ Прокси-режим (`vibecoder.proxy.mode`) для пользователей из санкционных регионов
- ✅ API-ключи в системном keychain (никогда в settings.json или git)
- ✅ Auto-select первой модели LM Studio при подключении

### Context awareness (NIT видит что юзер делает)
- ✅ **Auto-include активного файла** — NIT всегда видит файл в текущем редакторе
- ✅ **Selection focus** — выделил код → бейдж magenta, NIT фокусируется на выделении
- ✅ Бейдж "📄 file.ts · 234 lines · typescript · ✦ 5 sel" в header сайдбара
- ✅ Обновление контекста на каждый запрос (видит свежее состояние, а не закэшированное)

### Composer (правки кода через AI)
- ✅ **Apply кнопки прямо в чате** — per-file и Apply All под сообщением ассистента
- ✅ **Collapsible diff preview** — клик ▼ показывает search/replace в красно-зелёном виде
- ✅ Apply Changes from Clipboard (запасной путь через `Ctrl+Shift+P`)
- ❌ Diff editor side-by-side перед apply — нет (есть только inline preview)
- ❌ Per-block undo после apply — нет (стандартный Ctrl+Z редактора)

### Tab autocomplete (FIM)
- ✅ **InlineCompletionsProvider** зарегистрирован в редакторе
- ✅ Запрашивает LM Studio с FIM-промптом через chat API
- ✅ Throttle 250ms между запросами + cancellation при движении курсора
- ⚠ **По умолчанию ОТКЛЮЧЁН** — нужно указать модель в
  `vibecoder.lmStudio.autocompleteModel` (рекомендуется Qwen 2.5 Coder 1.5B/3B)
- ❌ Использование настоящих FIM-токенов (`<|fim_prefix|>`) — пока через chat API,
  что медленнее. Улучшение в v0.2

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
- ✅ Кодекс Madhya встроен в каждый ответ модели (7 разделов, авторство Дмитрия)

---

## ПЛАНЫ — что реально сделать (1-4 недели каждое)

### 🔥 Приоритет 1 — следующие большие фичи

#### 1.1. Cmd+K inline edit
**Эффект**: главная вторая фича Cursor. Выделил код → Cmd+K → "сделай Х" →
diff inline → принять/отклонить.

**Что делать**:
- Хоткей `Cmd+K` / `Ctrl+K` на выделение в редакторе
- Inline-popup с input полем (через monaco contentWidgets)
- Отправка в LLM с контекстом: выделение + соседние строки + язык файла
- Применение через `editor.executeEdits()` с inline-diff декорациями
- Кнопки Accept/Reject в декорации

**Сложность**: средняя-высокая. 4-7 дней. Требует работы с monaco-editor API
(декорации, view zones, content widgets).

#### 1.2. FIM-токены для Tab autocomplete (производительность)
**Эффект**: ускорить Tab autocomplete в 2-3 раза.

**Что делать**:
- Переключить с chat API на `/v1/completions` endpoint LM Studio
- Использовать настоящие FIM-токены: `<|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>`
- Детектить формат по имени модели (Qwen vs DeepSeek vs StarCoder — разные токены)

**Сложность**: средняя. 2-3 дня. Главная сложность — токены отличаются у моделей.

### 🟡 Приоритет 2 — улучшения UX

#### 2.1. @-mentions файлов в input NIT
**Эффект**: можно указать конкретный файл для контекста, не открывая его в редакторе.

**Что делать**:
- Автокомплит по `@` в textarea → список файлов workspace
- При выборе — содержимое файла включается в `workspaceContext` для LLM

**Сложность**: средняя. 2-3 дня.

#### 2.2. Список открытых табов в контексте
**Эффект**: NIT знает какие файлы открыты у юзера, может предложить их посмотреть.

**Что делать**: в `buildWorkspaceContext` добавить секцию `## Открытые табы:` со
списком имён файлов (без содержимого — иначе раздувание контекста).

**Сложность**: низкая. Полдня.

#### 2.3. Proper diff editor перед apply
**Эффект**: безопаснее применять — видно ДО в полноценном diff editor.

**Что делать**: зарегистрировать `vibecoder-diff://` TextModelContentProvider,
открыть native VS Code diff с original (из памяти) vs predicted new.

**Сложность**: средняя. 1-2 дня. Сложно потому что нужен FileSystemProvider.

#### 2.4. Сохранение истории чатов между сессиями
**Эффект**: NIT помнит о чём говорили вчера.

**Что делать**: SQLite-хранилище через `IStorageService` + UI списка прошлых чатов.

**Сложность**: средняя. 3-5 дней.

### 🟢 Приоритет 3 — полировка

- Кастомные иконки Activity Bar (свои киберпанковые SVG вместо codicon)
- Splash screen с лого Vibecoder при запуске
- Убрать сломанные extensions (open-remote-wsl, voideditor.open-remote-ssh)
- Команда `Vibecoder: Setup Wizard` с пошаговой настройкой LM Studio + autocomplete
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
- Префикс `[Vibecoder][Autocomplete]` — события Tab autocomplete (ошибки запросов)

### Диагностика провайдеров
- `Vibecoder: Test LM Studio Connection` — детальный пинг + список моделей
- `Vibecoder: List All Available Models` — все доступные модели всех провайдеров

### Если NIT не отвечает или говорит ошибку
1. Проверь `Vibecoder: Test LM Studio Connection` (если используешь LM Studio)
2. Проверь API-ключ через `Vibecoder: Set API Key for Provider` (если облачный)
3. Открой DevTools Console, отправь сообщение, посмотри что в логах

### Если Tab autocomplete не работает
1. Проверь что в настройках указана модель в `vibecoder.lmStudio.autocompleteModel`
2. Проверь что эта модель ЗАГРУЖЕНА в LM Studio (`Vibecoder: List All Available Models`)
3. DevTools Console — должно быть сообщение `[Vibecoder][Autocomplete] inline completions provider registered`
4. При печатании в файле — открой Network tab DevTools, должны видеть POST к `localhost:1234/v1/chat/completions`
5. Маленькая модель ВАЖНА — 30B будет лагать на каждой клавише. Юзай 1.5B/3B.

### Дебаг кода юзера (не Vibecoder)
Стандартный VS Code debugger работает как есть. F5 → Run and Debug.

---

## Версионирование

- `v0.1.x` — alpha. **Текущая.** Главные цели достигнуты: NIT-чат, Apply кнопки,
  Tab autocomplete, context awareness. Дальше — Cmd+K и оптимизации.
- `v0.2.x` — beta. Цель: Cmd+K inline edit, @-mentions, история чатов, MCP stdio.
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
