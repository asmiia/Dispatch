// Copies the speech engine's WebAssembly files next to the app so the browser never loads them from a third party.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
const from = "node_modules/onnxruntime-web/dist/",
  to = "public/ort/";
mkdirSync(to, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"])
  if (existsSync(from + f)) copyFileSync(from + f, to + f);
console.log("speech engine files copied to " + to);
