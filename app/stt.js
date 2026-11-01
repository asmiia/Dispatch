// Turns the microphone into sentences. A simple voice detector cuts the audio into phrases at the pauses and a
// small speech model (in a worker, in this browser) writes each one down.
let worker = null,
  ready = null,
  next = 0;
const waiting = new Map();
const files = new Map();

function engine(onStatus) {
  if (worker) return ready;
  worker = new Worker(new URL("./stt-worker.js", import.meta.url), { type: "module" });
  ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        files.set(data.file, data.progress);
        const all = [...files.values()];
        onStatus?.({ loading: all.reduce((a, b) => a + b, 0) / Math.max(all.length, 1) });
      } else if (data.type === "ready") resolve();
      else if (data.type === "text") waiting.get(data.id)?.resolve(data.text);
      else if (data.type === "error") {
        if (data.id === undefined) reject(new Error(data.message));
        else waiting.get(data.id)?.reject(new Error(data.message));
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || "The speech engine could not start."));
    worker.postMessage({ type: "load" });
  });
  ready.catch(() => {
    worker?.terminate();
    worker = ready = null;
  });
  return ready;
}

const transcribe = (audio) =>
  new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ type: "run", id, audio }, [audio.buffer]);
  }).finally(() => {});

const NOISE = /^\s*(\[.*\]|\(.*\)|you\.?|thank you\.?|thanks for watching\.?|\.)\s*$/i;

// Start listening to a microphone stream. Calls onText with each finished phrase and onStatus with
// { loading }, { ready } or { error }. Returns a function that stops.
export function listen(stream, { onText, onStatus }) {
  let stopped = false,
    ctx,
    node,
    source;
  const rate = 16000;
  (async () => {
    try {
      await engine(onStatus);
      if (stopped) return;
      onStatus?.({ ready: true });
      ctx = new AudioContext({ sampleRate: rate });
      source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      node = ctx.createScriptProcessor(4096, 1, 1);
      let chunks = [],
        voiced = 0,
        quiet = 0,
        total = 0;
      const frame = (4096 / rate) * 1000;
      node.onaudioprocess = (e) => {
        const data = new Float32Array(e.inputBuffer.getChannelData(0));
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const loud = Math.sqrt(sum / data.length) > 0.012;
        if (loud) {
          voiced += frame;
          quiet = 0;
        } else quiet += frame;
        // Keep a moment of lead-in so the first word is not clipped.
        chunks.push(data);
        total += data.length;
        if (voiced === 0)
          while (chunks.length > 3) total -= chunks.shift().length;
        // A phrase ends after a short pause, or when it has run long enough.
        const ended = voiced > 0 && (quiet > 480 || total > rate * 14);
        if (ended) {
          const audio = new Float32Array(total);
          let at = 0;
          for (const c of chunks) {
            audio.set(c, at);
            at += c.length;
          }
          const spoke = voiced;
          chunks = [];
          voiced = quiet = total = 0;
          if (spoke > 350)
            transcribe(audio)
              .then((text) => {
                if (!stopped && text && !NOISE.test(text)) onText(text);
              })
              .catch((err) => onStatus?.({ error: err.message }));
        }
      };
      source.connect(node);
      node.connect(ctx.destination);
    } catch (e) {
      onStatus?.({ error: e.message || "Speech to text could not start." });
    }
  })();
  return () => {
    stopped = true;
    try {
      node?.disconnect();
      source?.disconnect();
      ctx?.close();
    } catch {}
  };
}
