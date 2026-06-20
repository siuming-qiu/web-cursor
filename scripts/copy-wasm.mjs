/**
 * [INPUT]: node_modules/esbuild-wasm/esbuild.wasm
 * [OUTPUT]: public/esbuild.wasm
 * [POS]: 构建前置 —— 把 esbuild 的 wasm 自托管到 public/，转译层用 wasmURL='/esbuild.wasm' 加载
 * [PROTOCOL]: esbuild-wasm 版本变更时，wasm 会随之更新；版本必须和 package.json 里的 esbuild-wasm 严格一致
 */
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';

const src = 'node_modules/esbuild-wasm/esbuild.wasm';
const dest = 'public/esbuild.wasm';

try {
  await access(src);
} catch {
  console.warn('[copy-wasm] 源文件不存在（还没 npm install？）：' + src);
  process.exit(0);
}

await mkdir(dirname(dest), { recursive: true });
await copyFile(src, dest);
console.log('[copy-wasm] ok -> ' + dest);
