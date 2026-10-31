import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("a failed backup emails the instance administrators, once", { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-alerts-")),
    setup = randomBytes(32).toString("hex"),
    port = 3086,
    origin = `http://127.0.0.1:${port}`,
    badBackupDir = dir + "-not-a-directory", // a file where the backup folder should be
    mailFile = dir + "-mail.jsonl";
  writeFileSync(badBackupDir, "x");
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        DISPATCH_SETUP_KEY: setup,
        DISPATCH_DATA_DIR: dir,
        DISPATCH_BACKUP_DIR: badBackupDir,
        DISPATCH_BACKUP_PASSPHRASE: "",
        DISPATCH_BACKUP_INTERVAL_HOURS: "24",
        DISPATCH_MAIL_FILE: mailFile,
        DISPATCH_LOG_LEVEL: "error",
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin + "/health")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const req = (path, body, headers = {}) =>
      fetch(origin + path, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", Origin: origin, ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const reg = await req("/api/auth/register", { email: "root@example.com", name: "Root", password: "root password 12345", setup_key: setup });
    const cookie = { Cookie: reg.headers.get("set-cookie").split(";")[0] };

    const failed = await req("/api/settings/backups/run", {}, cookie);
    assert.equal(failed.status, 500);
    assert.match((await failed.json()).error, /Backup failed/);
    await new Promise((r) => setTimeout(r, 400));
    const mails = () =>
      existsSync(mailFile) ? readFileSync(mailFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    assert.equal(mails().length, 1);
    assert.equal(mails()[0].to, "root@example.com");
    assert.equal(mails()[0].subject, "Dispatch backup failed");

    // A second failure inside the quiet period does not send another email.
    assert.equal((await req("/api/settings/backups/run", {}, cookie)).status, 500);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(mails().length, 1);
    const status = await (await req("/api/settings/backups", null, cookie)).json();
    assert.match(status.last_error, /./);
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 400));
    for (const p of [dir, badBackupDir, mailFile]) rmSync(p, { recursive: true, force: true });
  }
});
