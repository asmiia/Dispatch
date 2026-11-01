// Voice calls: the server only relays WebRTC signalling between people in a conversation.
// Audio goes straight between browsers. Rooms live in memory and clear themselves.
import { randomUUID } from "node:crypto";
import { MailError } from "./store.mjs";

const rooms = (globalThis.__dispatchCalls ??= new Map());
const transcripts = (globalThis.__dispatchTranscripts ??= new Map());
const AGENT_TTL = 180000, // agents act in bursts, so they are kept in the call longer than a browser tab
  MAX_LINES = 300,
  MAX_SAY = 1000;
const TTL = 15000,
  MAX_PEERS = 8,
  MAX_SIGNAL = 20000;

// Public STUN helps two people behind home routers find each other. Set DISPATCH_ICE_SERVERS to a JSON
// array (STUN and TURN) to use your own, or [] to use none.
export function iceServers() {
  try {
    const own = JSON.parse(process.env.DISPATCH_ICE_SERVERS || "null");
    if (Array.isArray(own)) return own;
  } catch {}
  return [{ urls: "stun:stun.cloudflare.com:3478" }];
}

const room = (thread) => {
  let r = rooms.get(thread);
  if (!r) rooms.set(thread, (r = new Map()));
  return r;
};
const pub = (p) => ({
  id: p.id,
  name: p.name,
  uid: p.uid,
  avatar_v: p.avatar_v,
  ...(p.agent ? { agent: true } : {}),
});
// Agents have no browser to poll with, so they are never sent events (they read the transcript instead).
const tell = (r, except, event) => {
  for (const p of r.values())
    if (p.id !== except && !p.agent) p.queue.push(event);
};
const closeRoom = (thread) => {
  rooms.delete(thread);
  transcripts.delete(thread);
};
const note = (thread, entry) => {
  let t = transcripts.get(thread);
  if (!t) transcripts.set(thread, (t = { seq: 0, lines: [] }));
  const line = { seq: ++t.seq, at: new Date().toISOString(), ...entry };
  t.lines.push(line);
  if (t.lines.length > MAX_LINES) t.lines.splice(0, t.lines.length - MAX_LINES);
  return line;
};
function sweep(thread) {
  const r = rooms.get(thread);
  if (!r) return;
  for (const p of [...r.values()])
    if (Date.now() - p.seen > (p.agent ? AGENT_TTL : TTL)) {
      r.delete(p.id);
      tell(r, p.id, { type: "leave", id: p.id });
    }
  if (!r.size) closeRoom(thread);
}

export function join(thread, user) {
  sweep(thread);
  const r = room(thread);
  if (r.size >= MAX_PEERS) throw new MailError("This call is full", 409);
  const peer = {
    id: randomUUID(),
    uid: user.id,
    name: user.name,
    avatar_v: user.avatar_v || null,
    seen: Date.now(),
    queue: [],
  };
  const others = [...r.values()].map(pub);
  tell(r, peer.id, { type: "join", peer: pub(peer) });
  r.set(peer.id, peer);
  return { thread_id: thread, peer: peer.id, peers: others, ice: iceServers() };
}

// A peer may only act as itself: its id is secret to the person who joined.
function member(thread, id, user) {
  const p = rooms.get(thread)?.get(id);
  if (!p || p.uid !== user.id) throw new MailError("Not in this call", 403);
  return p;
}

export function signal(thread, user, { from, to, data }) {
  const me = member(thread, from, user),
    target = rooms.get(thread).get(to);
  if (!target) return { ok: false };
  if (JSON.stringify(data ?? null).length > MAX_SIGNAL)
    throw new MailError("Signal too large", 413);
  me.seen = Date.now();
  target.queue.push({ type: "signal", from, data });
  return { ok: true };
}

export function poll(thread, user, id) {
  const me = member(thread, id, user);
  me.seen = Date.now();
  sweep(thread);
  const events = me.queue.splice(0);
  return { events, peers: [...(rooms.get(thread)?.values() || [])].map(pub) };
}

