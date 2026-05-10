#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Генератор иконок Vibecoder из SVG-исходника.
 *
 * Использование:
 *   node resources/vibecoder/generate-icons.js
 *
 * Из resources/vibecoder/icon.svg создаёт:
 *   resources/win32/code.ico                 (16, 24, 32, 48, 64, 128, 256)
 *   resources/win32/code_70x70.png
 *   resources/win32/code_150x150.png
 *   resources/server/favicon.ico             (16, 32, 48)
 *   resources/server/code-192.png
 *   resources/server/code-512.png
 *
 * Зависимости: sharp + png-to-ico
 *   npm install --save-dev sharp png-to-ico
 *
 * Если sharp не ставится на Windows (нужен Visual Studio) — есть fallback
 * вариант через @resvg/resvg-js (чистый Rust бинарь без нативной сборки).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SVG = path.resolve(__dirname, 'icon.svg');

const OUTPUTS = {
	win32: path.join(ROOT, 'resources', 'win32'),
	server: path.join(ROOT, 'resources', 'server'),
};

async function loadRenderer() {
	// Пробуем sharp (нативный, быстрый)
	try {
		const sharp = require('sharp');
		return {
			name: 'sharp',
			async render(svgBuffer, size) {
				return sharp(svgBuffer).resize(size, size).png().toBuffer();
			},
		};
	} catch (e) {
		console.log('[icons] sharp недоступен:', e.message);
	}

	// Fallback: @resvg/resvg-js (чистый Rust)
	try {
		const { Resvg } = require('@resvg/resvg-js');
		return {
			name: 'resvg-js',
			async render(svgBuffer, size) {
				const resvg = new Resvg(svgBuffer, { fitTo: { mode: 'width', value: size } });
				return resvg.render().asPng();
			},
		};
	} catch (e) {
		console.log('[icons] @resvg/resvg-js недоступен:', e.message);
	}

	throw new Error(
		'Нет ни sharp, ни @resvg/resvg-js. Поставь один из них:\n' +
		'  npm install --save-dev sharp\n' +
		'    или\n' +
		'  npm install --save-dev @resvg/resvg-js'
	);
}

async function loadIcoBuilder() {
	try {
		return require('png-to-ico');
	} catch (e) {
		throw new Error('png-to-ico не установлен. Поставь: npm install --save-dev png-to-ico');
	}
}

async function main() {
	if (!fs.existsSync(SVG)) {
		throw new Error(`SVG-исходник не найден: ${SVG}`);
	}
	const svgBuffer = fs.readFileSync(SVG);

	for (const dir of Object.values(OUTPUTS)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const renderer = await loadRenderer();
	const pngToIco = await loadIcoBuilder();
	console.log(`[icons] рендерим через ${renderer.name}`);

	const tasks = [];

	// PNG-сайты
	tasks.push((async () => {
		const png = await renderer.render(svgBuffer, 70);
		fs.writeFileSync(path.join(OUTPUTS.win32, 'code_70x70.png'), png);
		console.log('  ✓ code_70x70.png');
	})());
	tasks.push((async () => {
		const png = await renderer.render(svgBuffer, 150);
		fs.writeFileSync(path.join(OUTPUTS.win32, 'code_150x150.png'), png);
		console.log('  ✓ code_150x150.png');
	})());
	tasks.push((async () => {
		const png = await renderer.render(svgBuffer, 192);
		fs.writeFileSync(path.join(OUTPUTS.server, 'code-192.png'), png);
		console.log('  ✓ code-192.png');
	})());
	tasks.push((async () => {
		const png = await renderer.render(svgBuffer, 512);
		fs.writeFileSync(path.join(OUTPUTS.server, 'code-512.png'), png);
		console.log('  ✓ code-512.png');
	})());

	// ICO для Windows: code.ico с большим набором размеров
	tasks.push((async () => {
		const sizes = [16, 24, 32, 48, 64, 128, 256];
		const pngs = await Promise.all(sizes.map(s => renderer.render(svgBuffer, s)));
		const ico = await pngToIco(pngs);
		fs.writeFileSync(path.join(OUTPUTS.win32, 'code.ico'), ico);
		console.log(`  ✓ code.ico (${sizes.join(', ')})`);
	})());

	// favicon.ico для server: меньше размеры
	tasks.push((async () => {
		const sizes = [16, 32, 48];
		const pngs = await Promise.all(sizes.map(s => renderer.render(svgBuffer, s)));
		const ico = await pngToIco(pngs);
		fs.writeFileSync(path.join(OUTPUTS.server, 'favicon.ico'), ico);
		console.log(`  ✓ favicon.ico (${sizes.join(', ')})`);
	})());

	await Promise.all(tasks);
	console.log('[icons] готово');
}

main().catch(err => {
	console.error('[icons] ошибка:', err.message);
	process.exit(1);
});
