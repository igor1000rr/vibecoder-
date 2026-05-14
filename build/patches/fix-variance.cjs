/*---------------------------------------------------------------------------------------------
 *  vibecoder/types-node-compat: Патч TS/lib.dom + @types/node для совместимости с TS 5.8 + node 22.19.
 *  Запускается из .github/workflows/build-windows.yml ПЕРЕД компиляцией.
 *
 *  Проблема: TS 5.8 + lib.dom 2025+ сузили BlobPart, BufferSource, FileSystemWriteChunkType,
 *  AllowSharedBufferSource, GPUAllowSharedBufferSource через ArrayBufferView<ArrayBuffer>
 *  (исключая SharedArrayBuffer). @types/node 22.19 объявил Buffer extends Uint8Array<ArrayBufferLike>.
 *  Это ломает 25+ мест в VS Code OSS 1.99 + extensions где Buffer/Uint8Array/Float32Array
 *  передаются в Blob/FileSystemWriteChunk/GPUBuffer/Crypto API.
 *
 *  Стратегия:
 *    1. lib.dom.d.ts → 5 проблемных типов становятся `any`.
 *    2. @types/node/buffer.d.ts → Buffer extends Uint8Array<ArrayBuffer>.
 *    3. node_modules/typescript/lib/lib.*.d.ts и @types/node — глобальная замена
 *       `<ArrayBufferLike>` → `<ArrayBuffer>` чтобы убрать SharedArrayBuffer вариантность.
 *--------------------------------------------------------------------------------------------*/
const fs = require('fs');
const path = require('path');

let totalPatched = 0;
let totalChecked = 0;

function patchFile(filePath, patches, label) {
	if (!fs.existsSync(filePath)) {
		console.warn(`[skip] ${label}: файл не найден ${filePath}`);
		return false;
	}
	totalChecked++;
	const original = fs.readFileSync(filePath, 'utf8');
	let content = original;
	let changes = 0;
	for (const { regex, replacement, name } of patches) {
		const before = content;
		content = content.replace(regex, replacement);
		if (before !== content) {
			changes++;
			console.log(`  [+] ${name}`);
		} else {
			console.log(`  [-] ${name} (no match)`);
		}
	}
	if (content !== original) {
		fs.writeFileSync(filePath, content);
		totalPatched++;
		console.log(`[ok] ${label}: ${changes} замен`);
		return true;
	}
	console.log(`[noop] ${label}: ничего не изменилось`);
	return false;
}

// 1. Патч lib.dom.d.ts — 5 типов на `any`
const libDom = path.resolve('node_modules/typescript/lib/lib.dom.d.ts');
console.log(`=== Patching ${libDom} ===`);
patchFile(libDom, [
	{
		regex: /type BlobPart = [^;]+;/g,
		replacement: 'type BlobPart = any;',
		name: 'BlobPart → any'
	},
	{
		regex: /type BufferSource = [^;]+;/g,
		replacement: 'type BufferSource = any;',
		name: 'BufferSource → any'
	},
	{
		regex: /type FileSystemWriteChunkType = [^;]+;/g,
		replacement: 'type FileSystemWriteChunkType = any;',
		name: 'FileSystemWriteChunkType → any'
	},
	// GPUAllowSharedBufferSource должен быть ДО AllowSharedBufferSource,
	// иначе regex /type AllowSharedBufferSource = .../ съест начало "GPU..."
	{
		regex: /type GPUAllowSharedBufferSource = [^;]+;/g,
		replacement: 'type GPUAllowSharedBufferSource = any;',
		name: 'GPUAllowSharedBufferSource → any'
	},
	{
		regex: /(?<!GPU)type AllowSharedBufferSource = [^;]+;/g,
		replacement: 'type AllowSharedBufferSource = any;',
		name: 'AllowSharedBufferSource → any'
	},
], 'lib.dom.d.ts (5 типов)');

// 2. Патч @types/node/buffer.d.ts — Buffer extends Uint8Array<ArrayBuffer>
const bufferDts = path.resolve('node_modules/@types/node/buffer.d.ts');
console.log(`\n=== Patching ${bufferDts} ===`);
patchFile(bufferDts, [
	{
		regex: /extends Uint8Array<ArrayBufferLike>/g,
		replacement: 'extends Uint8Array<ArrayBuffer>',
		name: 'Buffer extends Uint8Array<ArrayBufferLike> → <ArrayBuffer>'
	},
	{
		regex: /class Buffer extends Uint8Array \{/g,
		replacement: 'class Buffer extends Uint8Array<ArrayBuffer> {',
		name: 'class Buffer extends Uint8Array (bare) → <ArrayBuffer>'
	},
	{
		regex: /interface Buffer extends Uint8Array \{/g,
		replacement: 'interface Buffer extends Uint8Array<ArrayBuffer> {',
		name: 'interface Buffer extends Uint8Array (bare) → <ArrayBuffer>'
	},
], 'buffer.d.ts');

// 3. Глобальная замена `<ArrayBufferLike>` → `<ArrayBuffer>` во всех lib.*.d.ts TypeScript
//    и @types/node/*.d.ts. Это убирает SharedArrayBuffer из union'ов.
console.log(`\n=== Global <ArrayBufferLike> → <ArrayBuffer> ===`);
const globalTargets = [
	'node_modules/typescript/lib',
	'node_modules/@types/node',
];
let globalPatched = 0;
for (const dir of globalTargets) {
	const fullDir = path.resolve(dir);
	if (!fs.existsSync(fullDir)) {
		console.warn(`[skip] dir не найдена: ${fullDir}`);
		continue;
	}
	const stack = [fullDir];
	while (stack.length) {
		const cur = stack.pop();
		const entries = fs.readdirSync(cur, { withFileTypes: true });
		for (const e of entries) {
			const p = path.join(cur, e.name);
			if (e.isDirectory()) {
				stack.push(p);
			} else if (e.isFile() && p.endsWith('.d.ts')) {
				const c = fs.readFileSync(p, 'utf8');
				if (!c.includes('<ArrayBufferLike>')) continue;
				const c2 = c.replace(/<ArrayBufferLike>/g, '<ArrayBuffer>');
				if (c2 !== c) {
					fs.writeFileSync(p, c2);
					globalPatched++;
					console.log(`  [+] ${path.relative(process.cwd(), p)}`);
				}
			}
		}
	}
}
console.log(`Глобальная замена: ${globalPatched} файлов`);

console.log(`\n=== ИТОГО ===`);
console.log(`Проверено таргетных файлов: ${totalChecked}`);
console.log(`Пропатчено таргетных файлов: ${totalPatched}`);
console.log(`Пропатчено через глобальную замену: ${globalPatched}`);

if (totalPatched === 0 && globalPatched === 0) {
	console.error('ОШИБКА: ни один файл не был изменён — проверь регексы и пути');
	process.exit(1);
}
