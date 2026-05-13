/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Простой markdown-рендерер для NIT chat.
 *
 * Поддерживает:
 *   - Code blocks ```lang\n...\n```
 *   - Inline code `text`
 *   - Bold **text**
 *   - Italic *text* (single asterisks; не путаем с list-маркерами)
 *   - Headers # ## ###
 *   - Unordered list (- item, * item)
 *   - Links [text](url)
 *
 * БЕЗОПАСНОСТЬ: только createElement + textContent. Никакого innerHTML.
 * Trusted Types compatible — работает в VS Code OSS workbench.
 *
 * NOT поддерживает (преднамеренно):
 *   - HTML inline tags
 *   - Tables (редко в чат-ответах)
 *   - Nested lists
 *   - Blockquotes
 *   - Footnotes
 *
 * Для длинных стримящихся ответов: вызывай только в финале (после 'finished'),
 * не на каждом text-чанке — это перестроит весь DOM, для длинного сообщения
 * будет медленно.
 */

type Block =
	| { type: 'paragraph'; content: string }
	| { type: 'code'; lang: string; content: string }
	| { type: 'header'; level: number; content: string }
	| { type: 'list'; items: string[] };

/**
 * Очищает container и рендерит markdown как дерево DOM.
 */
export function renderMarkdownInto(container: HTMLElement, markdown: string): void {
	while (container.firstChild) {
		container.removeChild(container.firstChild);
	}

	const blocks = parseBlocks(markdown);
	for (const block of blocks) {
		renderBlock(container, block);
	}
}

