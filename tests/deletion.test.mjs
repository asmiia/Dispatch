import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { MailStore } from "../lib/store.mjs";
import { Security, ScopedMail } from "../lib/security.mjs";
import {
  deleteMessagesAs,
  deleteProjectAs,
  deleteTeamAs,
  deleteUserRecords,
  exportAccount,
  exportTeam,
} from "../lib/deletion.mjs";
import { accounts } from "../lib/accounts.mjs";
import { runRetention } from "../lib/maintenance.mjs";

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-del-")),
    store = new MailStore(dir),
    sec = new Security(store);
  accounts(sec);
  const admin = await sec.register(
    {
      email: "admin@example.com",
      name: "Admin",
      password: "admin password 12345",
    },
    true,
  );
  const actor = { kind: "user", id: admin.id },
    team = sec.teams(actor)[0].id,
    db = new ScopedMail(sec, actor),
    project = db.ensureProject("alpha", team);
  for (const name of ["Navy", "Ice"])
    db.register({ project_key: project.id, name, program: "x", model: "y" });
  const file = (name, text) => db.upload(project.id, name, Buffer.from(text));
  const send = (subject, files) =>
    db.send({
      project_key: project.id,
      sender_name: "Navy",
      to: ["Ice"],
      subject,
      body_md: "body " + subject,
      attachment_paths: files.map((f) => f.id),
    });
  return { dir, store, sec, actor, team, db, project, file, send };
}
const onDisk = (dir, f) => existsSync(join(dir, "files", f.id));

