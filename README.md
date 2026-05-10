# Vibecoder

**AI-first IDE с упором на локальные модели.** Форк [Void](https://github.com/voideditor/void) (который сам форк VS Code OSS). Заточен под LM Studio, MCP-серверы и Skills.

## Ключевые отличия от Cursor / Continue / Cline

- **Локальные модели — граждане первого класса.** LM Studio из коробки, никакого fallback на облако без явного согласия.
- **MCP и Skills встроены в ядро,** а не прикручены сбоку. Composer автоматически подбирает релевантные skills.
- **Унифицированный LLM-роутер.** LM Studio, Anthropic, OpenAI, Gemini, OpenRouter — один интерфейс, один формат.
- **Опциональный встроенный прокси** на Cloudflare Workers — для регионов где провайдеры недоступны напрямую.
- **Полная приватность.** Никакой телеметрии. Кодовая индексация, embeddings — всё локально.
- **Open VSX marketplace** — никаких нарушений TOS Microsoft.

## Целевая платформа

Windows-first (оптимизирован под NVIDIA RTX 5090). Linux вторым, macOS arm64 третьим.

## Статус

⚠️ **Pre-alpha.** Активная разработка. Релиз 1.0 — Q4 2026.

### Что уже работает

- ✅ Базовая сборка из исходников на Windows
- ✅ Open VSX marketplace вместо Microsoft
- ✅ Полный ребрендинг (имя, GUID, иконка, заголовки)
- ✅ Скелет AI-модуля (`src/vs/workbench/contrib/vibecoder/`)

### Roadmap

- 🔲 LLMRouter (LM Studio + Anthropic + OpenAI + Gemini + OpenRouter)
- 🔲 Cloudflare Worker proxy (`proxy.vibecoder.dev`)
- 🔲 AI-сайдбар с чатом
- 🔲 Composer с multi-file edit и diff UI
- 🔲 MCP-клиент
- 🔲 Skills loader (`.vibecoder/skills/*/SKILL.md`)
- 🔲 Tab autocomplete через LM Studio
- 🔲 Кодовый индекс (tree-sitter + embeddings)

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

Требования: Node.js 22 LTS, Python 3.11, VS Build Tools 2022 с компонентом *MSVC v143 C++ x64/x86 Spectre-mitigated libs* (Windows) / Xcode CLT (macOS) / build-essential (Linux).

## Лицензия

[Apache License 2.0](LICENSE.txt) (наследуется от Void и VS Code OSS).

---

Built on top of [Void](https://github.com/voideditor/void) and [Visual Studio Code OSS](https://github.com/microsoft/vscode).
