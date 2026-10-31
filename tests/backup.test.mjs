import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MailStore } from "../lib/store.mjs";
import { createBackup, listBackups, verifyBackup, restoreBackup } from "../lib/backup.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "dispatch-backup-"));
const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
};

test("backups are consistent, incremental, pruned, verifiable and restorable", async () => {
  const data = tmp(),
    root = tmp(),
    target = tmp();
  let store;
  try {
    store = new MailStore(data);
    writeFileSync(join(data, ".secret-key"), "ab".repeat(32));
    store.ensureProject("alpha");
    const first = store.upload("alpha", "one.txt", Buffer.from("first file"));

    const one = await createBackup(data, { db: store.db, root });
    assert.equal(one.files_new, 1);
    assert.equal(one.key, "plain");
    assert.deepEqual((await verifyBackup(root, one.stamp)).problems, []);

    // Incremental: only the new attachment is copied; both snapshots stay usable.
    const second = store.upload("alpha", "two.txt", Buffer.from("second file"));
    store.ensureProject("beta");
    const two = await createBackup(data, { db: store.db, root });
    assert.equal(two.files_new, 1);
    assert.equal(two.files_total, 2);
    assert.deepEqual((await listBackups(root)).map((b) => b.stamp), [two.stamp, one.stamp]);
    assert.deepEqual(readdirSync(join(root, "files")).sort(), [first.id, second.id].sort());

    // Retention keeps only the newest N snapshots.
    await withEnv({ DISPATCH_BACKUP_KEEP: "2" }, () => createBackup(data, { db: store.db, root }));
    assert.equal((await listBackups(root)).length, 2);
    assert.ok(!existsSync(join(root, one.stamp)));
    const newest = (await listBackups(root))[0].stamp;

    // Restore into an empty directory.
    const restored = await restoreBackup(root, newest, target);
    assert.equal(restored.aside, null);
    const db = new DatabaseSync(join(target, "mail.sqlite"), { readOnly: true });
    assert.deepEqual(db.prepare("SELECT name FROM projects ORDER BY name").all().map((r) => r.name), ["alpha", "beta"]);
    db.close();
    assert.equal(readFileSync(join(target, "files", first.id), "utf8"), "first file");
    assert.equal(readFileSync(join(target, ".secret-key"), "utf8"), "ab".repeat(32));

    // Existing data is never overwritten without --force, and is moved aside with it.
    await assert.rejects(() => restoreBackup(root, newest, target), /--force/);
    const forced = await restoreBackup(root, newest, target, { force: true });
    assert.ok(existsSync(join(forced.aside, "mail.sqlite")));
  } finally {
    store?.db.close();
    for (const d of [data, root, target]) rmSync(d, { recursive: true, force: true });
  }
});

test("verify catches damaged attachments and snapshots; restore refuses them", async () => {
  const data = tmp(),
    root = tmp(),
    target = tmp();
  let store;
  try {
    store = new MailStore(data);
    store.ensureProject("alpha");
    const file = store.upload("alpha", "a.txt", Buffer.from("precious"));
    const b = await createBackup(data, { db: store.db, root });
    assert.equal(b.key, "none");

    appendFileSync(join(root, "files", file.id), "x");
    const bad = await verifyBackup(root, b.stamp);
    assert.equal(bad.ok, false);
    assert.match(bad.problems.join(), /damaged/);
    await assert.rejects(() => restoreBackup(root, b.stamp, target), /Refusing to restore/);

    writeFileSync(join(root, "files", file.id), "precious");
    appendFileSync(join(root, b.stamp, "mail.sqlite"), "x");
    assert.match((await verifyBackup(root, b.stamp)).problems.join(), /checksum/);
    assert.equal((await verifyBackup(root, "../etc")).ok, false);
  } finally {
    store?.db.close();
    for (const d of [data, root, target]) rmSync(d, { recursive: true, force: true });
  }
});

test("the encryption key is sealed with a passphrase and needs it to restore", async () => {
  const data = tmp(),
    root = tmp(),
    target = tmp();
  let store;
  try {
    store = new MailStore(data);
    writeFileSync(join(data, ".secret-key"), "cd".repeat(32));
    const b = await withEnv({ DISPATCH_BACKUP_PASSPHRASE: "correct horse" }, () =>
      createBackup(data, { db: store.db, root }),
    );
    assert.equal(b.key, "encrypted");
    assert.ok(!existsSync(join(root, b.stamp, "secret-key")));
    assert.ok(!readFileSync(join(root, b.stamp, "secret-key.enc"), "utf8").includes("cdcdcd"));

    await assert.rejects(() => restoreBackup(root, b.stamp, target), /DISPATCH_BACKUP_PASSPHRASE/);
    await assert.rejects(
      () => withEnv({ DISPATCH_BACKUP_PASSPHRASE: "wrong" }, () => restoreBackup(root, b.stamp, target)),
      /Wrong DISPATCH_BACKUP_PASSPHRASE/,
    );
    await withEnv({ DISPATCH_BACKUP_PASSPHRASE: "correct horse" }, () => restoreBackup(root, b.stamp, target));
    assert.equal(readFileSync(join(target, ".secret-key"), "utf8"), "cd".repeat(32));
  } finally {
    store?.db.close();
    for (const d of [data, root, target]) rmSync(d, { recursive: true, force: true });
  }
});
