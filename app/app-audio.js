// The sound of one program, sent over by the desktop app as raw 16-bit 48 kHz stereo samples, becomes an audio
// track that can be added to a shared screen.
export function appAudioTrack() {
  const bridge = window.dispatchDesktop?.appAudio;
  if (!bridge) return null;
  const ctx = new AudioContext({ sampleRate: 48000 }),
    dest = ctx.createMediaStreamDestination(),
    node = ctx.createScriptProcessor(2048, 0, 2);
  let queue = [],
    queued = 0;
  const limit = 48000 * 0.5; // keep at most half a second, so the sound never lags behind the picture
  let rest = new Uint8Array(0);
  const off = bridge.onData((chunk) => {
    // The stream arrives in arbitrary pieces; keep whole stereo frames (4 bytes) and carry the remainder over.
    const data = new Uint8Array(rest.length + chunk.byteLength);
    data.set(rest, 0);
    data.set(new Uint8Array(chunk.buffer ? chunk.buffer : chunk, chunk.byteOffset || 0, chunk.byteLength), rest.length);
    const whole = data.length - (data.length % 4);
    rest = data.slice(whole);
    const samples = new Int16Array(data.slice(0, whole).buffer);
    queue.push(samples);
    queued += samples.length / 2;
    while (queued > limit && queue.length > 1) queued -= queue.shift().length / 2;
  });
  let cur = null,
    at = 0;
  node.onaudioprocess = (e) => {
    const l = e.outputBuffer.getChannelData(0),
      r = e.outputBuffer.getChannelData(1);
    for (let i = 0; i < l.length; i++) {
      if (!cur || at >= cur.length) {
        cur = queue.shift() || null;
        at = 0;
        if (cur) queued -= cur.length / 2;
      }
      if (cur) {
        l[i] = cur[at++] / 32768;
        r[i] = cur[at++] / 32768;
      } else l[i] = r[i] = 0;
    }
  };
  node.connect(dest);
  return {
    track: dest.stream.getAudioTracks()[0],
    stop: () => {
      off();
      bridge.stop();
      try {
        node.disconnect();
        ctx.close();
      } catch {}
    },
  };
}
