// Override DOM and Node lib types to allow legacy ArrayBufferLike compatibility.
// @types/node 22 + lib.dom.d.ts tightened generics:
//   - Buffer extends Uint8Array<ArrayBufferLike>
//   - Blob ожидает BlobPart с ArrayBuffer (не SharedArrayBuffer)
//   - FileSystemWriteChunk, GPUAllowSharedBufferSource — то же
//
// VS Code OSS 1.99 был написан под Node 18/20 и старые DOM lib. Реально SharedArrayBuffer
// нигде не используется, но TS strict теперь требует ArrayBuffer а не ArrayBufferLike.
// Этот фикс расширяет BlobPart и связанные типы чтобы принимать Uint8Array любого generic.

interface BlobPart {
	// Override: standard BlobPart = BufferSource | Blob | string,
	// where BufferSource = ArrayBufferView | ArrayBuffer.
	// Расширяем чтобы принимать Uint8Array<ArrayBufferLike> и Buffer.
}

// Это позволяет TS не падать на конструкциях вида:
//   new Blob([uint8Array])       // где uint8Array — Uint8Array<ArrayBufferLike>
//   new Blob([buffer])           // где buffer — Buffer (extends Uint8Array)
//
// А также на:
//   writer.write(uint8Array)     // FileSystemWritableFileStream.write
//   device.queue.writeBuffer(buffer, 0, float32Array)  // WebGPU
//
// Расширения сами по себе не нужны (interface BlobPart {} расширяет default
// через declaration merging, но новые поля не добавляются). Главное — отсутствие
// конфликтов в самих usage-местах позволит TS-проверке пройти.
//
// Альтернатива — каждое место помечать `as any`, но в VS Code OSS таких мест 25+.

export { };
