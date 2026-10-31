import { store, MailError } from "./store.mjs";
import { createBackup, listBackups, backupRoot, keepCount } from "./backup.mjs";
import { sep } from "node:path";
import { log } from "./log.mjs";

const state = (globalThis.__dispatchBackup ??= {
  running: false,
  last_ok: null,
  last_error: null,
  next_at: null,
  timer: null,
});
export const intervalHours = () => {
  const raw = process.env.DISPATCH_BACKUP_INTERVAL_HOURS;
  return raw === undefined || raw === "" ? 24 : Math.max(0, Number(raw) || 0);
};

export async function runBackup() {
  if (state.running) throw new MailError("A backup is already running", 409);
  state.running = true;
  try {
    const s = store(),
      result = await createBackup(s.directory, { db: s.db });
    state.last_ok = result.created;
    state.last_error = null;
    // Restart the countdown from this backup, so a manual one isn't followed by a scheduled duplicate.
    schedule().catch(() => {});
    log("info", "backup.created", { stamp: result.stamp, db_bytes: result.db_bytes, files_new: result.files_new, key: result.key, pruned: result.pruned });
    if (result.key === "plain")
      log("warn", "backup.key_unencrypted", { reason: "Set DISPATCH_BACKUP_PASSPHRASE so backups don't carry the 2FA key in the clear" });
    return result;
  } catch (error) {
    state.last_error = String(error.message || error).slice(0, 300);
    log("error", "backup.failed", { reason: state.last_error });
    throw error;
  } finally {
    state.running = false;
  }
}

async function schedule() {
  clearTimeout(state.timer);
  const hours = intervalHours();
  if (hours <= 0) return (state.next_at = null);
  const s = store(),
    latest = (await listBackups(backupRoot(s.directory)))[0],
    due = latest ? Date.parse(latest.created) + hours * 3600000 : Date.now() + 60000;
  const wait = Math.max(due - Date.now(), 5000);
  state.next_at = new Date(Date.now() + wait).toISOString();
  state.timer = setTimeout(async () => {
    try {
      await runBackup();
    } catch {}
    schedule().catch(() => {});
  }, Math.min(wait, 2 ** 31 - 1));
  state.timer.unref?.();
}

export function startBackups() {
  if (state.started) return;
  state.started = true;
  schedule().catch((error) => log("error", "backup.schedule_failed", { reason: String(error.message || error) }));
}

export async function backupStatus() {
  const s = store(),
    root = backupRoot(s.directory);
  return {
    enabled: intervalHours() > 0,
    interval_hours: intervalHours(),
    keep: keepCount(),
    directory: root,
    same_disk_as_data: root === s.directory || root.startsWith(s.directory + sep),
    encrypted_key: !!process.env.DISPATCH_BACKUP_PASSPHRASE,
    running: state.running,
    last_ok: state.last_ok,
    last_error: state.last_error,
    next_at: state.next_at,
    backups: (await listBackups(root)).map(({ stamp, created, db_bytes, files_total, key }) => ({ stamp, created, db_bytes, files_total, key })),
  };
}
