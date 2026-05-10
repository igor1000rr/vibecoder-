/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Welcome-команда Vibecoder.
 *
 * Открывает приветственную страницу при первом запуске и через
 * Help → Vibecoder Welcome. Открывает untitled-документ с приветственным
 * markdown'ом в стиле NIT — это самый надёжный способ показать
 * preview без необходимости тащить WebviewPanel API.
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

		// Открываем untitled editor с приветственным markdown
		await editorService.openEditor({
			resource: welcomeUri,
			contents: WELCOME_MARKDOWN,
			languageId: 'markdown',
			options: { preview: false },
		} as any);
	}
}

const WELCOME_MARKDOWN = `# 🌌 Welcome to Vibecoder

## ▸ NEURAL INTERFACE TERMINAL ◂

> **AI-first IDE с упором на локальные модели.**
> Твой AI-ассистент внутри — **NIT** (Neural Interface Terminal).

---

## 🚀 С чего начать

### 1️⃣ Открой NIT в сайдбаре
Слева в Activity Bar — иконка ✨ **NIT**. Нажми её, откроется AI-сайдбар.

### 2️⃣ Подключи LM Studio (рекомендуется)
1. Скачай [LM Studio](https://lmstudio.ai/)
2. Загрузи модель (для RTX 5090 — **Qwen 3 Coder 30B-A3B**)
3. Developer → Start Server (\`localhost:1234\`)
4. В NIT выбери \`🖥 LM Studio\` → пиши

### 3️⃣ Облачные провайдеры (опционально)
\`Ctrl+Shift+P\` → \`Vibecoder: Set API Key for Provider\`
Поддерживаются: **Anthropic**, **OpenAI**, **Gemini**, **OpenRouter**

API-ключ сохраняется в системном keychain. Никогда не попадает в git.

### 4️⃣ Из РБ / РФ / другого региона с блокировками
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
| \`Vibecoder: Reload Skills\` | Перезагрузить .vibecoder/skills/ |
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

Vibecoder поддерживает Model Context Protocol — стандарт от Anthropic для тулсов LLM.

Конфиг: \`.vibecoder/mcp.json\` (формат как у Claude Desktop / Cursor).
Шаблон: \`.vibecoder/mcp.example.json\`

---

## 📚 Дальше

- **README.md** — полное описание
- **SETUP.md** — гайд по установке и тестам
- **Issues** — [github.com/igor1000rr/vibecoder-/issues](https://github.com/igor1000rr/vibecoder-/issues)

---

\`\`\`
████████████████████████████████████████████████
█                                              █
█    ▸▸▸  HAPPY VIBE CODING  ◂◂◂              █
█                                              █
█    Vibecoder v0.1.0 alpha                    █
█    Built on Void & VS Code OSS · Apache 2.0  █
█                                              █
████████████████████████████████████████████████
\`\`\`

**Закрой эту вкладку и начни кодить.** NIT в сайдбаре слева. 👈
`;
