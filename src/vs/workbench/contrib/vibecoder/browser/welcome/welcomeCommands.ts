/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Welcome-команда Vibecoder.
 *
 * Открывает приветственную страницу при первом запуске и через
 * Help → Vibecoder Welcome. Untitled-документ с markdown'ом в стиле NIT.
 */

import { localize2 } from '../../../../../nls.js';
import { Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { URI } from '../../../../../base/common/uri.js';

export class VibecoderOpenWelcomeAction extends Action2 {
	static readonly ID = 'vibecoder.openWelcome';

	constructor() {
		super({
			id: VibecoderOpenWelcomeAction.ID,
			title: localize2('vibecoder.openWelcome.title', 'Vibecoder: Open Welcome'),
			category: localize2('vibecoder.category', 'Vibecoder'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const textFileService = accessor.get(ITextFileService);
		void textFileService;

		const welcomeUri = URI.from({ scheme: 'untitled', path: 'Welcome to Vibecoder.md' });

		await editorService.openEditor({
			resource: welcomeUri,
			contents: WELCOME_MARKDOWN,
			languageId: 'markdown',
			options: { preview: false },
		} as any);
	}
}

const WELCOME_MARKDOWN = `\`\`\`
   ██╗   ██╗██╗██████╗ ███████╗ ██████╗ ██████╗ ██████╗ ███████╗██████╗
   ██║   ██║██║██╔══██╗██╔════╝██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗
   ██║   ██║██║██████╔╝█████╗  ██║     ██║   ██║██║  ██║█████╗  ██████╔╝
   ╚██╗ ██╔╝██║██╔══██╗██╔══╝  ██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗
    ╚████╔╝ ██║██████╔╝███████╗╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║
     ╚═══╝  ╚═╝╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝
\`\`\`

# ▸ NEURAL INTERFACE TERMINAL ◂

**AI-first IDE с упором на локальные модели и приватность.**
Твой AI-ассистент внутри — **NIT** (Neural Interface Terminal),
который следует путём **Madhya** — Срединному пути.

---

## 🧭 Мировоззрение

Vibecoder построен на **Манифесте разработчика Срединного пути**.

Это не корпоративная этичка и не философский трактат. Это набор практических ориентиров:
не выгорай и не халтурь, не молись на ИИ и не игнорируй его, не строй тёмные паттерны
и не выпиливай фичи из страха. Активный, осознанный путь между крайностями.

**Главный принцип:**
> *«ИИ усиливает тебя — не заменяет. Ты отвечаешь за каждое решение, которое ИИ помог принять.»*

NIT встроил **Кодекс Madhya** в системный промпт — он применяется к каждому ответу модели.
- Полный манифест: \`docs/MANIFESTO.md\`
- Системный промпт NIT: \`docs/NIT_SYSTEM_PROMPT.md\`

---

## 🚀 С чего начать

### 1️⃣ NIT уже открыт справа 👉

В правой панели (AuxiliaryBar) — сайдбар **NIT**. Открывается автоматически при запуске.
Если закрыл — \`Ctrl+Shift+P\` → \`Vibecoder: Open NIT Sidebar\`.

### 2️⃣ Подключи LM Studio (самый приватный путь)

1. Скачай [LM Studio](https://lmstudio.ai/)
2. Загрузи модель (для RTX 5090 — **Qwen 3 Coder 30B-A3B**, для теста — **Qwen 2.5 Coder 7B**)
3. Developer → **Start Server** (\`localhost:1234\`)
4. В NIT выбери \`🖥 LM Studio\` → модель выберется автоматически → пиши

### 3️⃣ Включи Tab autocomplete (опционально)

В Vibecoder есть FIM-автокомплит — серые предложения появляются прямо в редакторе,
принимаются клавишей **Tab**. По умолчанию **отключён** чтобы не лагать.

Чтобы включить:

1. В LM Studio загрузи маленькую и быструю модель (рекомендуется **Qwen 2.5 Coder 1.5B** или **3B**)
2. \`Ctrl+,\` → найди \`vibecoder.lmStudio.autocompleteModel\`
3. Впиши имя модели (точно как в LM Studio: например \`qwen2.5-coder-3b-instruct\`)
4. Печатай в любом файле — Tab принимает предложение, Esc отклоняет

⚠ Не используй большую модель (>7B) для автокомплита — будет лагать.

### 4️⃣ Облачные провайдеры (опционально)

\`Ctrl+Shift+P\` → \`Vibecoder: Set API Key for Provider\`
Поддерживаются: **Anthropic**, **OpenAI**, **Gemini**, **OpenRouter**

API-ключ сохраняется в системном keychain. Никогда не попадает в git.

### 5️⃣ Из региона с блокировками (РБ/РФ)

Settings → \`vibecoder.proxy.mode\` → переключи на \`vibecoder\` или \`custom\` URL.

---

## 💡 Главные фичи

| Фича | Как пользоваться |
|---|---|
| **Чат с AI** | Пиши в NIT справа. NIT видит твой текущий файл автоматически |
| **Выделение → фокус** | Выдели код в редакторе → бейдж в NIT станет magenta — NIT сфокусируется на выделении |
| **Apply кнопки** | NIT отдал код с правками → жми \`▶ Apply\` под сообщением. \`▼ diff\` раскрывает preview |
| **Tab autocomplete** | Печатаешь → серые предложения → Tab принимает (нужна модель в настройках, см. выше) |
| **Skills** | Положи \`SKILL.md\` в \`.vibecoder/skills/<name>/\` — NIT будет следовать им |

---

## ⚡ Команды NIT

Все доступны через \`Ctrl+Shift+P\`:

| Команда | Что делает |
|---|---|
| \`Vibecoder: Open NIT Sidebar\` | Открыть NIT справа |
| \`Vibecoder: Test LM Studio Connection\` | Проверить LM Studio с диагностикой |
| \`Vibecoder: Set API Key for Provider\` | Ввести API-ключ |
| \`Vibecoder: List All Available Models\` | Список моделей |
| \`Vibecoder: Reload Skills\` | Перезагрузить \`.vibecoder/skills/\` |
| \`Vibecoder: Apply Changes from Clipboard\` | Применить search/replace блоки |
| \`Vibecoder: Open Welcome\` | Эта страница |

---

## 🔌 MCP-серверы

Vibecoder поддерживает **Model Context Protocol** — стандарт от Anthropic для тулсов LLM.

Конфиг: \`.vibecoder/mcp.json\` (формат как у Claude Desktop / Cursor).
Шаблон: \`.vibecoder/mcp.example.json\`

---

## 📚 Дальше

- **\`docs/MANIFESTO.md\`** — манифест целиком
- **\`docs/NIT_SYSTEM_PROMPT.md\`** — что NIT получает в системный промпт (прозрачность)
- **\`docs/ROADMAP.md\`** — что есть, что в плане, что не делаем
- **Issues** → [github.com/igor1000rr/vibecoder-/issues](https://github.com/igor1000rr/vibecoder-/issues)

---

\`\`\`
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   ▸▸▸  Vibecoder v0.1.0 alpha                            │
│        Apache 2.0 · Built on Void & VS Code OSS          │
│        vibecoding.by                                     │
│                                                          │
│   ▸▸▸  Срединный путь — каждый день, в каждом коммите.   │
│                                                          │
└──────────────────────────────────────────────────────────┘
\`\`\`

**Закрой эту вкладку и начни кодить.** NIT справа 👉
`;
