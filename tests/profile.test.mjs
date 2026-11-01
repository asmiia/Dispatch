import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailStore } from "../lib/store.mjs";
import { Security, ScopedMail } from "../lib/security.mjs";
import { accounts } from "../lib/accounts.mjs";

// Just enough of a PNG header for the size check: signature plus an IHDR chunk.
const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const b64 = (b) => b.toString("base64");

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-profile-")),
    store = new MailStore(dir),
    sec = new Security(store),
    acc = accounts(sec);
  const admin = await sec.register(
    {
      email: "admin@example.com",
      name: "Admin",
      password: "admin password 12345",
    },
    true,
  );
  const actor = { kind: "user", id: admin.id },
    team = sec.teams(actor)[0].id;
  return { dir, store, sec, acc, actor, team, admin };
}
const join2 = async (sec, actor, team, email, name) => {
  const invite = sec.invite(actor, { team_id: team, email, role: "member" });
  const user = await sec.register({
    email,
    name,
    password: name + " password 123456",
    invite_code: invite.code,
  });
  return { user, actor: { kind: "user", id: user.id } };
};

test("keys can expire, or never expire", async () => {
  const { dir, store, sec, actor, team } = await setup();
  try {
    const db = new ScopedMail(sec, actor),
      project = db.ensureProject("alpha", team);
    db.register({
      project_key: project.id,
      name: "Navy",
      program: "x",
      model: "y",
    });
    const key = (name, days) =>
      sec.issueKey(actor, {
        project_key: project.id,
        agent_name: "Navy",
        name,
        days,
      });
    key("default");
    key("year", 365);
    key("forever", 0);
    const rows = store.db
      .prepare("SELECT name,expires_at FROM agent_keys")
      .all()
      .reduce((o, r) => ({ ...o, [r.name]: r.expires_at }), {});
    assert.ok(Math.abs(rows.default - (Date.now() + 30 * 86400000)) < 60000);
    assert.ok(Math.abs(rows.year - (Date.now() + 365 * 86400000)) < 60000);
    assert.ok(
      rows.forever > Date.now() + 1000 * 365 * 86400000,
      "never-expiring keys last for centuries",
    );
    assert.throws(() => key("bad", 5000), /Key lifetime/);
    assert.throws(() => key("bad", -1), /Key lifetime/);
    assert.match(
      sec.issuePersonalKey(actor, { team_id: team, name: "forever", days: 0 })
        .token,
      /^at_user_/,
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agents without a name get a unique memorable one", async () => {
  const { dir, store, sec, actor, team } = await setup();
  try {
    const db = new ScopedMail(sec, actor),
      project = db.ensureProject("alpha", team);
    const names = Array.from(
      { length: 25 },
      () =>
        db.register({
          project_key: project.id,
          program: "claude-code",
          model: "opus",
        }).name,
    );
    assert.equal(new Set(names).size, 25);
    for (const name of names) assert.match(name, /^[A-Z][a-z]+[A-Z][a-z]+\d*$/);
    // A name you choose is still used as given.
    assert.equal(
      db.register({
        project_key: project.id,
        name: "ReviewBot",
        program: "x",
        model: "y",
      }).name,
      "ReviewBot",
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("profile photos must be square PNG or JPEG, and are only visible to teammates", async () => {
  const { dir, store, sec, acc, actor, team, admin } = await setup();
  try {
    const dev = await join2(sec, actor, team, "dev@example.com", "Dev");
    const other = sec.newTeam(actor, "Other");
    const stranger = await join2(
      sec,
      actor,
      other.id,
      "x@example.com",
      "Xavier",
    );

    assert.throws(
      () => acc.setAvatar(actor, { data_base64: b64(png(64, 32)) }),
      /square/,
    );
    assert.throws(
      () => acc.setAvatar(actor, { data_base64: b64(png(32, 32)) }),
      /square/,
    );
    assert.throws(
      () =>
        acc.setAvatar(actor, { data_base64: b64(Buffer.from("GIF89a....")) }),
      /PNG or JPEG/,
    );
    assert.throws(
      () => acc.setAvatar(actor, { data_base64: "not base64!" }),
      /Invalid image/,
    );
    assert.throws(
      () =>
        acc.setAvatar(actor, {
          data_base64: b64(
            Buffer.concat([png(128, 128), Buffer.alloc(401 * 1024)]),
          ),
        }),
      /400 KB/,
    );

    const done = acc.setAvatar(dev.actor, { data_base64: b64(png(128, 128)) });
    assert.match(done.avatar_v, /^[a-f0-9]{12}$/);
    assert.equal(acc.avatar(dev.actor, dev.user.id).mime, "image/png");
    assert.equal(
      acc.avatar(actor, dev.user.id).version,
      done.avatar_v,
      "a teammate can see it",
    );
    assert.throws(
      () => acc.avatar(stranger.actor, dev.user.id),
      /Not found/,
      "someone on another team cannot",
    );
    assert.throws(
      () => acc.avatar(actor, admin.id),
      /Not found/,
      "no photo set",
    );
    assert.equal(
      sec.settings(actor, team).members.find((m) => m.id === dev.user.id)
        .avatar_v,
      done.avatar_v,
    );
    acc.removeAvatar(dev.actor);
    assert.throws(() => acc.avatar(dev.actor, dev.user.id), /Not found/);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("instance analytics are for administrators and add up", async () => {
  const { dir, store, sec, acc, actor, team } = await setup();
  try {
    const db = new ScopedMail(sec, actor),
      project = db.ensureProject("alpha", team);
    for (const name of ["Navy", "Ice"])
      db.register({
        project_key: project.id,
        name,
        program: name === "Navy" ? "claude-code" : "codex",
        model: "m",
      });
    for (let i = 0; i < 3; i++)
      db.send({
        project_key: project.id,
        sender_name: "Navy",
        to: ["Ice"],
        subject: "s" + i,
        body_md: "b",
      });
    db.upload(project.id, "a.txt", Buffer.from("hello"));
    const a = acc.analytics(actor);
    assert.equal(a.days.length, 30);
    for (const key of ["messages", "signins", "failed", "new_users"])
      assert.equal(a.series[key].length, 30);
    assert.equal(a.totals.messages, 3);
    assert.equal(a.totals.agents, 2);
    assert.equal(a.totals.file_bytes, 5);
    assert.equal(
      a.series.messages.reduce((x, y) => x + y, 0),
      3,
    );
    assert.equal(a.top_agents[0].name, "Navy");
    assert.deepEqual(a.by_program.map((p) => p.program).sort(), [
      "claude-code",
      "codex",
    ]);
    assert.equal(a.storage[0].bytes, 5);
    assert.ok(a.system.database_bytes > 0 && a.system.version);
    const dev = await join2(sec, actor, team, "dev@example.com", "Dev");
    assert.throws(() => acc.analytics(dev.actor), /Instance administration/);
    assert.throws(
      () => acc.analytics({ ...actor, team_scope: team }),
      /browser session/,
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
