import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { createReadStream, existsSync, constants } from "node:fs";
import {
  mkdir,
  copyFile,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };

// Layout of a backup root:
//   files/            mirror of every attachment ever backed up (attachments are immutable)
//   <stamp>/          one snapshot: mail.sqlite, manifest.json, secret-key(.enc)
// Snapshots are small; attachments are copied once, not once per snapshot.
const STAMP = /^\d{8}T\d{9}Z$/;
const stampOf = (date = new Date()) => date.toISOString().replace(/[-:.]/g, "");

export const backupRoot = (dataDir) =>
  resolve(
    /*turbopackIgnore: true*/ process.env.DISPATCH_BACKUP_DIR ||
      join(/*turbopackIgnore: true*/ dataDir, "backups"),
  );
export const keepCount = () =>
  Math.max(1, Number(process.env.DISPATCH_BACKUP_KEEP) || 14);

const sha256File = (path) =>
  new Promise((done, fail) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => h.update(c))
      .on("error", fail)
      .on("end", () => done(h.digest("hex")));
  });

function seal(buffer, passphrase) {
  const salt = randomBytes(16),
    iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      scryptSync(passphrase, salt, 32),
      iv,
    ),
    body = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return [salt, iv, cipher.getAuthTag(), body]
    .map((b) => b.toString("hex"))
    .join(/*turbopackIgnore: true*/ ".");
}
function unseal(text, passphrase) {
  const [salt, iv, tag, body] = text
    .trim()
    .split(".")
    .map((h) => Buffer.from(h, "hex"));
  const d = createDecipheriv(
    "aes-256-gcm",
    scryptSync(passphrase, salt, 32),
    iv,
  );
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(body), d.final()]);
  } catch {
    throw new Error("Wrong DISPATCH_BACKUP_PASSPHRASE for this backup");
  }
}

export async function listBackups(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of await readdir(root)) {
    if (!STAMP.test(name)) continue;
    try {
      const manifest = JSON.parse(
        await readFile(
          join(/*turbopackIgnore: true*/ root, name, "manifest.json"),
          "utf8",
        ),
      );
      out.push({ stamp: name, ...manifest });
    } catch {
      // incomplete or damaged snapshot; verify/restore will refuse it
    }
  }
  return out.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
}

