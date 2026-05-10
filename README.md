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

Требования: Node.js 22 LTS, Python 3.11, VS Build Tools 2022 (Windows) / Xcode CLT (macOS) / build-essential (Linux).

## Лицензия

MIT (как у VS Code OSS и Void).

---

Built on top of [Void](https://github.com/voideditor/void) and [Visual Studio Code](https://github.com/microsoft/vscode).
