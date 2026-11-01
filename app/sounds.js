// Small synthesised sounds, so there are no audio files to ship: a message blip and a repeating ring.
let ctx;
const on = () => {
  try {
    return localStorage.getItem("dispatch-sounds") !== "off";
  } catch {
    return true;
  }
};
export const soundsOn = on;
export const setSounds = (value) => {
  try {
    localStorage.setItem("dispatch-sounds", value ? "on" : "off");
  } catch {}
};
const audio = () => {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
};
function tone(freq, start, length, volume = 0.18) {
  const c = audio(),
    osc = c.createOscillator(),
    gain = c.createGain(),
    t = c.currentTime + start;
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}
export function blip() {
  if (!on()) return;
  try {
    tone(880, 0, 0.14);
    tone(1175, 0.1, 0.2);
  } catch {}
}
// Rings until you call the returned function. Plays the ring tone at a low volume, and falls back to a
// synthesised ring if the file cannot play.
export function ring() {
  if (!on()) return () => {};
  let stop = () => {};
  const synth = () => {
    const once = () => {
      try {
        for (const at of [0, 0.5]) {
          tone(523, at, 0.38, 0.22);
          tone(659, at, 0.38, 0.22);
        }
      } catch {}
    };
    once();
    const timer = setInterval(once, 2400);
    stop = () => clearInterval(timer);
  };
  try {
    const a = new Audio("/ring.wav");
    a.loop = true;
    a.volume = 0.3;
    a.play().catch(synth);
    stop = () => {
      a.pause();
      a.removeAttribute("src");
      a.load();
    };
  } catch {
    synth();
  }
  return () => stop();
}
