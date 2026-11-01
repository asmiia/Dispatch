"use client";
import { cloneElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Captions,
  ChevronUp,
  Hand,
  Headphones,
  HeadphoneOff,
  ChevronDown,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PictureInPicture2,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Smile,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import UserAvatar from "./user-avatar";
import { listen } from "./stt";
import { appAudioTrack } from "./app-audio";
import { speak, warm, setOutput } from "./tts";
import AgentAvatar from "./agent-avatar";
import { avatarTint } from "./avatar-tint";
import { hueFor } from "./gradient";

const tintVars = (c) =>
  c ? { "--ch": c[0][0], "--c1": `${c[0][0]} ${c[0][1]}%`, "--c2": `${c[1][0]} ${c[1][1]}%`, "--c3": `${c[2][0]} ${c[2][1]}%` } : {};
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
// How a shared screen is captured and sent. Each viewer receives its own copy, so higher means more upload.
const QUALITY = {
  standard: { label: "Standard", note: "720p · 30 fps · 3 Mbps", h: 720, fps: 30, bps: 3e6 },
  high: { label: "High", note: "1080p · 60 fps · 8 Mbps", h: 1080, fps: 60, bps: 8e6 },
  max: { label: "Max", note: "1440p · 60 fps · 16 Mbps, sharpest, heaviest on your PC", h: 1440, fps: 60, bps: 16e6 },
};
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
  onMenu,
  onProfile,
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
    [menu, setMenu] = useState(""), // "react" | "mic" | "out" | "src" | ""
    [speaking, setSpeaking] = useState({}),
    [meta, setMeta] = useState({}),
    metaRef = useRef({}),
    [tints, setTints] = useState({}),
    [videos, setVideos] = useState({}), // stream id -> { peer, stream }
    [sizes, setSizes] = useState({}),
    [chatHidden, setChatHidden] = useState(false),
    [streamVol, setStreamVol] = useState({}), // volume you set for someone's shared screen, 0 to 1
    [shareQ, setShareQ] = useState(() => {
      try {
        return localStorage.getItem("dispatch-share-q") || "high";
      } catch {
        return "high";
      }
    }),
    [fullNow, setFullNow] = useState(false),
    [shareSrc, setShareSrc] = useState(() => {
      try {
        return localStorage.getItem("dispatch-share-src") || "default";
      } catch {
        return "default";
      }
    }),
    [focus, setFocus] = useState(null), // key of the focused tile, "none" for the grid, null for automatic
    [floating, setFloating] = useState([]),
    [mics, setMics] = useState([]),
    [outs, setOuts] = useState([]), // speakers
    [sink, setSink] = useState(() => {
      try {
        return localStorage.getItem("dispatch-sink") || "";
      } catch {
        return "";
      }
    }),
    [error, setError] = useState(""),
    [said, setSaid] = useState(null), // the agent line being read out, shown as a caption
    [listening, setListening] = useState(false), // your speech goes to the transcript for agents
    live = useRef({}),
    room = useRef({ pcs: new Map(), audio: new Map(), local: new Set() });

  // People you silenced for yourself (the others in the call still hear them).
  const [hushed, setHushed] = useState([]);
  const stageRef = useRef(null),
    srcRef = useRef(shareSrc),
    qRef = useRef(shareQ),
    sinkRef = useRef(sink);
  srcRef.current = shareSrc;
  qRef.current = QUALITY[shareQ] ? shareQ : "high";
  // Apply the volume you set to the matching shared-screen sound.
  useEffect(() => {
    for (const [peer, v] of Object.entries(streamVol)) {
      const id = meta[peer]?.screen;
      for (const [key, el] of room.current.audio) if (key === peer + ":" + id) el.volume = v;
    }
  }, [streamVol, meta]);
  sinkRef.current = sink;
  useEffect(() => {
    for (const el of room.current.audio.values()) el.setSinkId?.(sink).catch(() => {});
    setOutput(sink);
  }, [sink]);
  metaRef.current = meta;
  // Deafening silences the call, not a stream someone is sharing.
  const silenced = (key) => {
    const [id, sid] = key.split(":");
    return (live.current.deaf && sid !== metaRef.current[id]?.screen) || mutedFor(key);
  };
  const mutedFor = (key) => room.current.local?.has(key.split(":")[0]);
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
    for (const [key, el] of room.current.audio) el.muted = silenced(key);
    broadcast({ t: "state", s: state });
  }, [muted, deaf, hand, sharing, cam, hushed, meta]);

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
        s = e.senders[key] = (() => {
          const t = e.pc.addTransceiver(key.endsWith("Audio") ? "audio" : "video", {
            direction: "sendrecv",
            streams: [outStream(kind)],
          });
          // A shared screen goes out as H.264 (hardware encoded, light on a game), or VP9 for the sharpest picture.
          if (key === "screen")
            try {
              const first = qRef.current === "max" ? /VP9/i : /H264/i,
                rank = (c) => (first.test(c.mimeType) ? 0 : /VP9|H264/i.test(c.mimeType) ? 1 : 2);
              t.setCodecPreferences([...RTCRtpSender.getCapabilities("video").codecs].sort((a, b) => rank(a) - rank(b)));
            } catch {}
          return t.sender;
        })();
      s.replaceTrack(track || null).catch(() => {});
      return s;
    };
    const attach = (e, kind, capture) => {
      const video = lane(e, kind, capture.getVideoTracks()[0], kind);
      if (video) tune(video, kind === "screen" ? QUALITY[qRef.current].bps : 2.5e6);
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
        // Keep the viewing delay short instead of buffering a few seconds of video.
        try {
          e.receiver.jitterBufferTarget = 40;
          e.receiver.playoutDelayHint = 0.04;
        } catch {}
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
        el.muted = silenced(key);
        if (sinkRef.current) el.setSinkId?.(sinkRef.current).catch(() => {});
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
    function hear(e, aloud = true) {
      setSaid({ id: e.id, from: e.from, name: e.name, text: e.text });
      clearTimeout(clear);
      clear = setTimeout(() => setSaid(null), 3000 + e.text.length * 60);
      if (!aloud) return;
      // Start getting the natural voice ready as soon as an agent first speaks.
      speak(e.text, { muted: () => live.current.deaf }).then(() =>
        setSaid((c) => (c?.id === e.id ? null : c)),
      );
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
            p.degradationPreference = "balanced";
            p.encodings[0].maxFramerate = 60;
            p.encodings[0].priority = "high";
            p.encodings[0].networkPriority = "high";
            sender.setParameters(p).catch(() => {});
          } catch {}
        }, wait);
    };
    // Tell the person when their shared screen carries no sound, and why that happens.
    const checkSound = (s) => {
      const track = s.getAudioTracks()[0];
      if (!track) {
        setError("No sound was captured with your screen. In the share window, tick the box to also share audio.");
        return setTimeout(() => setError(""), 12000);
      }
      try {
        const c = new AudioContext(),
          an = c.createAnalyser();
        an.fftSize = 512;
        c.createMediaStreamSource(new MediaStream([track])).connect(an);
        const buf = new Uint8Array(256);
        let loud = false,
          n = 0;
        const t = setInterval(() => {
          an.getByteTimeDomainData(buf);
          for (const v of buf) if (Math.abs(v - 128) > 3) loud = true;
          if (loud || ++n > 24) {
            clearInterval(t);
            c.close().catch(() => {});
            if (!loud && r.screen === s) {
              setError("No sound is coming from your screen share. Windows only shares sound from the default output device: set it to the device you listen on, then share again.");
              setTimeout(() => setError(""), 14000);
            }
          }
        }, 250);
      } catch {}
    };
    // Camera and screen: add the video to every connection, and take it away again when you stop.
    const startVideo = async (kind, get, setter) => {
      try {
        const s = await get();
        r[kind] = s;
        const track = s.getVideoTracks()[0];
        track.onended = () => stopVideo(kind, setter);
        track.contentHint = "motion";
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
        if (kind === "screen") checkSound(s);
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
      if (kind === "screen") {
        r.stopTap?.();
        r.stopTap = null;
      }
      setter(null);
    };
    r.toggleShare = () =>
      r.screen
        ? stopVideo("screen", setSharing)
        : startVideo(
            "screen",
            () =>
              navigator.mediaDevices
                .getDisplayMedia({
                  video: {
                    frameRate: { ideal: QUALITY[qRef.current].fps, max: 60 },
                    width: { ideal: Math.round((QUALITY[qRef.current].h * 16) / 9) },
                    height: { ideal: QUALITY[qRef.current].h },
                  },
                  audio: srcRef.current === "default",
                })
                .then(async (s) => {
                  // Desktop app, sharing one window: that program's own sound (see desktop/app-audio.cs).
                  try {
                    const q = await window.dispatchDesktop?.shareQuality?.();
                    if (q && (q.appAudio || q.audio === false)) for (const t of s.getAudioTracks()) (s.removeTrack(t), t.stop());
                    if (q?.appAudio) {
                      const tap = appAudioTrack();
                      if (tap) {
                        s.addTrack(tap.track);
                        room.current.stopTap = tap.stop;
                      }
                    }
                  } catch {}
                  // Sound from a device you chose (a virtual cable, Stereo Mix) instead of the default output.
                  if (srcRef.current !== "default")
                    try {
                      const a = await navigator.mediaDevices.getUserMedia({
                        audio: {
                          deviceId: { exact: srcRef.current },
                          echoCancellation: false,
                          noiseSuppression: false,
                          autoGainControl: false,
                        },
                      });
                      s.addTrack(a.getAudioTracks()[0]);
                    } catch {
                      setError("That sound source could not be used. Pick another one next to the share button.");
                      setTimeout(() => setError(""), 9000);
                    }
                  return s;
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
        .then((d) => {
          setMics(d.filter((x) => x.kind === "audioinput"));
          setOuts(d.filter((x) => x.kind === "audiooutput"));
        })
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

  // Captions: a small speech model running in this browser writes down what you say, so people and agents in
  // the call can read it. It works in every browser and in the desktop app, and the audio stays on your computer.
  useEffect(() => {
    if (!listening) return;
    const tell = (detail) =>
      window.dispatchEvent(new CustomEvent("dispatch:captions", { detail: { on: true, ...detail } }));
    const stop = listen(room.current.stream, {
      onStatus: (s) => {
        if (s.error) {
          tell({ error: "Speech to text failed: " + s.error });
          setListening(false);
        } else if (s.loading !== undefined) tell({ status: `Getting the speech model… ${Math.round(s.loading * 100)}%` });
        else if (s.ready) tell({ status: "" });
      },
      onText: (text) => {
        tell({ heard: text, final: true });
        if (live.current.muted) return;
        setSaid({ id: Math.random(), name: "You", text });
        setTimeout(
          () => setSaid((c) => (c?.name === "You" && c.text === text ? null : c)),
          3000 + text.length * 60,
        );
        api("calls/caption", {
          thread_id: room.current.thread,
          from: room.current.me,
          text,
        }).catch(() => {});
      },
    });
    return stop;
  }, [listening]);
  // The transcript panel in the conversation turns captions on and off, and hears what the mic hears.
  useEffect(() => {
    const flip = () => setListening((v) => !v);
    window.addEventListener("dispatch:captions-toggle", flip);
    return () => window.removeEventListener("dispatch:captions-toggle", flip);
  }, []);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("dispatch:captions", { detail: { on: listening } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("dispatch:captions", { detail: { on: false } }),
      );
    };
  }, [listening]);
  // Get the agents' voice ready while you are in the call.
  useEffect(() => {
    warm();
  }, []);
  const canListen =
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined";

  const measure = (key) => (el) =>
    setSizes((p) =>
      p[key] === el.videoHeight ? p : { ...p, [key]: el.videoHeight },
    );
  // Each tile's background takes its colors from that person's picture.
  useEffect(() => {
    for (const p of peers) {
      if (!p.avatar_v || p.agent) continue;
      const key = p.uid + ":" + p.avatar_v;
      if (tints[key] !== undefined) continue;
      avatarTint(`/api/avatars/${p.uid}?v=${p.avatar_v}`).then((c) => setTints((t) => ({ ...t, [key]: c })));
    }
  }, [peers]);
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
  // Every tile of the call, each with a key: a person, or a shared screen.
  const all = tiles.flatMap((p) => {
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
                <span className="call-name hover-only">
                  <Monitor size={18} />
                  {mine ? "You" : p.name}
                </span>
                <span className="tile-actions">
                  <button
                    aria-label="More"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.currentTarget.closest(".call-tile").dispatchEvent(
                        new MouseEvent("contextmenu", { bubbles: true, clientX: e.clientX, clientY: e.clientY }),
                      );
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {!mine && (
                    <span className="tile-vol" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        aria-label="Stream volume"
                        value={Math.round((streamVol[p.id] ?? 1) * 100)}
                        onChange={(e) => setStreamVol((v) => ({ ...v, [p.id]: Number(e.target.value) / 100 }))}
                      />
                      <button
                        aria-label={(streamVol[p.id] ?? 1) === 0 ? "Turn the stream sound on" : "Turn the stream sound off"}
                        onClick={() => setStreamVol((v) => ({ ...v, [p.id]: (v[p.id] ?? 1) === 0 ? 1 : 0 }))}
                      >
                        {(streamVol[p.id] ?? 1) === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                    </span>
                  )}
                </span>
                <button
                  className="tile-full"
                  aria-label="Full screen"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFull();
                  }}
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
                ...tintVars(tints[p.uid + ":" + p.avatar_v]),
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
        });
  // Click a tile to focus it: it fills the stage and everyone else moves to a strip underneath. A shared screen
  // is focused by default. Click the focused tile again to go back to the grid.
  const focusKey = focus && focus !== "none" && all.some((e) => e.key === focus) ? focus : null;
  // Size the tiles so that all of them fit the room there is, as large as it allows.
  const gridRef = useRef(null),
    [tw, setTw] = useState(0),
    [gridNode, setGridNode] = useState(null),
    count = all.length;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const size = () => {
      const W = el.clientWidth - 8,
        H = el.clientHeight - 8,
        gap = 12,
        cap = document.fullscreenElement ? 1100 : 560;
      let best = 0;
      for (let c = 1; c <= Math.max(count, 1); c++) {
        const rows = Math.ceil(count / c);
        best = Math.max(best, Math.min((W - gap * (c - 1)) / c, ((H - gap * (rows - 1)) / rows) * (16 / 9)));
      }
      setTw(Math.max(140, Math.min(cap, Math.floor(best))));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    document.addEventListener("fullscreenchange", size);
    return () => {
      ro.disconnect();
      document.removeEventListener("fullscreenchange", size);
    };
  }, [count, !!focusKey, gridNode]);
  useEffect(() => {
    const on = () => setFullNow(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : stageRef.current?.requestFullscreen?.();
  const personOf = (el) => tiles.find((p) => String(el.key).startsWith(p.id));
  const tileMenu = (el) => (e) => {
    const p = personOf(el),
      screenTile = String(el.key).endsWith("-screen"),
      mine = p?.id === mineId,
      focused = el.key === focusKey,
      hushedNow = room.current.local.has(p?.id);
    onMenu?.(e, [
      {
        label: focused ? "Show everyone" : screenTile ? "Watch this screen" : "Focus",
        icon: <Maximize2 size={14} />,
        onClick: () => {
          setFocus(focused ? "none" : el.key);
        },
      },
      {
        label: "Full screen",
        icon: <Maximize2 size={14} />,
        onClick: () => toggleFull(),
      },
      ...(screenTile && !mine && p
        ? [
            "-",
            ...[["Stream sound: full", 1], ["Stream sound: half", 0.4], ["Stream sound: off", 0]].map(([label, v]) => ({
              label,
              icon: <Headphones size={14} />,
              onClick: () => setStreamVol((cur) => ({ ...cur, [p.id]: v })),
            })),
            "-",
          ]
        : []),
      ...(screenTile && mine
        ? [{ label: "Stop sharing", icon: <MonitorOff size={14} />, onClick: () => room.current.toggleShare() }]
        : []),
      ...(p && !mine && !p.agent
        ? [
            "-",
            {
              label: hushedNow ? "Unmute for me" : "Mute for me",
              icon: hushedNow ? <Mic size={14} /> : <MicOff size={14} />,
              onClick: () => {
                hushedNow ? room.current.local.delete(p.id) : room.current.local.add(p.id);
                setHushed([...room.current.local]);
              },
            },
          ]
        : []),
      ...(p && !p.agent && onProfile
        ? [{ label: "View profile", icon: <Users size={14} />, onClick: () => onProfile("person", p.name) }]
        : p && p.agent && onProfile
          ? [{ label: "View profile", icon: <Bot size={14} />, onClick: () => onProfile("agent", p.name) }]
          : []),
    ]);
  };
  const pick = (el) =>
    cloneElement(el, {
      onClick: () => {
        // Clicking focuses that tile on its own; click it again to go back to everyone.
        setFocus(el.key === focusKey ? "none" : el.key);
      },
      onContextMenu: tileMenu(el),
      "data-tile": el.key,
      title: el.key === focusKey ? "Click to show everyone" : "Click to focus",
      className: el.props.className + (el.key === focusKey ? " focused" : " pickable"),
    });
  const layout =
    focusKey && all.length > 1 ? (
      <div className="call-focus-wrap">
        <div className="call-focus">
          {pick(all.find((e) => e.key === focusKey))}
        </div>
        <div className="call-strip">
          {all.filter((e) => e.key !== focusKey).map(pick)}
        </div>
      </div>
    ) : (
      <div className="call-grid" ref={(n) => ((gridRef.current = n), setGridNode(n))} style={{ "--tw": (tw || 320) + "px" }}>
        {all.map(pick)}
      </div>
    );
  const stage = (
    <div className="call" ref={stageRef}>
      {layout}
      {said && (
        <div className="call-caption" role="status">
          <b>{said.name}</b> {said.text}
        </div>
      )}
      {error && <div className="call-error">{error}</div>}
      <div className="call-dock">
        <button
          className="dock-side left"
          title={chatHidden ? "Show the chat" : "Hide the chat"}
          aria-label={chatHidden ? "Show the chat" : "Hide the chat"}
          onClick={() => {
            const next = !chatHidden;
            setChatHidden(next);
            stageRef.current?.closest(".feed-main")?.classList.toggle("call-only", next);
          }}
        >
          <ChevronDown size={18} style={{ transform: chatHidden ? "rotate(180deg)" : "none" }} />
        </button>
        <div className="dock-side right">
          {document.pictureInPictureEnabled && (
            <button
              title="Pop the stream out"
              aria-label="Pop the stream out"
              onClick={() => {
                const v =
                  stageRef.current?.querySelector(".focused video") ||
                  stageRef.current?.querySelector(".screen-tile video") ||
                  stageRef.current?.querySelector("video");
                if (document.pictureInPictureElement) document.exitPictureInPicture();
                else v?.requestPictureInPicture?.().catch(() => {});
              }}
            >
              <PictureInPicture2 size={18} />
            </button>
          )}
          <button
            title={fullNow ? "Leave full screen" : "Full screen"}
            aria-label={fullNow ? "Leave full screen" : "Full screen"}
            onClick={() => toggleFull()}
          >
            {fullNow ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
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
            {outs.length > 1 && (
              <div className="call-react">
                <button
                  className="call-caret"
                  title="Choose where you hear the call"
                  aria-label="Choose where you hear the call"
                  onClick={() => setMenu(menu === "out" ? "" : "out")}
                >
                  <ChevronUp size={14} />
                </button>
                {menu === "out" && (
                  <div className="call-picker list">
                    {outs.map((d, i) => (
                      <button
                        key={d.deviceId}
                        onClick={() => {
                          setSink(d.deviceId);
                          try {
                            localStorage.setItem("dispatch-sink", d.deviceId);
                          } catch {}
                          setMenu("");
                        }}
                      >
                        {(sink || "default") === d.deviceId ? "✓ " : ""}
                        {d.label || `Speakers ${i + 1}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
            {(
              <div className="call-react">
                <button
                  className="call-caret"
                  title="Screen share quality and sound"
                  aria-label="Screen share quality and sound"
                  onClick={() => setMenu(menu === "src" ? "" : "src")}
                >
                  <ChevronUp size={14} />
                </button>
                {menu === "src" && (
                  <div className="call-picker list">
                    <span className="picker-title">Quality</span>
                    {Object.entries(QUALITY).map(([k, q]) => (
                      <button
                        key={k}
                        onClick={() => {
                          setShareQ(k);
                          try {
                            localStorage.setItem("dispatch-share-q", k);
                          } catch {}
                          setMenu("");
                        }}
                      >
                        {shareQ === k ? "✓ " : ""}
                        <b>{q.label}</b> <small>{q.note}</small>
                      </button>
                    ))}
                    <span className="picker-title">Sound shared with your screen (others are virtual cables)</span>
                    {[{ deviceId: "default", label: "Everything this computer plays (default output)" }, ...mics.filter((x) => /stereo mix|voicemeeter|vb-audio|cable|loopback|what u hear|wave out/i.test(x.label) && !/^(default|communications) -/i.test(x.label))].map((d, i) => (
                      <button
                        key={d.deviceId}
                        onClick={() => {
                          setShareSrc(d.deviceId);
                          try {
                            localStorage.setItem("dispatch-share-src", d.deviceId);
                          } catch {}
                          setMenu("");
                        }}
                      >
                        {shareSrc === d.deviceId ? "✓ " : ""}
                        {d.label || `Input ${i}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
