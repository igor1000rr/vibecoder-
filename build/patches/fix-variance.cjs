/*---------------------------------------------------------------------------------------------
 *  vibecoder/types-node-compat: Патч TS lib + @types/node для совместимости с TS 5.8 + node 22.19.
 *  Запускается из .github/workflows/build-windows.yml ПЕРЕД компиляцией.
 *
 *  Проблема: TS 5.8 + lib.*.d.ts 2025+ сузили BlobPart, BufferSource, FileSystemWriteChunkType,
 *  AllowSharedBufferSource, GPUAllowSharedBufferSource через ArrayBufferView<ArrayBuffer>
 *  (исключая SharedArrayBuffer). @types/node 22.19 объявил Buffer extends Uint8Array<ArrayBufferLike>.
 *  Это ломает 25+ мест в VS Code OSS 1.99 + extensions где Buffer/Uint8Array/Float32Array
 *  передаются в Blob/FileSystemWriteChunk/GPUBuffer/Crypto API.
 *
 *  Важно: разные extensions используют разные lib.*.d.ts (dom, webworker, dom.iterable),
 *  поэтому 5 type aliases применяются ко ВСЕМ lib.*.d.ts, а не только lib.dom.d.ts.
 *
 *  Стратегия:
 *    1. Все node_modules/typescript/lib/lib.*.d.ts → 5 проблемных типов становятся `any`.
 *    2. @types/node/buffer.d.ts → Buffer extends Uint8Array<ArrayBuffer>.
 *    3. Глобальная замена `<ArrayBufferLike>` → `<ArrayBuffer>` во всех .d.ts TS+@types/node.
 *--------------------------------------------------------------------------------------------*/
const fs = require('fs');
const path = require('path');

// 5 type aliases которые надо превратить в `any` во всех lib.*.d.ts
const TYPE_ALIASES_TO_ANY = [
	{
		regex: /type BlobPart = [^;]+;/g,
		replacement: 'type BlobPart = any;',
		name: 'BlobPart'
	},
	{
		regex: /type BufferSource = [^;]+;/g,
		replacement: 'type BufferSource = any;',
		name: 'BufferSource'
	},
	{
		regex: /type FileSystemWriteChunkType = [^;]+;/g,
		replacement: 'type FileSystemWriteChunkType = any;',
		name: 'FileSystemWriteChunkType'
	},
	// GPUAllowSharedBufferSource ДО AllowSharedBufferSource (lookbehind ниже подстраховывает)
	{
		regex: /type GPUAllowSharedBufferSource = [^;]+;/g,
		replacement: 'type GPUAllowSharedBufferSource = any;',
		name: 'GPUAllowSharedBufferSource'
	},
	{
		regex: /(?<!GPU)type AllowSharedBufferSource = [^;]+;/g,
		replacement: 'type AllowSharedBufferSource = any;',
		name: 'AllowSharedBufferSource'
	},
];

let libFilesPatched = 0;
let libReplacements = 0;

// 1. Патч всех node_modules/typescript/lib/lib.*.d.ts — 5 type aliases на `any`
const tsLibDir = path.resolve('node_modules/typescript/lib');
console.log(`=== Patching ${tsLibDir}/lib.*.d.ts (5 type aliases) ===`);
if (fs.existsSync(tsLibDir)) {
	const libFiles = fs.readdirSync(tsLibDir).filter(f => f.startsWith('lib.') && f.endsWith('.d.ts'));
	for (const f of libFiles) {
		const p = path.join(tsLibDir, f);
		const original = fs.readFileSync(p, 'utf8');
		let content = original;
		const hits = [];
		for (const { regex, replacement, name } of TYPE_ALIASES_TO_ANY) {
			const before = content;
			content = content.replace(regex, replacement);
			if (before !== content) {
				hits.push(name);
				libReplacements++;
			}
		}
		if (content !== original) {
			fs.writeFileSync(p, content);
			libFilesPatched++;
			console.log(`  [+] ${f}: ${hits.join(', ')}`);
		}
	}
	console.log(`  Файлов изменено: ${libFilesPatched}, замен всего: ${libReplacements}`);
} else {
	console.error(`ОШИБКА: ${tsLibDir} не найдена`);
	process.exit(1);
}

// 2. Патч @types/node/buffer.d.ts — Buffer extends Uint8Array<ArrayBuffer>
const bufferDts = path.resolve('node_modules/@types/node/buffer.d.ts');
console.log(`\n=== Patching ${bufferDts} ===`);
let bufferPatched = false;
if (fs.existsSync(bufferDts)) {
	const original = fs.readFileSync(bufferDts, 'utf8');
	let content = original;
	content = content.replace(/extends Uint8Array<ArrayBufferLike>/g, 'extends Uint8Array<ArrayBuffer>');
	content = content.replace(/class Buffer extends Uint8Array \{/g, 'class Buffer extends Uint8Array<ArrayBuffer> {');
	content = content.replace(/interface Buffer extends Uint8Array \{/g, 'interface Buffer extends Uint8Array<ArrayBuffer> {');
	if (content !== original) {
		fs.writeFileSync(bufferDts, content);
		bufferPatched = true;
		console.log('  [+] Buffer extends Uint8Array → <ArrayBuffer>');
	} else {
		console.log('  [noop] паттерны не найдены');
	}
} else {
	console.warn(`  [skip] файл не найден`);
}

// 3. Глобальная замена `<ArrayBufferLike>` → `<ArrayBuffer>` во всех .d.ts
//    из node_modules/typescript/lib и node_modules/@types/node
console.log(`\n=== Global <ArrayBufferLike> → <ArrayBuffer> ===`);
const globalTargets = [
	'node_modules/typescript/lib',
	'node_modules/@types/node',
];
let globalPatched = 0;
for (const dir of globalTargets) {
	const fullDir = path.resolve(dir);
	if (!fs.existsSync(fullDir)) continue;
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
				}
			}
		}
	}
}
console.log(`  Файлов изменено: ${globalPatched}`);

console.log(`\n=== ИТОГО ===`);
console.log(`lib.*.d.ts (5 type aliases): ${libFilesPatched} файлов, ${libReplacements} замен`);
console.log(`buffer.d.ts: ${bufferPatched ? 'OK' : 'noop'}`);
console.log(`<ArrayBufferLike> глобально: ${globalPatched} файлов`);

if (libFilesPatched === 0 && globalPatched === 0 && !bufferPatched) {
	console.error('ОШИБКА: ни один файл не был изменён — проверь регексы и пути');
	process.exit(1);
}
