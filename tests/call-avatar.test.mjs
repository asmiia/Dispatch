import test from "node:test";
import assert from "node:assert/strict";
import * as calls from "../lib/calls.mjs";

test("a changed or removed profile picture reaches people already in the call", () => {
  const t = "thread-" + Math.random(),
    sam = { id: "u1", name: "Sam Okoro", avatar_v: "old" },
    lena = { id: "u2", name: "Lena Fischer" };
  const a = calls.join(t, sam),
    b = calls.join(t, lena);
  const seen = () => calls.poll(t, lena, b.peer).peers.find((p) => p.uid === sam.id).avatar_v;
  assert.equal(seen(), "old");
  calls.refreshAvatar(sam.id, "new");
  assert.equal(seen(), "new");
  calls.refreshAvatar(sam.id, null);
  assert.equal(seen(), null);
  calls.leave(t, sam, a.peer);
  calls.leave(t, lena, b.peer);
});
