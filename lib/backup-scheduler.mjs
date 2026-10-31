import { store, MailError } from "./store.mjs";
import { createBackup, listBackups, backupRoot, keepCount } from "./backup.mjs";
import { sep } from "node:path";
import { sendMail, mailEnabled } from "./mailer.mjs";
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

// Emails every instance administrator, at most once per kind every 12 hours.
async function alertAdmins(kind, subject, text) {
  if (state[kind] && Date.now() - state[kind] < 12 * 3600000) return;
  state[kind] = Date.now();
  if (!mailEnabled()) return;
  const admins = store()
    .db.prepare("SELECT email FROM users WHERE site_admin=1 AND disabled=0")
    .all()
    .map((r) => r.email);
  for (const to of admins) await sendMail({ to, subject, text });
  log("warn", "backup.alert_sent", { kind, recipients: admins.length });
}

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
    void alertAdmins(
      "failed_alert_at",
      "Dispatch backup failed",
      `The latest Dispatch backup failed:\n\n${state.last_error}\n\nCheck Settings > Backups and the server log. Until a backup succeeds, your newest copy is the last successful snapshot.`,
    );
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

async function checkStale() {
  const hours = intervalHours();
  if (hours <= 0) return;
  const latest = (await listBackups(backupRoot(store().directory)))[0],
    age = latest ? Date.now() - Date.parse(latest.created) : Infinity;
  if (age > (2 * hours + 1) * 3600000 && !state.running)
    await alertAdmins(
      "stale_alert_at",
      "Dispatch has no recent backup",
      latest
        ? `The newest Dispatch backup is from ${latest.created}, which is more than twice the ${hours}-hour schedule. Check Settings > Backups and the server log.`
        : "Dispatch has no backups yet even though automatic backups are enabled. Check Settings > Backups and the server log.",
    );
}

export function startBackups() {
  if (state.started) return;
  state.started = true;
  const stale = setInterval(() => checkStale().catch(() => {}), 3600000);
  stale.unref?.();
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
