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
Твой AI-ассистент внутри — **NIT** (Neural Interface Terminal).

---

## 🧭 Мировоззрение

Vibecoder построен на **Манифесте разработчика Срединного пути**.

Это не корпоративная этичка и не философский трактат. Это набор практических ориентиров:
не выгорай и не халтурь, не молись на ИИ и не игнорируй его, не строй тёмные паттерны
и не выпиливай фичи из страха. Активный, осознанный путь между крайностями.

**Главный принцип:**
> *«ИИ усиливает тебя — не заменяет. Ты отвечаешь за каждое решение, которое ИИ помог принять.»*

NIT встроил **Кодекс NIT** (дистиллят манифеста) в системный промпт — он применяется к каждому
ответу модели. Полная версия — \`docs/MANIFESTO.md\` в репо.

---

## 🚀 С чего начать

### 1️⃣ Открой NIT в сайдбаре
Слева в Activity Bar — иконка ✨ **NIT**. Нажми её, откроется AI-сайдбар.

### 2️⃣ Подключи LM Studio (самый приватный путь)
1. Скачай [LM Studio](https://lmstudio.ai/)
2. Загрузи модель (для RTX 5090 — **Qwen 3 Coder 30B-A3B**)
3. Developer → Start Server (\`localhost:1234\`)
4. В NIT выбери \`🖥 LM Studio\` → пиши

### 3️⃣ Облачные провайдеры (опционально)
\`Ctrl+Shift+P\` → \`Vibecoder: Set API Key for Provider\`
Поддерживаются: **Anthropic**, **OpenAI**, **Gemini**, **OpenRouter**

API-ключ сохраняется в системном keychain. Никогда не попадает в git.

### 4️⃣ Из региона с блокировками (РБ/РФ)
Settings → \`vibecoder.proxy.mode\` → переключи на \`vibecoder\` или \`custom\` URL.

---

## ⚡ Команды NIT

Все доступны через \`Ctrl+Shift+P\`:

| Команда | Что делает |
|---|---|
| \`Vibecoder: Hello\` | Smoke-test |
| \`Vibecoder: Test LM Studio Connection\` | Проверить LM Studio |
| \`Vibecoder: Set API Key for Provider\` | Ввести API-ключ |
| \`Vibecoder: List All Available Models\` | Список моделей |
| \`Vibecoder: Reload Skills\` | Перезагрузить \`.vibecoder/skills/\` |
| \`Vibecoder: Apply Changes from Clipboard\` | Применить search/replace блоки |
| \`Vibecoder: Open Welcome\` | Эта страница |

---

## 🧠 Skills — кастомные инструкции для NIT

Положи \`SKILL.md\` в \`.vibecoder/skills/<name>/\` в workspace.
Формат совместим с Anthropic Skills.

В репо уже есть примеры:
- \`.vibecoder/skills/code-review/\`
- \`.vibecoder/skills/write-tests/\`

---

## 🔌 MCP-серверы

Vibecoder поддерживает **Model Context Protocol** — стандарт от Anthropic для тулсов LLM.

Конфиг: \`.vibecoder/mcp.json\` (формат как у Claude Desktop / Cursor).
Шаблон: \`.vibecoder/mcp.example.json\`

---

## 📚 Дальше

- **\`docs/MANIFESTO.md\`** — манифест целиком (8 правил кодекса NIT — внутри)
- **README.md** — полное описание Vibecoder
- **SETUP.md** — гайд по установке и тестам
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

**Закрой эту вкладку и начни кодить.** NIT в сайдбаре слева. 👈
`;
