import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailStore, filename, MAX_FILE } from "../lib/store.mjs";

test("messages, threads, files and receipts persist; retries do not duplicate sends", () => {
  const directory = mkdtempSync(join(tmpdir(), "dispatch-store-"));
  let db = new MailStore(directory);
  try {
    const p = db.ensureProject("Example Project");
    assert.equal(db.ensureProject("Example Project").id, p.id);
    db.register({ project_key: p.id, name: "CopperGrove" });
    db.register({ project_key: p.id, name: "SilverPine" });
    const f = db.upload(
      p.id,
      "preview.zip",
      Buffer.from("private preview bytes"),
    );
    const input = {
      project_key: p.id,
      sender_name: "CopperGrove",
      to: ["SilverPine"],
      subject: "Preview handoff",
      body_md: "See attached.",
      attachment_paths: [f.id],
      idempotency_key: "handoff-1",
    };
    const message = db.send(input);
    assert.equal(db.send(input).id, message.id);
    assert.throws(
      () => db.send({ ...input, body_md: "different" }),
      /different contents/,
    );
    assert.equal(db.inbox(p.id, "SilverPine").length, 1);
    assert.equal(db.inbox(p.id, "CopperGrove").length, 0);
    assert.equal(db.inbox(p.id, "SilverPine", "preview").length, 1);
    assert.equal(db.inbox(p.id, "SilverPine", "' OR 1=1 --").length, 0);
    assert.equal(message.attachments[0].filename, "preview.zip");
    assert.deepEqual(
      db.download(f.id).bytes,
      Buffer.from("private preview bytes"),
    );
    db.read(message.id, "SilverPine");
    assert.ok(db.message(message.id).recipients[0].read_at);
    db.send({
      project_key: p.id,
      sender_name: "SilverPine",
      to: ["CopperGrove"],
      subject: "Re: Preview handoff",
      body_md: "Received.",
      thread_id: message.thread_id,
    });
    assert.equal(db.thread(message.id).length, 2);
    db.db.close();
    db = new MailStore(directory);
    assert.equal(db.thread(message.id).length, 2);
  } finally {
    db.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("server paths, oversized uploads and cross-project attachment/thread references are rejected", () => {
  const directory = mkdtempSync(join(tmpdir(), "dispatch-scope-"));
  const db = new MailStore(directory);
  try {
    const a = db.ensureProject("A"),
      b = db.ensureProject("B");
    for (const p of [a, b])
      db.register({ project_key: p.id, name: "Operator" });
    for (const name of [
      "../secret",
      "C:\\Windows\\secret",
      "file:stream",
      "CON.txt",
      "bad\nname",
      "foo.",
      "..",
    ])
      assert.throws(() => filename(name));
    assert.equal(filename("preview data.zip"), "preview data.zip");
    assert.throws(() =>
      db.upload(a.id, "large.zip", Buffer.alloc(MAX_FILE + 1)),
    );
    const file = db.upload(a.id, "notes.txt", Buffer.from("notes"));
    const base = {
      project_key: b.id,
      sender_name: "Operator",
      to: ["Operator"],
      subject: "Scope test",
      body_md: "test",
    };
    assert.throws(
      () => db.send({ ...base, attachment_paths: [file.id] }),
      /another project/,
    );
    assert.throws(
      () => db.send({ ...base, attachment_paths: ["C:\\Windows\\secret"] }),
      /File not found/,
    );
    const message = db.send({ ...base, project_key: a.id });
    assert.throws(
      () => db.send({ ...base, thread_id: message.thread_id }),
      /Thread not found/,
    );
    assert.equal(db.inbox(b.id, "Operator").length, 0);
  } finally {
    db.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
