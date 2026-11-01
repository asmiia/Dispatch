// Reads agent speech aloud. Uses a natural voice that runs in this browser once it has downloaded, and
// the browser's own voice until then (or if the natural one cannot run here).
// People can pick the quick built-in voice instead (it speaks at once but sounds more mechanical).
const quick = () => {
  try {
    return localStorage.getItem("dispatch-voice") === "system";
  } catch {
    return false;
  }
};
export const setQuickVoice = (on) => {
  try {
    localStorage.setItem("dispatch-voice", on ? "system" : "natural");
  } catch {}
};
export const quickVoice = quick;

let sinkId = "";
export function setOutput(id) {
  sinkId = id || "";
  ctx?.setSinkId?.(sinkId).catch(() => {});
}

let worker = null,
  state = "idle", // idle | loading | ready | failed
  ctx = null,
  next = 0;
const waiting = new Map();
let queue = Promise.resolve();

function boot() {
  if (worker || state === "failed" || quick()) return;
  state = "loading";
  worker = new Worker(new URL("./tts-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "ready") {
      state = "ready";
      console.info("natural voice ready");
    }
    else if (data.type === "audio") waiting.get(data.id)?.resolve(data);
    else if (data.type === "error") {
      if (data.id === undefined) fail(new Error(data.message));
      else waiting.get(data.id)?.reject(new Error(data.message));
    }
  };
  worker.onerror = fail;
  worker.postMessage({ type: "load" });
}
function fail(e) {
  console.warn("natural voice unavailable:", e?.message || e?.type || e);
  state = "failed";
  worker?.terminate();
  worker = null;
  for (const w of waiting.values()) w.reject(new Error("voice failed"));
  waiting.clear();
}

// Pick the nicest voice the browser offers for the fallback.
function systemVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  const rank = (v) =>
    (/natural|neural|online/i.test(v.name) ? 100 : 0) +
    (/google/i.test(v.name) ? 40 : 0) +
    (/aria|jenny|zira|samantha|ava|allison|serena|karen/i.test(v.name) ? 20 : 0) +
    (/en-US/i.test(v.lang) ? 5 : 0);
  return voices.sort((a, b) => rank(b) - rank(a))[0] || null;
}
function speakSystem(text, onStart) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text),
      v = systemVoice();
    if (v) u.voice = v;
    u.rate = 1.05;
    u.onstart = () => onStart?.();
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// Ask the voice for a sentence now; resolves with the audio when it is made.
function generate(text) {
  const id = ++next;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ type: "say", id, text });
  }).finally(() => waiting.delete(id));
}
async function play(got, onStart) {
  if (!ctx) {
    ctx = new AudioContext();
    if (sinkId) ctx.setSinkId?.(sinkId).catch(() => {});
  }
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const buffer = ctx.createBuffer(1, got.audio.length, got.rate);
  buffer.copyToChannel(got.audio, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  await new Promise((resolve) => {
    src.onended = resolve;
    onStart?.();
    src.start();
  });
}

// Start downloading the natural voice ahead of time, so the first thing an agent says already uses it.
export const warm = () => boot();

// Short pieces make sound sooner: a sentence, or the first part of a long one.
function pieces(text) {
  const out = [];
  for (const s of text.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) || [text]) {
    const words = s.split(/\s+/);
    if (words.length > 14 && /,/.test(s)) {
      const at = s.indexOf(",", 20);
      if (at > 0 && at < s.length - 12) {
        out.push(s.slice(0, at + 1), s.slice(at + 1).trim());
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

// Say one line. Lines are read one after another.
export function speak(text, { onStart, muted } = {}) {
  boot();
  const parts = pieces(text);
  // With the natural voice ready, every piece starts being made at once and plays as soon as it is done.
  const made = state === "ready" && !quick() ? parts.map((p) => generate(p).catch(() => null)) : [];
  queue = queue.then(async () => {
    for (let i = 0; i < parts.length; i++) {
      if (muted?.()) return;
      const got = made[i] ? await made[i] : null;
      if (got) await play(got, onStart);
      else await speakSystem(parts[i], onStart);
    }
  });
  return queue;
}