test("deleting messages removes orphaned files but keeps files other messages still attach", async () => {
  const { dir, store, sec, actor, file, send } = await setup();
  try {
    const f1 = file("one.txt", "one"),
      f2 = file("two.txt", "two");
    const m1 = send("first", [f1, f2]),
      m2 = send("second", [f2]);
    const r = deleteMessagesAs(sec, actor, [m1.id]);
    assert.deepEqual(r, { messages: 1, files: 1 });
    assert.ok(!onDisk(dir, f1), "orphaned file is gone from disk");
    assert.ok(onDisk(dir, f2), "shared file survives");
    assert.equal(
      store.db.prepare("SELECT COUNT(*) c FROM messages").get().c,
      1,
    );
    assert.equal(deleteMessagesAs(sec, actor, [m2.id]).files, 1);
    assert.ok(!onDisk(dir, f2));
    assert.equal(
      store.db.prepare("SELECT COUNT(*) c FROM attachments").get().c,
      0,
    );
    assert.ok(
      sec.db
        .prepare("SELECT 1 FROM audit WHERE action='messages.deleted'")
        .get(),
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only team admins can delete; project and team deletion need the name and cascade fully", async () => {
  const { dir, store, sec, actor, team, db, project, file, send } =
    await setup();
  try {
    const f = file("a.txt", "a");
    const m = send("hello", [f]);
    const invite = sec.invite(actor, {
      team_id: team,
      email: "dev@example.com",
      role: "member",
    });
    const dev = await sec.register({
      email: "dev@example.com",
      name: "Dev",
      password: "dev password 123456",
      invite_code: invite.code,
    });
    const member = { kind: "user", id: dev.id };
    assert.throws(() => deleteMessagesAs(sec, member, [m.id]), /Insufficient/);
    assert.throws(
      () => deleteProjectAs(sec, member, project.id, "alpha"),
      /Not found/,
    );
    assert.throws(
      () => deleteProjectAs(sec, actor, project.id, "wrong"),
      /Type the project name/,
    );

    const exported = exportTeam(sec, actor, team);
    const tar = gunzipSync(exported).toString("latin1");
    assert.ok(
      tar.includes("export.json") &&
        tar.includes("body hello") &&
        tar.includes("a.txt"),
    );
    assert.throws(() => exportTeam(sec, member, team), /Insufficient/);
    assert.equal(exportAccount(sec, actor).account.email, "admin@example.com");

    const gone = deleteProjectAs(sec, actor, "alpha", "alpha");
    assert.equal(gone.messages, 1);
    assert.ok(!onDisk(dir, f));
    for (const t of [
      "projects",
      "agents",
      "messages",
      "recipients",
      "attachments",
      "message_files",
    ])
      assert.equal(
        store.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c,
        0,
        t,
      );

    db.ensureProject("beta", team);
    assert.throws(
      () => deleteTeamAs(sec, member, team, "My team"),
      /Insufficient/,
    );
    assert.throws(
      () => deleteTeamAs(sec, actor, team, "nope"),
      /Type the team name/,
    );
    deleteTeamAs(sec, actor, team, "My team");
    assert.equal(store.db.prepare("SELECT COUNT(*) c FROM teams").get().c, 0);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) c FROM projects").get().c,
      0,
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("account deletion removes personal data and protects owners and the last administrator", async () => {
  const { dir, store, sec, actor, team } = await setup();
  try {
    const invite = sec.invite(actor, {
      team_id: team,
      email: "dev@example.com",
      role: "member",
    });
    const dev = await sec.register({
      email: "dev@example.com",
      name: "Dev",
      password: "dev password 123456",
      invite_code: invite.code,
    });
    const acc = accounts(sec);
    acc.record({
      user_id: dev.id,
      email: dev.email,
      ok: true,
      method: "password",
    });
    sec.session({ id: dev.id }, { ip: "1.2.3.4", ua: "test" });
    assert.throws(() => deleteUserRecords(sec, actor.id), /Transfer ownership/);
    store.db
      .prepare("UPDATE memberships SET role='owner' WHERE user_id=?")
      .run(dev.id);
    assert.throws(
      () => deleteUserRecords(sec, actor.id),
      /only instance administrator/,
    );
    store.db
      .prepare("UPDATE memberships SET role='member' WHERE user_id=?")
      .run(dev.id);
    deleteUserRecords(sec, dev.id);
    for (const t of ["users", "memberships", "sessions", "login_events"])
      assert.equal(
        store.db
          .prepare(
            `SELECT COUNT(*) c FROM ${t} WHERE ${t === "users" ? "id" : "user_id"}=?`,
          )
          .get(dev.id).c,
        0,
        t,
      );
    assert.ok(
      sec.db.prepare("SELECT 1 FROM audit WHERE actor_id='deleted'").get(),
    );
    assert.throws(() => deleteUserRecords(sec, "nope"), /not found/);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retention deletes old messages per team and trims the audit log", async () => {
  const { dir, store, sec, actor, team, file, send } = await setup();
  try {
    const f = file("old.txt", "old");
    const oldMessage = send("old", [f]),
      freshMessage = send("fresh", []);
    store.db
      .prepare("UPDATE messages SET created_at=? WHERE id=?")
      .run(new Date(Date.now() - 40 * 86400000).toISOString(), oldMessage.id);
    assert.throws(
      () => sec.setRetention(actor, { team_id: team, days: -1 }),
      /Retention/,
    );
    assert.deepEqual(runRetention(sec), { messages: 0, files: 0, audit: 0 }); // off by default
    sec.setRetention(actor, { team_id: team, days: 30 });
    const r = runRetention(sec);
    assert.equal(r.messages, 1);
    assert.equal(r.files, 1);
    assert.ok(!onDisk(dir, f));
    assert.deepEqual(
      store.db
        .prepare("SELECT subject FROM messages")
        .all()
        .map((m) => m.subject),
      ["fresh"],
    );
    assert.ok(freshMessage.id);
    // Audit rows past the retention window go.
    store.db
      .prepare("UPDATE audit SET created_at=? WHERE action='project.created'")
      .run(new Date(Date.now() - 400 * 86400000).toISOString());
    assert.ok(runRetention(sec).audit >= 1);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
