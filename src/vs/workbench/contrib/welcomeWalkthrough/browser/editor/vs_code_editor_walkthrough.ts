/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from '../../../../../base/common/platform.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';

export default function content(accessor: ServicesAccessor) {
	const isServerless = platform.isWeb && !accessor.get(IWorkbenchEnvironmentService).remoteAuthority;
	void isServerless;
	return `
## Vibecoder Editor Playground

Vibecoder — AI-first IDE с упором на локальные LLM (LM Studio) и опциональные облачные модели (Anthropic, OpenAI, Gemini, OpenRouter) через встроенный прокси. Эта страница — обычный редактор, всё что ты тут видишь можно интерактивно менять.

* [Multi-cursor](#multi-cursor) — несколько курсоров одновременно
* [IntelliSense](#intellisense) — автодополнение
* [Line Actions](#line-actions) — быстрые операции со строками
* [Rename](#rename) — переименовать символ во всём проекте
* [Formatting](#formatting) — форматирование
* [Code Folding](#code-folding) — свёртка блоков
* [Snippets](#snippets) — сниппеты
* [Emmet](#emmet) — Emmet для HTML/CSS

### Multi-Cursor

1. Box Selection — зажми <span class="shortcut mac-only">|⇧⌥|</span><span class="shortcut windows-only linux-only">|Shift+Alt|</span> + drag мышью.
2. Добавить курсор сверху/снизу — kb(editor.action.insertCursorAbove) / kb(editor.action.insertCursorBelow).
3. Выделить все вхождения строки — выдели одну, потом kb(editor.action.selectHighlights).

|||css
#p1 {background-color: #ff0000;}
#p2 {background-color: hsl(120, 100%, 50%);}
#p3 {background-color: rgba(0, 4, 255, 0.733);}
|||

### IntelliSense

Поставь курсор после точки и нажми kb(editor.action.triggerSuggest):

|||js
const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');

context.strokeStyle = 'blue';
context.
|||

### Line Actions

1. Скопировать строку вверх/вниз — kb(editor.action.copyLinesDownAction) / kb(editor.action.copyLinesUpAction).
2. Переместить строку — kb(editor.action.moveLinesUpAction) / kb(editor.action.moveLinesDownAction).
3. Удалить строку — kb(editor.action.deleteLines).

|||json
{
\t"name": "John",
\t"age": 31,
\t"city": "New York"
}
|||

### Rename

Курсор на |Book|, kb(editor.action.rename) — переименовать символ во всём проекте.

|||js
new Book("War of the Worlds", "H G Wells");
new Book("The Martian", "Andy Weir");

function Book(title, author) {
\tthis.title = title;
\tthis.author = author;
}
|||

### Formatting

kb(editor.action.formatDocument) — форматировать весь документ. kb(editor.action.formatSelection) — только выделение.

|||js
const cars = ["🚗", "🚙", "🚕"];

for (const carItem of cars){
\tconsole.log("This is the car " + carItem);
}
|||

### Code Folding

Сверни блок: стрелка слева от номера строки или kb(editor.fold). Развернуть — kb(editor.unfold). Свернуть всё — kb(editor.foldAll).

|||html
<div>
\t<header>
\t\t<ul>
\t\t\t<li><a href=""></a></li>
\t\t\t<li><a href=""></a></li>
\t\t</ul>
\t</header>
\t<footer>
\t\t<p></p>
\t</footer>
</div>
|||

### Snippets

Начни печатать |try| в JS-блоке ниже, выбери |trycatch|, нажми kb(insertSnippet) — получишь готовый try/catch.

|||js

|||

### Emmet

В HTML-файле напечатай |ul>li.item$*5| и нажми Tab — получишь раскрытие.

|||html
ul>li.item$*5
|||

---

AI-фичи (composer, чат, autocomplete, MCP, skills) появятся в ближайших версиях. Следить за прогрессом — [github.com/igor1000rr/vibecoder-](https://github.com/igor1000rr/vibecoder-).

Happy vibe coding! 🎉

`.replace(/\|/g, '\`');
}
