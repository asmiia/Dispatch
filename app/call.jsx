"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Captions,
  ChevronUp,
  Hand,
  Headphones,
  HeadphoneOff,
  Maximize2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Smile,
  Video,
  VideoOff,
} from "lucide-react";
import UserAvatar from "./user-avatar";
import AgentAvatar from "./agent-avatar";
import { hueFor } from "./gradient";

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const REACTIONS = ["👍", "❤️", "😂", "🎉", "👏", "🔥"];

// A video in a tile (camera or shared screen). The element is fed by the stream.
function Feed({ stream, mirror, onSize }) {
  return (
    <video
      className={"feed" + (mirror ? " mirror" : "")}
      autoPlay
      playsInline
      muted
      onLoadedMetadata={(e) => onSize?.(e.target)}
      onResize={(e) => onSize?.(e.target)}
      ref={(el) => {
        if (el && el.srcObject !== stream) el.srcObject = stream;
      }}
    />
  );
}

// Voice and video call between the people in a conversation: camera, screen sharing, raised hands and
// reactions. Media goes browser to browser over WebRTC; the server only relays the setup messages.
// Connections use "perfect negotiation" so either side can change what it sends at any time.
export default function Call({
  api,
  messageId: startId,
  myId,
  withVideo,
  here,
  onReturn,
  onLeave,
  agentOf,
}) {
  // The call itself is mounted once for the whole app, so moving between conversations does not end it.
  // It draws its large view inside the conversation it belongs to, and a small control strip in the
  // sidebar everywhere else.
  const [slot, setSlot] = useState(null),
    [dock, setDock] = useState(null);
  useLayoutEffect(() => {
    const a = document.getElementById("call-slot"),
      b = document.getElementById("call-mini");
    if (a !== slot) setSlot(a);
    if (b !== dock) setDock(b);
  });
  // Joined once with the message that was open. New messages must not restart the call.
  const messageId = useRef(startId).current;
  const [peers, setPeers] = useState([]),
    [status, setStatus] = useState("Connecting..."),
    [secs, setSecs] = useState(0),
    [muted, setMuted] = useState(false),
    [deaf, setDeaf] = useState(false),
    [sharing, setSharing] = useState(null), // the stream being shared, if any
    [cam, setCam] = useState(null), // your camera stream, if on
    [hand, setHand] = useState(false),
    [menu, setMenu] = useState(""), // "react" | "mic" | ""
    [speaking, setSpeaking] = useState({}),
    [meta, setMeta] = useState({}),
    [videos, setVideos] = useState({}), // stream id -> { peer, stream }
    [sizes, setSizes] = useState({}),
    [floating, setFloating] = useState([]),
    [mics, setMics] = useState([]),
    [error, setError] = useState(""),
    [said, setSaid] = useState(null), // the agent line being read out, shown as a caption
    [listening, setListening] = useState(false), // your speech goes to the transcript for agents
    live = useRef({}),
    room = useRef({ pcs: new Map(), audio: new Map() });

  const state = {
    muted,
    deaf,
    hand,
    // Everyone else watches one stream per kind that never changes, so sharing again just fills it again.
    screen: sharing ? room.current.out?.screen?.id || null : null,
    camera: cam ? room.current.out?.cam?.id || null : null,
  };
  // Tell everyone else what your state is over the data channels, and keep your own tracks in step.
  const broadcast = (message) => {
    for (const e of room.current.pcs.values())
      if (e.dc?.readyState === "open") e.dc.send(JSON.stringify(message));
  };
  useEffect(() => {
    live.current = state;
    room.current.stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    for (const el of room.current.audio.values()) el.muted = deaf;
    broadcast({ t: "state", s: state });
  }, [muted, deaf, hand, sharing, cam]);

  const pop = (peer, emoji) => {
    const id = Math.random().toString(36).slice(2);
    setFloating((f) => [...f, { id, peer, emoji }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id)), 2600);
  };
  const react = (emoji) => {
    pop(room.current.me, emoji);
    broadcast({ t: "react", e: emoji });
    setMenu("");
  };

  useEffect(() => {
    const r = room.current;
    let stopped = false,
      me = "",
      thread = "",
      ice = [],
      timer;
    const levels = new Map();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const watch = (id, stream) => {
      try {
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(node);
        levels.set(id, node);
      } catch {}
    };
    const meter = setInterval(() => {
      const next = {},
        buf = new Uint8Array(256);
      for (const [id, node] of levels) {
        node.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        const who = id.split(":")[0];
        next[who] = next[who] || peak > 14;
      }
      setSpeaking((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    }, 160);
    const send = (to, data) =>
      api("calls/signal", { thread_id: thread, from: me, to, data }).catch(
        () => {},
      );
    const addVideo = (peer, stream) =>
      setVideos((p) => ({ ...p, [stream.id]: { peer, stream } }));
    const removeVideo = (streamId) =>
      setVideos((p) => {
        if (!p[streamId]) return p;
        const n = { ...p };
        delete n[streamId];
        return n;
      });

    // One sender per kind and connection, kept for the whole call. Sharing again swaps a track in and out of
    // it, so the other side keeps the same stream and never misses a restart.
    const outStream = (kind) => ((r.out ||= {})[kind] ||= new MediaStream());
    const lane = (e, key, track, kind) => {
      let s = e.senders[key];
      if (!s && !track) return null;
      if (!s)
        s = e.senders[key] = e.pc.addTransceiver(
          key.endsWith("Audio") ? "audio" : "video",
          { direction: "sendrecv", streams: [outStream(kind)] },
        ).sender;
      s.replaceTrack(track || null).catch(() => {});
      return s;
    };
    const attach = (e, kind, capture) => {
      const video = lane(e, kind, capture.getVideoTracks()[0], kind);
      if (video) tune(video, kind === "screen" ? 8e6 : 2.5e6);
      // System audio from a shared screen travels with it.
      lane(e, kind + "Audio", capture.getAudioTracks()[0], kind);
    };
    function connection(id) {
      if (r.pcs.has(id)) return r.pcs.get(id);
      const pc = new RTCPeerConnection({ iceServers: ice }),
        entry = {
          pc,
          polite: me < id,
          making: false,
          ignore: false,
          queued: [],
          senders: {},
          streams: new Set(),
        };
      r.pcs.set(id, entry);
      r.stream.getTracks().forEach((t) => pc.addTrack(t, r.stream));
      for (const kind of ["screen", "cam"])
        if (r[kind]) attach(entry, kind, r[kind]);
      // A small channel for state, reactions and the like. Both sides open the same one.
      entry.dc = pc.createDataChannel("meta", { negotiated: true, id: 0 });
      entry.dc.onopen = () =>
        entry.dc.send(JSON.stringify({ t: "state", s: live.current }));
      entry.dc.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.t === "state")
            setMeta((p) => ({ ...p, [id]: { ...p[id], ...m.s } }));
          if (m.t === "react" && REACTIONS.includes(m.e)) pop(id, m.e);
        } catch {}
      };
      pc.onicecandidate = (e) =>
        e.candidate && send(id, { candidate: e.candidate });
      pc.onnegotiationneeded = async () => {
        try {
          entry.making = true;
          await pc.setLocalDescription();
          send(id, { sdp: pc.localDescription });
        } catch {
        } finally {
          entry.making = false;
        }
      };
      pc.ontrack = (e) => {
        if (e.track.kind === "video") {
          const stream = e.streams[0] || new MediaStream([e.track]);
          entry.streams.add(stream.id);
          addVideo(id, stream);
          e.track.onended = () => removeVideo(stream.id);
          return;
        }
        const key = id + ":" + e.streams[0].id;
        let el = r.audio.get(key);
        if (!el) {
          el = new Audio();
          el.autoplay = true;
          r.audio.set(key, el);
        }
        el.srcObject = e.streams[0];
        el.muted = live.current.deaf;
        el.play().catch(() => {});
        watch(key, e.streams[0]);
      };
      return entry;
    }
    async function handle(from, data) {
      const entry = connection(from),
        pc = entry.pc;
      if (data.sdp) {
        const collision =
          data.sdp.type === "offer" &&
          (entry.making || pc.signalingState !== "stable");
        entry.ignore = !entry.polite && collision;
        if (entry.ignore) return;
        await pc.setRemoteDescription(data.sdp);
        for (const c of entry.queued.splice(0)) await pc.addIceCandidate(c);
        if (data.sdp.type === "offer") {
          await pc.setLocalDescription();
          send(from, { sdp: pc.localDescription });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (err) {
            if (!entry.ignore) throw err;
          }
        } else entry.queued.push(data.candidate);
      }
    }
    function drop(id) {
      const entry = r.pcs.get(id);
      entry?.pc.close();
      for (const s of entry?.streams || []) removeVideo(s);
      r.pcs.delete(id);
      for (const key of [...r.audio.keys()])
        if (key.startsWith(id + ":")) {
          r.audio.get(key).srcObject = null;
          r.audio.delete(key);
          levels.delete(key);
        }
      setMeta((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    }
    // The server forgets rooms when it restarts (an update). Join again and reconnect instead of leaving.
    let failures = 0;
    async function rejoin() {
      const j = await api("calls/join", { message_id: messageId });
      for (const id of [...r.pcs.keys()]) drop(id);
      ({ peer: me, thread_id: thread, ice } = j);
      r.me = me;
      r.thread = thread;
      setPeers([...j.peers]);
      for (const p of j.peers) if (!p.agent) connection(p.id);
    }
    // An agent spoke: read it aloud (unless you are deafened) and show it as a caption.
    let clear;
    function hear(e, speak = true) {
      setSaid({ id: e.id, from: e.from, name: e.name, text: e.text });
      clearTimeout(clear);
      clear = setTimeout(() => setSaid(null), 3000 + e.text.length * 60);
      if (!speak) return;
      if (live.current.deaf || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(e.text);
      u.onend = () => setSaid((c) => (c?.id === e.id ? null : c));
      window.speechSynthesis.speak(u);
    }
    async function loop() {
      if (stopped) return;
      try {
        const got = await api(
          `calls/poll?thread_id=${encodeURIComponent(thread)}&peer=${me}`,
        );
        for (const e of got.events) {
          if (e.type === "signal") await handle(e.from, e.data).catch(() => {});
          if (e.type === "leave") drop(e.id);
          if (e.type === "say") hear(e);
          if (e.type === "caption") hear(e, false);
        }
        setPeers(got.peers);
        setStatus("Voice connected");
        failures = 0;
      } catch (e) {
        if (stopped) return;
        failures++;
        setStatus("Reconnecting…");
        if (e?.status === 403 || e?.status === 404) {
          try {
            await rejoin();
            failures = 0;
          } catch {}
        }
        if (failures > 20) {
          setStatus("Connection lost");
          return onLeave();
        }
      }
      timer = setTimeout(loop, failures ? 1500 : 700);
    }

    // Let the video use plenty of bitrate and keep it sharp rather than blurry.
    const tune = (sender, bps) => {
      for (const wait of [0, 1500, 4000])
        setTimeout(() => {
          try {
            const p = sender.getParameters();
            if (!p.encodings?.length) p.encodings = [{}];
            p.encodings[0].maxBitrate = bps;
            p.degradationPreference = "maintain-resolution";
            sender.setParameters(p).catch(() => {});
          } catch {}
        }, wait);
    };
    // Camera and screen: add the video to every connection, and take it away again when you stop.
    const startVideo = async (kind, get, setter) => {
      try {
        const s = await get();
        r[kind] = s;
        const track = s.getVideoTracks()[0];
        track.onended = () => stopVideo(kind, setter);
        track.contentHint = kind === "screen" ? "detail" : "motion";
        // The desktop app's screen picker lets you choose a quality; apply it to the capture.
        if (kind === "screen" && window.dispatchDesktop?.shareQuality)
          window.dispatchDesktop
            .shareQuality()
            .then(
              (q) =>
                q &&
                track.applyConstraints({
                  width: { ideal: q.w },
                  height: { ideal: q.h },
                  frameRate: { ideal: q.fps },
                }),
            )
            .catch(() => {});
        outStream(kind);
        for (const e of r.pcs.values()) attach(e, kind, s);
        setter(s);
      } catch (err) {
        if (
          !["NotAllowedError", "AbortError", "NotFoundError"].includes(
            err?.name,
          )
        )
          setError(
            kind === "screen"
              ? "Screen sharing is not available here."
              : "No camera found.",
          );
      }
    };
    const stopVideo = (kind, setter) => {
      if (!r[kind]) return;
      r[kind].getTracks().forEach((t) => t.stop());
      for (const e of r.pcs.values())
        for (const key of [kind, kind + "Audio"])
          e.senders[key]?.replaceTrack(null).catch(() => {});
      r[kind] = null;
      setter(null);
    };
    r.toggleShare = () =>
      r.screen
        ? stopVideo("screen", setSharing)
        : startVideo(
            "screen",
            () =>
              navigator.mediaDevices.getDisplayMedia({
                video: {
                  frameRate: { ideal: 30, max: 60 },
                  width: { ideal: 1920 },
                  height: { ideal: 1080 },
                },
                audio: !!window.dispatchDesktop,
              }),
            setSharing,
          );
    r.toggleCam = () =>
      r.cam
        ? stopVideo("cam", setCam)
        : startVideo(
            "cam",
            () =>
              navigator.mediaDevices.getUserMedia({
                video: {
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  frameRate: { ideal: 30 },
                },
              }),
            setCam,
          );
    r.switchMic = async (deviceId) => {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const track = s.getAudioTracks()[0];
      track.enabled = !live.current.muted;
      for (const e of r.pcs.values())
        for (const sender of e.pc.getSenders())
          if (sender.track?.kind === "audio") sender.replaceTrack(track);
      r.stream.getAudioTracks().forEach((t) => t.stop());
      r.stream = s;
      levels.delete("self");
      watch("self", s);
    };

    (async () => {
      try {
        r.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        setStatus("Microphone blocked");
        return setTimeout(onLeave, 2500);
      }
      if (stopped) return r.stream.getTracks().forEach((t) => t.stop());
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setMics(d.filter((x) => x.kind === "audioinput")))
        .catch(() => {});
      try {
        const j = await api("calls/join", { message_id: messageId });
        ({ peer: me, thread_id: thread, ice } = j);
        r.me = me;
        r.thread = thread;
        watch("self", r.stream);
        setPeers([...j.peers]);
        for (const p of j.peers) if (!p.agent) connection(p.id);
        loop();
        if (withVideo) r.toggleCam();
      } catch (e) {
        setStatus(e.message);
        setTimeout(onLeave, 2500);
      }
    })();
    const tick = setInterval(() => setSecs((s) => s + 1), 1000);
    const bye = () =>
      r.me &&
      fetch("/api/calls/leave", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: r.thread, peer: r.me }),
      });
    window.addEventListener("pagehide", bye);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(tick);
      clearInterval(meter);
      window.removeEventListener("pagehide", bye);
      clearTimeout(clear);
      window.speechSynthesis?.cancel();
      bye();
      r.screen?.getTracks().forEach((t) => t.stop());
      r.cam?.getTracks().forEach((t) => t.stop());
      for (const id of [...r.pcs.keys()]) drop(id);
      r.stream?.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    };
  }, [messageId]);

  // Captions: this browser turns your speech into text for the transcript, so agents in the call can hear you.
  useEffect(() => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!listening || !Rec) return;
    const rec = new Rec();
    let stopped = false;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal && text && !live.current.muted) {
          setSaid({ id: Math.random(), name: "You", text });
          setTimeout(() => setSaid((c) => (c?.name === "You" && c.text === text ? null : c)), 3000 + text.length * 60);
          api("calls/caption", {
            thread_id: room.current.thread,
            from: room.current.me,
            text,
          }).catch(() => {});
        }
      }
    };
    rec.onend = () => {
      if (!stopped)
        try {
          rec.start();
        } catch {}
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed")
        setListening(false);
    };
    try {
      rec.start();
    } catch {}
    return () => {
      stopped = true;
      rec.abort();
    };
  }, [listening]);
  const canListen =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const measure = (key) => (el) =>
    setSizes((p) =>
      p[key] === el.videoHeight ? p : { ...p, [key]: el.videoHeight },
    );
  const tiles = [...peers].sort((a, b) => (b.uid === myId) - (a.uid === myId)),
    mineId = room.current.me,
    // A person's tiles: a shared screen (wide, first) and their camera or avatar.
    streamOf = (p, kind) => {
      const want = (p.id === mineId ? state : meta[p.id] || {})[kind];
      if (!want) return null;
      if (p.id === mineId) return kind === "screen" ? sharing : cam;
      return videos[want]?.peer === p.id ? videos[want].stream : null;
    },
    bounds = (key) =>
      sizes[key] ? `${sizes[key] >= 1000 ? sizes[key] : sizes[key]}P` : "";
  const stage = (
    <div className="call">
      <div className="call-grid">
        {tiles.flatMap((p) => {
          const mine = p.id === mineId,
            m = mine ? state : meta[p.id] || {},
            off = m.muted || m.deaf,
            talking = p.agent
              ? said?.from === p.id
              : mine
                ? !off && speaking.self
                : speaking[p.id],
            screen = streamOf(p, "screen"),
            camera = streamOf(p, "camera"),
            out = [];
          if (screen)
            out.push(
              <div key={p.id + "-screen"} className="call-tile screen-tile">
                <Feed stream={screen} onSize={measure(p.id + "s")} />
                <span className="live-tag">
                  {bounds(p.id + "s") && <b>{bounds(p.id + "s")}</b>}
                  <i>LIVE</i>
                </span>
                <span className="call-name">
                  <Monitor size={13} />
                  {mine ? "You are sharing your screen" : `${p.name}'s screen`}
                </span>
                <button
                  className="tile-full"
                  aria-label="Full screen"
                  onClick={(e) =>
                    e.currentTarget.parentElement.requestFullscreen?.()
                  }
                >
                  <Maximize2 size={15} />
                </button>
              </div>,
            );
          out.push(
            <div
              key={p.id}
              className={"call-tile" + (talking ? " speaking" : "")}
              style={{
                "--tint": `hsl(${hueFor(p.name)} 38% 20%)`,
                "--h": hueFor(p.name),
              }}
            >
              {p.agent ? (
                <span className="agent-face">
                  <AgentAvatar
                    className="avatar"
                    name={p.name}
                    program={agentOf?.(p.name)?.program}
                    model={agentOf?.(p.name)?.model}
                  />
                </span>
              ) : camera ? (
                <Feed stream={camera} mirror={mine} />
              ) : (
                <UserAvatar id={p.uid} name={p.name} v={p.avatar_v} size={96} />
              )}
              <span className="call-badges">
                {m.hand && <Hand size={15} className="hand" />}
              </span>
              <span className="call-name">
                {p.agent && <Bot size={13} />}
                {m.deaf ? (
                  <HeadphoneOff size={13} />
                ) : (
                  m.muted && <MicOff size={13} />
                )}
                {p.name}
              </span>
              {floating
                .filter((f) => f.peer === p.id)
                .map((f) => (
                  <span key={f.id} className="call-emoji">
                    {f.emoji}
                  </span>
                ))}
            </div>,
          );
          return out;
        })}
      </div>
      {said && (
        <div className="call-caption" role="status">
          <b>{said.name}</b> {said.text}
        </div>
      )}
      {error && <div className="call-error">{error}</div>}
      <div className="call-dock">
        <div className="call-bar">
          <div className="call-group">
            <button
              className={"call-btn" + (muted ? " off" : "")}
              aria-pressed={muted}
              title={muted ? "Unmute" : "Mute"}
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            {mics.length > 1 && (
              <div className="call-react">
                <button
                  className="call-caret"
                  title="Choose a microphone"
                  aria-label="Choose a microphone"
                  onClick={() => setMenu(menu === "mic" ? "" : "mic")}
                >
                  <ChevronUp size={14} />
                </button>
                {menu === "mic" && (
                  <div className="call-picker list">
                    {mics.map((d, i) => (
                      <button
                        key={d.deviceId}
                        onClick={() => {
                          room.current.switchMic(d.deviceId);
                          setMenu("");
                        }}
                      >
                        {d.label || `Microphone ${i + 1}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              className={"call-btn" + (deaf ? " off" : "")}
              aria-pressed={deaf}
              title={deaf ? "Undeafen" : "Deafen"}
              aria-label={deaf ? "Undeafen" : "Deafen"}
              onClick={() => setDeaf(!deaf)}
            >
              {deaf ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
            </button>
            <button
              className={"call-btn" + (cam ? " on" : "")}
              aria-pressed={!!cam}
              title={cam ? "Turn off camera" : "Turn on camera"}
              aria-label={cam ? "Turn off camera" : "Turn on camera"}
              onClick={() => room.current.toggleCam()}
            >
              {cam ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
          </div>
          <div className="call-group">
            <button
              className={"call-btn" + (sharing ? " on" : "")}
              aria-pressed={!!sharing}
              title={sharing ? "Stop sharing" : "Share your screen"}
              aria-label={sharing ? "Stop sharing" : "Share your screen"}
              onClick={() => room.current.toggleShare()}
            >
              {sharing ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
            </button>
            {canListen && (
              <button
                className={"call-btn" + (listening ? " on" : "")}
                aria-pressed={listening}
                title={
                  listening
                    ? "Stop sharing captions with agents"
                    : "Let agents hear you (captions)"
                }
                aria-label={
                  listening
                    ? "Stop sharing captions with agents"
                    : "Let agents hear you (captions)"
                }
                onClick={() => setListening(!listening)}
              >
                <Captions size={20} />
              </button>
            )}
            <button
              className={"call-btn" + (hand ? " on" : "")}
              aria-pressed={hand}
              title={hand ? "Lower hand" : "Raise hand"}
              aria-label={hand ? "Lower hand" : "Raise hand"}
              onClick={() => setHand(!hand)}
            >
              <Hand size={20} />
            </button>
            <div className="call-react">
              <button
                className="call-btn"
                title="Send a reaction"
                aria-label="Send a reaction"
                onClick={() => setMenu(menu === "react" ? "" : "react")}
              >
                <Smile size={20} />
              </button>
              {menu === "react" && (
                <div className="call-picker">
                  {REACTIONS.map((e) => (
                    <button key={e} onClick={() => react(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            className="call-btn leave wide"
            title="Leave call"
            aria-label="Leave call"
            onClick={onLeave}
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>
    </div>
  );
  const mini = (
    <div className="call-mini">
      <div className="mini-head">
        <i />
        <span>
          {status === "Voice connected" ? `In a call · ${clock(secs)}` : status}
        </span>
        <button className="mini-return" onClick={onReturn}>
          Return
        </button>
      </div>
      <div className="mini-people">
        {tiles.map((p) =>
          p.agent ? (
            <span key={p.id} className="agent-face mini" title={p.name}>
              <AgentAvatar
                className="avatar"
                name={p.name}
                program={agentOf?.(p.name)?.program}
                model={agentOf?.(p.name)?.model}
              />
            </span>
          ) : (
            <UserAvatar
              key={p.id}
              id={p.uid}
              name={p.name}
              v={p.avatar_v}
              size={26}
            />
          ),
        )}
      </div>
      <div className="mini-controls">
        <button
          className={muted ? "off" : ""}
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute" : "Mute"}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button
          className={deaf ? "off" : ""}
          aria-label={deaf ? "Undeafen" : "Deafen"}
          title={deaf ? "Undeafen" : "Deafen"}
          onClick={() => setDeaf(!deaf)}
        >
          {deaf ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
        </button>
        <button
          className={sharing ? "on" : ""}
          aria-label={sharing ? "Stop sharing" : "Share your screen"}
          title={sharing ? "Stop sharing" : "Share your screen"}
          onClick={() => room.current.toggleShare()}
        >
          {sharing ? <MonitorOff size={16} /> : <MonitorUp size={16} />}
        </button>
        <button
          className="leave"
          aria-label="Leave call"
          title="Leave call"
          onClick={onLeave}
        >
          <PhoneOff size={16} />
        </button>
      </div>
    </div>
  );
  // The strip in the left column is always there during a call; the stage joins it while you are in that conversation.
  return (
    <>
      {dock && createPortal(mini, dock)}
      {here && slot && createPortal(stage, slot)}
    </>
  );
}
