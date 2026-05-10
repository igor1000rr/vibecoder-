# Vibecoder

**AI-first IDE с упором на локальные модели.** Форк [Void](https://github.com/voideditor/void) (форк VS Code OSS). Заточен под LM Studio, MCP-серверы и Skills.

## Ключевые отличия от Cursor / Continue / Cline

- **Локальные модели — граждане первого класса.** LM Studio из коробки, никакого fallback на облако без явного согласия.
- **MCP и Skills встроены в ядро,** а не прикручены сбоку.
- **Унифицированный LLM-роутер.** LM Studio, Anthropic, OpenAI, Gemini, OpenRouter — один интерфейс, один формат.
- **Опциональный встроенный прокси** на Cloudflare Workers — для регионов где провайдеры недоступны напрямую.
- **Полная приватность.** Никакой телеметрии. Кодовая индексация — всё локально.
- **Open VSX marketplace** — никаких нарушений TOS Microsoft.

## Целевая платформа

Windows-first (оптимизирован под NVIDIA RTX 5090). Linux вторым, macOS arm64 третьим.

## Статус

⚠️ **Pre-alpha.** Активная разработка. Релиз 1.0 — Q4 2026.

### Что уже сделано (alpha 0.1.0)

- ✅ Сборка из исходников на Windows работает
- ✅ Полный ребрендинг (имя, GUID, иконка, заголовки)
- ✅ Open VSX marketplace вместо Microsoft
- ✅ AI-модуль `src/vs/workbench/contrib/vibecoder/`
- ✅ LLMRouter с 5 провайдерами (LM Studio, Anthropic, OpenAI, Gemini, OpenRouter)
- ✅ Single-sign-on хранение API-ключей через системный OS keychain (SecretStorage)
- ✅ AI-чат сайдбар (Activity Bar → sparkle иконка)
- ✅ Конфигурация (Settings → Vibecoder)
- ✅ Cloudflare Worker proxy (`proxy/`) — стримящий forwarder
- ✅ Composer: парсер Aider-style search/replace + Apply from Clipboard
- ✅ MCP service (HTTP/SSE health check; полный JSON-RPC handshake — позже)
- ✅ Skills loader (`.vibecoder/skills/*/SKILL.md`, формат Anthropic Skills)
- ✅ Системные промпты (chat, composer, autocomplete)
- ✅ Иконка Vibecoder (плейсхолдер, magenta+cyan V)

### Roadmap

- 🔲 React-based ChatView UI (сейчас vanilla DOM)
- 🔲 Tab autocomplete: подключение к редактору и FIM-токены под Qwen Coder
- 🔲 Diff editor для каждого блока перед apply
- 🔲 MCP полноценный JSON-RPC handshake + stdio-серверы через electron-main
- 🔲 Кодовый индекс (tree-sitter + embedding через LM Studio nomic-embed)
- 🔲 Глобальные skills (~/.vibecoder/skills/)
- 🔲 Веб-версия (Vibecoder for the Web)

## Сборка из исходников

```bash
git clone https://github.com/igor1000rr/vibecoder-.git
cd vibecoder-
npm install
npm run watch
# в другом терминале:
./scripts/code.bat   # Windows
./scripts/code.sh    # Linux/macOS
```

Требования:
- Node.js 22 LTS
- Python 3.11
- **Windows:** VS Build Tools 2022 с компонентом *MSVC v143 — библиотеки C++ для VS 2022 для x64/x86 с устранением рисков Spectre (последняя версия)*
- **macOS:** Xcode CLT
- **Linux:** build-essential, libsecret-1-dev

## Структура AI-модуля

```
src/vs/workbench/contrib/vibecoder/
├── common/
│   └── vibecoder.ts                  ← константы, IDs, типы провайдеров
└── browser/
    ├── vibecoder.contribution.ts     ← регистрация всего
    ├── vibecoderConfiguration.ts     ← конфигурационные ключи
    ├── llm/                          ← LLM-провайдеры
    │   ├── llmProvider.ts            ← интерфейс
    │   ├── llmRouter.ts              ← центральный сервис
    │   ├── lmStudioProvider.ts
    │   ├── openAICompatibleProvider.ts  ← база для OpenAI/OpenRouter
    │   ├── openAIProvider.ts
    │   ├── openRouterProvider.ts
    │   ├── anthropicProvider.ts      ← свой формат
    │   └── geminiProvider.ts         ← свой формат
    ├── chat/
    │   └── vibecoderChatView.ts      ← сайдбар с чатом
    ├── composer/
    │   ├── composerService.ts        ← парсер search/replace + apply
    │   └── composerCommands.ts       ← Apply from Clipboard
    ├── mcp/
    │   └── mcpService.ts             ← MCP-клиент (скелет)
    ├── skills/
    │   └── skillsService.ts          ← загрузчик .vibecoder/skills/
    ├── autocomplete/
    │   └── autocompleteService.ts    ← FIM через LM Studio (experimental)
    └── prompts/
        └── systemPrompts.ts          ← chat/composer/autocomplete prompts

proxy/                                ← Cloudflare Worker (отдельный деплой)

.vibecoder/skills/                    ← пример skills (code-review, write-tests)
```

## Команды (Ctrl+Shift+P → "Vibecoder")

| Команда | Что делает |
|---|---|
| `Vibecoder: Hello` | Smoke-test, показывает версию и количество skills |
| `Vibecoder: Test LM Studio Connection` | Пингует LM Studio и показывает список моделей |
| `Vibecoder: Set API Key for Provider` | Ввести API-ключ для облачного провайдера (Anthropic/OpenAI/Gemini/OpenRouter) |
| `Vibecoder: List All Available Models` | Список моделей со всех провайдеров |
| `Vibecoder: Reload Skills` | Перезагрузить `.vibecoder/skills/` |
| `Vibecoder: Apply Changes from Clipboard` | Парсинг search/replace блоков и применение к workspace |

## Лицензия

[Apache License 2.0](LICENSE.txt) (наследуется от Void и VS Code OSS).

---

Built on top of [Void](https://github.com/voideditor/void) and [Visual Studio Code OSS](https://github.com/microsoft/vscode).
