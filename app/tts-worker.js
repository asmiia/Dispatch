// A natural-sounding voice that runs in this browser (Kokoro, 82M parameters). The model downloads once
// (about 90 MB) and is cached; until it is ready the browser's own voice is used.
import { StyleTextToSpeech2Model, AutoTokenizer, Tensor, env } from "@huggingface/transformers";
import { phonemize } from "phonemizer";

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: "/ort/ort-wasm-simd-threaded.asyncify.mjs",
  wasm: "/ort/ort-wasm-simd-threaded.asyncify.wasm",
};

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let model = null,
  tokenizer = null;
const styles = new Map();
const send = (m, transfer) => self.postMessage(m, transfer || []);

async function voiceStyle(name) {
  if (styles.has(name)) return styles.get(name);
  const url = `https://huggingface.co/${MODEL}/resolve/main/voices/${name}.bin`;
  let buffer;
  try {
    const cache = await caches.open("kokoro-voices"),
      hit = await cache.match(url);
    if (hit) buffer = await hit.arrayBuffer();
    else {
      const res = await fetch(url);
      buffer = await res.arrayBuffer();
      await cache.put(url, new Response(buffer.slice(0)));
    }
  } catch {
    buffer = await (await fetch(url)).arrayBuffer();
  }
  const data = new Float32Array(buffer);
  styles.set(name, data);
  return data;
}

// Text becomes the phonemes the model reads.
async function phonemes(text) {
  const clean = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const parts = await phonemize(clean, "en-us");
  return parts
    .join(" ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .trim();
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      if (!model) {
        const progress_callback = (p) => {
          if (p.status === "progress" && p.total) send({ type: "progress", file: p.file, progress: p.loaded / p.total });
        };
        [model, tokenizer] = await Promise.all([
          StyleTextToSpeech2Model.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback }),
          AutoTokenizer.from_pretrained(MODEL, { progress_callback }),
        ]);
        await voiceStyle("af_heart");
      }
      send({ type: "ready" });
    } else if (data.type === "say") {
      const ph = await phonemes(data.text),
        { input_ids } = tokenizer(ph, { truncation: true }),
        offset = 256 * Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509),
        style = (await voiceStyle(data.voice || "af_heart")).slice(offset, offset + 256),
        { waveform } = await model({
          input_ids,
          style: new Tensor("float32", style, [1, 256]),
          speed: new Tensor("float32", [data.speed || 1], [1]),
        }),
        audio = new Float32Array(waveform.data);
      send({ type: "audio", id: data.id, audio, rate: 24000 }, [audio.buffer]);
    }
  } catch (e) {
    send({ type: "error", id: data.id, message: String(e?.message || e) });
  }
};
