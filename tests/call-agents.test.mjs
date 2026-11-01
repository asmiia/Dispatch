import test from "node:test";
import assert from "node:assert/strict";
import * as calls from "../lib/calls.mjs";
import { callTools } from "../lib/call-tools.mjs";

test("agents join calls, speak to people and follow the transcript", () => {
  const t = "thread-" + Math.random(),
    sam = { id: "u1", name: "Sam Okoro" },
    bot = { id: "a1", name: "Scribe" };
  const human = calls.join(t, sam);
  const joined = calls.joinAgent(t, bot);
  assert.equal(calls.joinAgent(t, bot).peer, joined.peer, "joining twice is idempotent");
  assert.ok(joined.people.some((p) => p.agent && p.name === "Scribe"));

  // People see the agent in the list, and get a "say" event to read aloud.
  calls.agentSay(t, bot, "  Notes are in #docs-move.  ");
  const got = calls.poll(t, sam, human.peer);
  const say = got.events.find((e) => e.type === "say");
  assert.equal(say.text, "Notes are in #docs-move.");
  assert.ok(got.events.some((e) => e.type === "join"));

  // The agent hears people through captions, and only members may post them.
  calls.caption(t, sam, human.peer, "ship it friday");
  assert.throws(() => calls.caption(t, { id: "u2" }, human.peer, "x"), /Not in this call/);
  const heard = calls.agentListen(t, bot, 0);
  assert.deepEqual(heard.lines.map((l) => l.text).filter(Boolean), ["Notes are in #docs-move.", "ship it friday"]);
  assert.equal(calls.agentListen(t, bot, heard.next_seq).lines.length, 0);

  assert.throws(() => calls.agentSay(t, { id: "a2", name: "Other" }, "hi"), /Join the call first/);
  calls.agentLeave(t, bot);
  assert.ok(!calls.status(t).people.some((p) => p.agent));
  calls.leave(t, sam, human.peer);
});

test("call tools are exposed over MCP", () => {
  assert.deepEqual(
    callTools.map((x) => x.name),
    ["call_join", "call_say", "call_listen", "call_leave", "call_status"],
  );
});
