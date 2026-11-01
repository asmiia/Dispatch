// Speech to text that runs inside the browser, so it works in every browser and in the desktop app and no
// audio ever leaves your computer. The model downloads once (about 40 MB) and is cached.
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
// Several threads when the page allows it (it is cross-origin isolated); one otherwise.
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
env.backends.onnx.wasm.wasmPaths = {
  mjs: "/ort/ort-wasm-simd-threaded.asyncify.mjs",
  wasm: "/ort/ort-wasm-simd-threaded.asyncify.wasm",
};

let asr = null;
const send = (m) => self.postMessage(m);

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      if (!asr)
        asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
          dtype: "q8",
          device: "wasm",
          progress_callback: (p) => {
            if (p.status === "progress" && p.total) send({ type: "progress", file: p.file, progress: p.loaded / p.total });
          },
        });
      send({ type: "ready" });
    } else if (data.type === "run") {
      const out = await asr(data.audio, { chunk_length_s: 30 });
      send({ type: "text", id: data.id, text: (out.text || "").trim() });
    }
  } catch (e) {
    send({ type: "error", id: data.id, message: String(e?.message || e) });
  }
};
