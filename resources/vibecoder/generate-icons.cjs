#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Vibecoder Contributors. All rights reserved.
 *  Licensed under the Apache License 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * Генератор иконок Vibecoder из SVG-исходника.
 *
 * Использование:
 *   npm install --save-dev @resvg/resvg-js png-to-ico
 *   node resources/vibecoder/generate-icons.cjs
 *
 * Расширение .cjs принудительное — в корневом package.json стоит "type": "module".
 *
 * Создаёт:
 *   resources/win32/code.ico                 (16, 24, 32, 48, 64, 128, 256)
 *   resources/win32/code_70x70.png
 *   resources/win32/code_150x150.png
 *   resources/server/favicon.ico             (16, 32, 48)
 *   resources/server/code-192.png
 *   resources/server/code-512.png
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

function loadRenderer() {
	// @resvg/resvg-js — чистый Rust-бинарь, без node-gyp/MSVC
	try {
		const { Resvg } = require('@resvg/resvg-js');
		return {
			name: 'resvg-js',
			render(svgBuffer, size) {
				const resvg = new Resvg(svgBuffer, {
					fitTo: { mode: 'width', value: size },
					background: 'rgba(0,0,0,0)',
				});
				return resvg.render().asPng();
			},
		};
	} catch (e) {
		try {
			const sharp = require('sharp');
			return {
				name: 'sharp',
				async render(svgBuffer, size) {
					return sharp(svgBuffer).resize(size, size).png().toBuffer();
				},
			};
		} catch (_) {
			throw new Error(
				'Нет ни @resvg/resvg-js, ни sharp.\n' +
				'Поставь: npm install --save-dev @resvg/resvg-js png-to-ico'
			);
		}
	}
}

/**
 * Возвращает функцию (pngs[]) => Promise<Buffer>.
 *
 * png-to-ico в разных версиях экспортирует функцию по-разному:
 *  - старые: module.exports = pngToIco
 *  - новые ESM-обёрнутые: module.exports.default = pngToIco
 *  - могут вернуть объект с методом
 */
function loadIcoBuilder() {
	let mod;
	try {
		mod = require('png-to-ico');
	} catch (e) {
		throw new Error('png-to-ico не установлен. Поставь: npm install --save-dev png-to-ico');
	}
	const candidates = [mod, mod && mod.default, mod && mod.pngToIco];
	for (const c of candidates) {
		if (typeof c === 'function') { return c; }
	}
	throw new Error('png-to-ico: не удалось найти функцию-конструктор ICO. mod=' + JSON.stringify(Object.keys(mod || {})));
}

async function main() {
	if (!fs.existsSync(SVG)) {
		throw new Error(`SVG-исходник не найден: ${SVG}`);
	}
	const svgBuffer = fs.readFileSync(SVG);

	for (const dir of Object.values(OUTPUTS)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const renderer = loadRenderer();
	const pngToIco = loadIcoBuilder();
	console.log(`[icons] рендерим через ${renderer.name}`);

	async function renderPng(size) {
		const out = renderer.render(svgBuffer, size);
		return out && typeof out.then === 'function' ? await out : out;
	}

	// PNG-сайты
	const png70 = await renderPng(70);
	fs.writeFileSync(path.join(OUTPUTS.win32, 'code_70x70.png'), png70);
	console.log('  ✓ code_70x70.png');

	const png150 = await renderPng(150);
	fs.writeFileSync(path.join(OUTPUTS.win32, 'code_150x150.png'), png150);
	console.log('  ✓ code_150x150.png');

	const png192 = await renderPng(192);
	fs.writeFileSync(path.join(OUTPUTS.server, 'code-192.png'), png192);
	console.log('  ✓ code-192.png');

	const png512 = await renderPng(512);
	fs.writeFileSync(path.join(OUTPUTS.server, 'code-512.png'), png512);
	console.log('  ✓ code-512.png');

	// ICO для Windows: code.ico с большим набором размеров
	const sizesIco = [16, 24, 32, 48, 64, 128, 256];
	const pngsIco = [];
	for (const s of sizesIco) {
		pngsIco.push(await renderPng(s));
	}
	const ico = await pngToIco(pngsIco);
	fs.writeFileSync(path.join(OUTPUTS.win32, 'code.ico'), ico);
	console.log(`  ✓ code.ico (${sizesIco.join(', ')})`);

	// favicon.ico для server: меньше размеры
	const sizesFav = [16, 32, 48];
	const pngsFav = [];
	for (const s of sizesFav) {
		pngsFav.push(await renderPng(s));
	}
	const favicon = await pngToIco(pngsFav);
	fs.writeFileSync(path.join(OUTPUTS.server, 'favicon.ico'), favicon);
	console.log(`  ✓ favicon.ico (${sizesFav.join(', ')})`);

	console.log('[icons] готово');
}

main().catch(err => {
	console.error('[icons] ошибка:', err.message);
	process.exit(1);
});
