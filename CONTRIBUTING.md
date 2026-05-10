# Contributing to Vibecoder

Vibecoder — pre-alpha проект, активно ищем контрибьюторов. Этот документ описывает как влиться в разработку.

## Какие задачи открыты

Сейчас приоритет на **MVP 0.1.0** — заставить базовый workflow работать end-to-end (LM Studio chat → composer → applied changes). После этого:

1. **React-based ChatView UI.** Сейчас vanilla DOM. Нужен полноценный composer-style интерфейс с markdown rendering, code highlighting, кнопками Apply/Reject рядом с каждым блоком.
2. **MCP полноценный JSON-RPC handshake.** Сейчас только health check.
3. **stdio MCP-серверы.** Нужен канал в electron-main, child process spawner.
4. **Tab autocomplete:** подключение `InlineCompletionsProvider` к редактору, FIM-токены под целевую модель (Qwen Coder 30B-A3B).
5. **Diff editor** перед apply каждого блока.
6. **Кодовый индекс** через tree-sitter + nomic-embed.
7. **Внутри-чат tools** для агентных задач (run shell, read file, write file под approval).
8. **Веб-версия** Vibecoder.

См. Issues в репо.

## Локальная разработка

См. README.md → "Сборка из исходников".

Tip: после правок в TypeScript можно НЕ перезапускать `code.bat` — gulp watch перекомпилирует, а Vibecoder перезагрузит через `Developer: Reload Window` (Ctrl+R).

## Структура коммитов

- **Прямой push в `main`,** без feature branches и PR (это персональный проект Игоря, не open-source ещё).
- Commit message на **русском**, в формате: `<область>: что сделано`. Примеры:
  - `Vibecoder LLM: GeminiProvider с трансляцией формата Google`
  - `Vibecoder Chat: добавить переключатель провайдера`
  - `proxy: Cloudflare Worker forwarder`
- Код (имена переменных, функций, классов) — на английском.
- Комментарии, docstrings, README — на русском.

## Стиль кода

Следуй VS Code-овскому стилю. Конкретно:

- 4-spaces tabs (как у VS Code, не 2 spaces).
- Кавычки одинарные `'...'` для строк.
- Импорты с расширением `.js` (несмотря на `.ts` файлы) — VS Code OSS использует ESM с явными расширениями.
- Класс-сервисы с интерфейсом `IXxxService` + декоратором `createDecorator(...)`.
- `_register(...)` для всех disposable.

## Лицензия

Все вклады принимаются под Apache License 2.0.
