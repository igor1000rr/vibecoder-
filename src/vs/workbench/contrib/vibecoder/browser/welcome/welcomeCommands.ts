/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Welcome-страница Vibecoder.
 *
 * Открывается при старте, если нет открытого workspace или включена настройка
 * workbench.startupEditor=welcomePage. Стиль — киберпанк vibecoding.by:
 * тёмный фон, неоновые акценты, моноширинный шрифт.
 *
 * Реализация: WebviewView, рендерится через HTML с inline CSS (без React,
 * чтобы не тащить tsx pipeline сейчас).
 */

import { localize, localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { URI } from '../../../../../base/common/uri.js';

export const VIBECODER_WELCOME_URI = URI.parse('vibecoder-welcome://welcome');

/**
 * Команда: открыть Vibecoder Welcome.
 * Вызывается при старте IDE и через Help → Vibecoder.
 */
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
		const commandService = accessor.get(ICommandService);

		// Используем встроенный simple-browser/markdown editor для рендера HTML,
		// но через временный data: URI это не работает. Альтернатива - открыть
		// untitled markdown с текстом приветствия.
		// MVP: открываем markdown с приветствием. Полноценный HTML-welcome -
		// в следующей итерации через WebviewView.
		void editorService;
		void commandService;

		// Используем простой обходной путь: открыть untitled с приветственным текстом.
		// В следующей итерации заменим на полноценный WebviewView.
		const welcome = buildWelcomeMarkdown();
		await editorService.openEditor({
			contents: welcome,
			languageId: 'markdown',
			label: localize('vibecoder.welcome.label', 'Welcome to Vibecoder'),
		} as any);
	}
}

function buildWelcomeMarkdown(): string {
	return `# Welcome to Vibecoder

> **AI-first IDE с локальными моделями.** Твой AI-ассистент — **NIT**.

---

## 🚀 Быстрый старт

### 1. Включи NIT
Слева в Activity Bar найди иконку ✨ (sparkle) — это NIT.
Нажми, откроется сайдбар с чатом.

### 2. Выбери провайдера
Сверху в сайдбаре — два dropdown'а:
- **Провайдер:** LM Studio (local) / Anthropic / OpenAI / Gemini / OpenRouter
- **Модель:** список загружается автоматически

### 3. Локально через LM Studio (рекомендуется)
1. Скачай и запусти [LM Studio](https://lmstudio.ai/)
2. Загрузи модель (рекомендуется **Qwen 3 Coder 30B-A3B** для RTX 5090)
3. Developer → Start Server (по умолчанию \`localhost:1234\`)
4. В NIT выбери \`LM Studio (local)\` → пиши

### 4. Облачные провайдеры (опционально)
\`Ctrl+Shift+P\` → \`Vibecoder: Set API Key for Provider\` → выбери провайдера → вставь ключ.

Ключ сохраняется в системном keychain. **Никогда не попадает в settings.json или git.**

### 5. Из РБ/РФ или другого региона с блокировками
Settings → найди \`vibecoder.proxy.mode\` → переключи в \`vibecoder\` (или \`custom\` со своим URL).

---

## ⚡ Команды NIT

| Команда | Что делает |
|---|---|
| \`Vibecoder: Hello\` | Smoke-test |
| \`Vibecoder: Test LM Studio Connection\` | Проверить LM Studio |
| \`Vibecoder: Set API Key for Provider\` | Ввести API-ключ |
| \`Vibecoder: List All Available Models\` | Список моделей |
| \`Vibecoder: Reload Skills\` | Перезагрузить \`.vibecoder/skills/\` |
| \`Vibecoder: Apply Changes from Clipboard\` | Применить search/replace блоки |

Все доступны через \`Ctrl+Shift+P\`.

---

## 🧠 Что такое Skills

Skills — это инструкции для NIT *когда и как* выполнять специфичную задачу.
Формат совместим с Anthropic Skills.

Положи \`SKILL.md\` в \`.vibecoder/skills/<name>/\` в своём workspace —
NIT автоматически их подхватит.

Примеры лежат в репо: \`.vibecoder/skills/code-review/\`, \`.vibecoder/skills/write-tests/\`

---

## 🔌 MCP-серверы

NIT поддерживает Model Context Protocol — стандарт от Anthropic для тулсов LLM.

Конфиг: \`.vibecoder/mcp.json\` (формат как у Claude Desktop / Cursor).
См. пример: \`.vibecoder/mcp.example.json\`

---

## 📚 Документация

- Полный гайд: [README.md](https://github.com/igor1000rr/vibecoder-/blob/main/README.md)
- Тесты и setup: [SETUP.md](https://github.com/igor1000rr/vibecoder-/blob/main/SETUP.md)
- Issues: https://github.com/igor1000rr/vibecoder-/issues

---

**Vibecoder v0.1.0 alpha** · Built on Void & VS Code OSS · Apache 2.0

Закрой эту вкладку и начни кодить.
`;
}