// Takes a consistent snapshot of a live database (VACUUM INTO), then mirrors new attachments.
// The database is copied first, so every attachment it references already exists to copy.
export async function createBackup(
  dataDir,
  { db, root = backupRoot(dataDir) } = {},
) {
  dataDir = resolve(/*turbopackIgnore: true*/ dataDir);
  const stamp = stampOf(),
    work = join(/*turbopackIgnore: true*/ root, stamp + ".partial"),
    final = join(/*turbopackIgnore: true*/ root, stamp);
  await mkdir(join(/*turbopackIgnore: true*/ root, "files"), {
    recursive: true,
  });
  await rm(work, { recursive: true, force: true });
  await mkdir(work);
  try {
    const own = db
      ? null
      : new DatabaseSync(
          join(/*turbopackIgnore: true*/ dataDir, "mail.sqlite"),
          { timeout: 5000 },
        );
    try {
      (db || own)
        .prepare("VACUUM INTO ?")
        .run(join(/*turbopackIgnore: true*/ work, "mail.sqlite"));
    } finally {
      own?.close();
    }
    let copied = 0,
      total = 0;
    for (const name of await readdir(
      join(/*turbopackIgnore: true*/ dataDir, "files"),
    )) {
      total++;
      try {
        await copyFile(
          join(/*turbopackIgnore: true*/ dataDir, "files", name),
          join(/*turbopackIgnore: true*/ root, "files", name),
          constants.COPYFILE_EXCL,
        );
        copied++;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    let key = "none";
    const keyFile = join(/*turbopackIgnore: true*/ dataDir, ".secret-key");
    if (existsSync(keyFile)) {
      const pass = process.env.DISPATCH_BACKUP_PASSPHRASE;
      if (pass) {
        await writeFile(
          join(/*turbopackIgnore: true*/ work, "secret-key.enc"),
          seal(await readFile(keyFile), pass),
          { mode: 0o600 },
        );
        key = "encrypted";
      } else {
        await copyFile(
          keyFile,
          join(/*turbopackIgnore: true*/ work, "secret-key"),
        );
        key = "plain";
      }
    }
    const manifest = {
      format: 1,
      created: new Date().toISOString(),
      app_version: pkg.version,
      db_bytes: (
        await stat(join(/*turbopackIgnore: true*/ work, "mail.sqlite"))
      ).size,
      sqlite_sha256: await sha256File(
        join(/*turbopackIgnore: true*/ work, "mail.sqlite"),
      ),
      files_total: total,
      files_new: copied,
      key,
    };
    await writeFile(
      join(/*turbopackIgnore: true*/ work, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    await rename(work, final);
    const old = (await listBackups(root)).slice(keepCount());
    for (const b of old)
      await rm(join(/*turbopackIgnore: true*/ root, b.stamp), {
        recursive: true,
        force: true,
      });
    return { stamp, ...manifest, pruned: old.length };
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBackup(root, stamp) {
  const problems = [],
    dir = join(/*turbopackIgnore: true*/ root, stamp);
  if (
    !STAMP.test(stamp) ||
    !existsSync(join(/*turbopackIgnore: true*/ dir, "manifest.json"))
  )
    return { ok: false, problems: ["Backup not found or incomplete"] };
  const manifest = JSON.parse(
    await readFile(
      join(/*turbopackIgnore: true*/ dir, "manifest.json"),
      "utf8",
    ),
  );
  if (
    (await sha256File(join(/*turbopackIgnore: true*/ dir, "mail.sqlite"))) !==
    manifest.sqlite_sha256
  )
    problems.push("Database snapshot does not match its checksum");
  else {
    const db = new DatabaseSync(
      join(/*turbopackIgnore: true*/ dir, "mail.sqlite"),
      { readOnly: true },
    );
    try {
      const check = db.prepare("PRAGMA integrity_check").all()[0];
      if (Object.values(check)[0] !== "ok")
        problems.push("SQLite integrity check failed");
      for (const f of db
        .prepare("SELECT id,size,sha256 FROM attachments")
        .all()) {
        const path = join(/*turbopackIgnore: true*/ root, "files", f.id);
        if (!existsSync(path)) problems.push(`Missing attachment ${f.id}`);
        else if (
          (await stat(path)).size !== f.size ||
          (await sha256File(path)) !== f.sha256
        )
          problems.push(`Attachment ${f.id} is damaged`);
      }
    } finally {
      db.close();
    }
  }
  return { ok: problems.length === 0, problems, manifest };
}

// Restores into dataDir. The server must be stopped. Existing data is moved aside, never deleted.
export async function restoreBackup(
  root,
  stamp,
  dataDir,
  { force = false } = {},
) {
  dataDir = resolve(/*turbopackIgnore: true*/ dataDir);
  const checked = await verifyBackup(root, stamp);
  if (!checked.ok)
    throw new Error(
      "Refusing to restore: " +
        checked.problems.join(/*turbopackIgnore: true*/ "; "),
    );
  const dir = join(/*turbopackIgnore: true*/ root, stamp),
    db = join(/*turbopackIgnore: true*/ dataDir, "mail.sqlite");
  const pass = process.env.DISPATCH_BACKUP_PASSPHRASE;
  if (checked.manifest.key === "encrypted" && !pass)
    throw new Error(
      "This backup's key is encrypted. Set DISPATCH_BACKUP_PASSPHRASE.",
    );
  // Decrypt the key before touching anything, so a wrong passphrase leaves no partial restore.
  const keyBytes =
    checked.manifest.key === "encrypted"
      ? unseal(
          await readFile(
            join(/*turbopackIgnore: true*/ dir, "secret-key.enc"),
            "utf8",
          ),
          pass,
        )
      : checked.manifest.key === "plain"
        ? await readFile(join(/*turbopackIgnore: true*/ dir, "secret-key"))
        : null;
  await mkdir(join(/*turbopackIgnore: true*/ dataDir, "files"), {
    recursive: true,
  });
  let aside = null;
  if (existsSync(db)) {
    if (!force)
      throw new Error(
        "Data already exists in " +
          dataDir +
          ". Stop the server and pass --force to move it aside and restore.",
      );
    aside = join(/*turbopackIgnore: true*/ dataDir, "pre-restore-" + stampOf());
    await mkdir(aside);
    for (const name of [
      "mail.sqlite",
      "mail.sqlite-wal",
      "mail.sqlite-shm",
      ".secret-key",
    ])
      if (existsSync(join(/*turbopackIgnore: true*/ dataDir, name)))
        await rename(
          join(/*turbopackIgnore: true*/ dataDir, name),
          join(/*turbopackIgnore: true*/ aside, name),
        );
  }
  await copyFile(join(/*turbopackIgnore: true*/ dir, "mail.sqlite"), db);
  for (const name of await readdir(
    join(/*turbopackIgnore: true*/ root, "files"),
  )) {
    try {
      await copyFile(
        join(/*turbopackIgnore: true*/ root, "files", name),
        join(/*turbopackIgnore: true*/ dataDir, "files", name),
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  if (keyBytes)
    await writeFile(
      join(/*turbopackIgnore: true*/ dataDir, ".secret-key"),
      keyBytes,
      { mode: 0o600 },
    );
  return { stamp, aside, manifest: checked.manifest };
}