function parseBlocks(markdown: string): Block[] {
	const blocks: Block[] = [];
	const lines = markdown.split('\n');
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Code block ```lang ... ```
		const codeMatch = line.match(/^```(\w*)\s*$/);
		if (codeMatch) {
			const lang = codeMatch[1] || '';
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !/^```/.test(lines[i])) {
				codeLines.push(lines[i]);
				i++;
			}
			if (i < lines.length) { i++; } // skip closing ```
			blocks.push({ type: 'code', lang, content: codeLines.join('\n') });
			continue;
		}

		// Header (# - ###)
		const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
		if (headerMatch) {
			blocks.push({ type: 'header', level: headerMatch[1].length, content: headerMatch[2] });
			i++;
			continue;
		}

		// Unordered list (- item / * item)
		if (/^[\-\*]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^[\-\*]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^[\-\*]\s+/, ''));
				i++;
			}
			blocks.push({ type: 'list', items });
			continue;
		}

		// Empty line — skip
		if (line.trim() === '') {
			i++;
			continue;
		}

		// Paragraph (до пустой строки или специального блока)
		const paraLines: string[] = [];
		while (
			i < lines.length &&
			lines[i].trim() !== '' &&
			!/^```/.test(lines[i]) &&
			!/^#{1,3}\s/.test(lines[i]) &&
			!/^[\-\*]\s+/.test(lines[i])
		) {
			paraLines.push(lines[i]);
			i++;
		}
		if (paraLines.length > 0) {
			blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
		}
	}

	return blocks;
}

function renderBlock(container: HTMLElement, block: Block): void {
	switch (block.type) {
		case 'code': {
			const wrapper = document.createElement('div');
			wrapper.style.cssText = 'margin: 6px 0; border-radius: 3px; overflow: hidden; border: 1px solid var(--vscode-panel-border);';

			if (block.lang) {
				const langBadge = document.createElement('div');
				langBadge.textContent = block.lang;
				langBadge.style.cssText = 'font-size: 10px; padding: 2px 8px; background: var(--vscode-editorGroupHeader-tabsBackground); color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); letter-spacing: 0.5px; border-bottom: 1px solid var(--vscode-panel-border);';
				wrapper.appendChild(langBadge);
			}

			const pre = document.createElement('pre');
			pre.style.cssText = 'margin: 0; padding: 8px 10px; background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.4; overflow-x: auto; white-space: pre;';
			const code = document.createElement('code');
			code.textContent = block.content;
			pre.appendChild(code);
			wrapper.appendChild(pre);
			container.appendChild(wrapper);
			return;
		}
		case 'header': {
			// h3 для #, h4 для ##, h5 для ### (h1/h2 слишком крупные для чата)
			const tagName = `h${Math.min(block.level + 2, 6)}`;
			const h = document.createElement(tagName);
			h.style.cssText = 'margin: 10px 0 4px 0; line-height: 1.3;';
			if (block.level === 1) { h.style.fontSize = '15px'; }
			else if (block.level === 2) { h.style.fontSize = '14px'; }
			else { h.style.fontSize = '13px'; }
			renderInlineInto(h, block.content);
			container.appendChild(h);
			return;
		}
		case 'list': {
			const ul = document.createElement('ul');
			ul.style.cssText = 'margin: 4px 0; padding-left: 20px;';
			for (const item of block.items) {
				const li = document.createElement('li');
				li.style.marginBottom = '2px';
				renderInlineInto(li, item);
				ul.appendChild(li);
			}
			container.appendChild(ul);
			return;
		}
		case 'paragraph': {
			const p = document.createElement('div');
			p.style.cssText = 'margin: 0 0 6px 0;';
			renderInlineInto(p, block.content);
			container.appendChild(p);
			return;
		}
	}
}

interface InlineToken {
	start: number;
	end: number;
	type: 'code' | 'bold' | 'italic' | 'link';
	data: string | { text: string; url: string };
}

function overlapsAny(tokens: InlineToken[], start: number, end: number): boolean {
	return tokens.some(t => !(end <= t.start || start >= t.end));
}

function renderInlineInto(container: HTMLElement, text: string): void {
	const tokens: InlineToken[] = [];

	// 1. Inline code (highest priority — внутри не парсим)
	for (const m of text.matchAll(/`([^`\n]+)`/g)) {
		if (m.index === undefined) { continue; }
		tokens.push({ start: m.index, end: m.index + m[0].length, type: 'code', data: m[1] });
	}

	// 2. Links [text](url)
	for (const m of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
		if (m.index === undefined) { continue; }
		const end = m.index + m[0].length;
		if (overlapsAny(tokens, m.index, end)) { continue; }
		tokens.push({ start: m.index, end, type: 'link', data: { text: m[1], url: m[2] } });
	}

	// 3. Bold **text**
	for (const m of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
		if (m.index === undefined) { continue; }
		const end = m.index + m[0].length;
		if (overlapsAny(tokens, m.index, end)) { continue; }
		tokens.push({ start: m.index, end, type: 'bold', data: m[1] });
	}

	// 4. Italic *text* (одна звезда, не пустая, не с пробелами по краям)
	for (const m of text.matchAll(/\*([^\s*][^*\n]*[^\s*]|[^\s*])\*/g)) {
		if (m.index === undefined) { continue; }
		const end = m.index + m[0].length;
		if (overlapsAny(tokens, m.index, end)) { continue; }
		tokens.push({ start: m.index, end, type: 'italic', data: m[1] });
	}

	// Сортируем по позиции
	tokens.sort((a, b) => a.start - b.start);

	// Рендерим: plain text + токены
	let pos = 0;
	for (const token of tokens) {
		if (token.start > pos) {
			container.appendChild(document.createTextNode(text.slice(pos, token.start)));
		}
		switch (token.type) {
			case 'code': {
				const el = document.createElement('code');
				el.style.cssText = 'background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); padding: 1px 5px; border-radius: 2px; font-family: var(--vscode-editor-font-family); font-size: 0.92em;';
				el.textContent = token.data as string;
				container.appendChild(el);
				break;
			}
			case 'bold': {
				const el = document.createElement('strong');
				el.textContent = token.data as string;
				container.appendChild(el);
				break;
			}
			case 'italic': {
				const el = document.createElement('em');
				el.textContent = token.data as string;
				container.appendChild(el);
				break;
			}
			case 'link': {
				const linkData = token.data as { text: string; url: string };
				const el = document.createElement('a');
				el.textContent = linkData.text;
				el.style.color = 'var(--vscode-textLink-foreground)';
				el.style.cursor = 'pointer';
				el.style.textDecoration = 'none';
				// Не используем href напрямую — Trusted Types может ругаться.
				// Просто хранимый url + click handler (через openerService нельзя
				// здесь, нет доступа — но click открывает window.open).
				const url = linkData.url;
				el.title = url;
				el.addEventListener('click', e => {
					e.preventDefault();
					try {
						window.open(url, '_blank');
					} catch {
						// игнор
					}
				});
				el.addEventListener('mouseenter', () => { el.style.textDecoration = 'underline'; });
				el.addEventListener('mouseleave', () => { el.style.textDecoration = 'none'; });
				container.appendChild(el);
				break;
			}
		}
		pos = token.end;
	}
	if (pos < text.length) {
		container.appendChild(document.createTextNode(text.slice(pos)));
	}
}
