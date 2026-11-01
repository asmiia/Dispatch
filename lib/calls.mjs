// Voice calls: the server only relays WebRTC signalling between people in a conversation.
// Audio goes straight between browsers. Rooms live in memory and clear themselves.
import { randomUUID } from "node:crypto";
import { MailError } from "./store.mjs";

const rooms = (globalThis.__dispatchCalls ??= new Map());
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
});
const tell = (r, except, event) => {
  for (const p of r.values()) if (p.id !== except) p.queue.push(event);
};
function sweep(thread) {
  const r = rooms.get(thread);
  if (!r) return;
  for (const p of [...r.values()])
    if (Date.now() - p.seen > TTL) {
      r.delete(p.id);
      tell(r, p.id, { type: "leave", id: p.id });
    }
  if (!r.size) rooms.delete(thread);
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
  if (!r.size) rooms.delete(thread);
  return { ok: true };
}