// Who is in a conversation's call right now, for the badge on the phone button.
export function status(thread) {
  sweep(thread);
  return { people: [...(rooms.get(thread)?.values() || [])].map(pub) };
}

// Every call that is live right now (thread ids and who is in them). The route keeps only those you can read.
export function active() {
  for (const thread of [...rooms.keys()]) sweep(thread);
  return [...rooms.entries()].map(([thread_id, r]) => ({
    thread_id,
    people: [...r.values()].map(pub),
  }));
}

export function leave(thread, user, id) {
  const r = rooms.get(thread);
  if (!r?.get(id) || r.get(id).uid !== user.id) return { ok: true };
  r.delete(id);
  tell(r, id, { type: "leave", id });
  if (!r.size) closeRoom(thread);
  return { ok: true };
}

// ---- Agents in calls --------------------------------------------------------------------------------
// An agent has no microphone. It joins as a listed participant, "says" text that every person's browser
// reads aloud, and "hears" the call through a transcript that people's browsers write (captions).
const agentPeer = (thread, uid) =>
  [...(rooms.get(thread)?.values() || [])].find(
    (p) => p.agent && p.uid === uid,
  );

export function joinAgent(thread, agent) {
  sweep(thread);
  const r = room(thread),
    uid = "agent:" + agent.id,
    old = agentPeer(thread, uid);
  if (old) {
    old.seen = Date.now();
    return {
      thread_id: thread,
      peer: old.id,
      people: [...r.values()].map(pub),
    };
  }
  if (r.size >= MAX_PEERS) throw new MailError("This call is full", 409);
  const peer = {
    id: randomUUID(),
    uid,
    name: agent.name,
    avatar_v: null,
    agent: true,
    seen: Date.now(),
    queue: [],
  };
  tell(r, peer.id, { type: "join", peer: pub(peer) });
  r.set(peer.id, peer);
  note(thread, { kind: "join", name: agent.name });
  return { thread_id: thread, peer: peer.id, people: [...r.values()].map(pub) };
}

export function agentSay(thread, agent, input) {
  const me = agentPeer(thread, "agent:" + agent.id);
  if (!me) throw new MailError("Join the call first", 409);
  const text = String(input ?? "")
    .trim()
    .slice(0, MAX_SAY);
  if (!text) throw new MailError("Nothing to say");
  me.seen = Date.now();
  const line = note(thread, { kind: "say", name: me.name, agent: true, text });
  tell(rooms.get(thread), me.id, {
    type: "say",
    id: randomUUID(),
    from: me.id,
    name: me.name,
    text,
  });
  return { ok: true, seq: line.seq };
}

export function agentListen(thread, agent, after = 0, limit = 100) {
  const me = agentPeer(thread, "agent:" + agent.id);
  if (!me) throw new MailError("Join the call first", 409);
  me.seen = Date.now();
  sweep(thread);
  const t = transcripts.get(thread) || { seq: 0, lines: [] },
    lines = t.lines.filter((l) => l.seq > after).slice(0, limit);
  return {
    lines,
    next_seq: lines.length ? lines[lines.length - 1].seq : Math.max(after, 0),
    people: [...(rooms.get(thread)?.values() || [])].map(pub),
  };
}

export function agentLeave(thread, agent) {
  const me = agentPeer(thread, "agent:" + agent.id);
  if (me) leave(thread, { id: me.uid }, me.id);
  return { ok: true };
}

// A person's browser turns speech into text and posts it here, so agents in the call can follow along.
export function caption(thread, user, id, input) {
  const me = member(thread, id, user),
    text = String(input ?? "")
      .trim()
      .slice(0, MAX_SAY);
  if (!text) return { ok: true };
  me.seen = Date.now();
  note(thread, { kind: "say", name: me.name, text });
  return { ok: true };
}
