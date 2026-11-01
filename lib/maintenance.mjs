import { security } from "./security.mjs";
import { accounts } from "./accounts.mjs";
import { deleteMessages } from "./deletion.mjs";
import { log } from "./log.mjs";

const state = (globalThis.__dispatchMaintenance ??= {
  started: false,
  timer: null,
  last: null,
});
export const auditDays = () => {
  const n = Number(process.env.DISPATCH_AUDIT_RETENTION_DAYS);
  return Number.isFinite(n) && process.env.DISPATCH_AUDIT_RETENTION_DAYS
    ? Math.max(0, n)
    : 365;
};

// Deletes messages older than each team's retention period, then trims the audit log.
export function runRetention(sec = security(), now = Date.now()) {
  accounts(sec); // makes sure every column and table exists
  let messages = 0,
    files = 0;
  const teams = sec.db
    .prepare("SELECT id,name,retention_days FROM teams WHERE retention_days>0")
    .all();
  for (const team of teams) {
    const cutoff = new Date(now - team.retention_days * 86400000).toISOString();
    let removed = 0;
    for (;;) {
      const ids = sec.db
        .prepare(
          "SELECT m.id FROM messages m JOIN projects p ON p.id=m.project_id WHERE p.team_id=? AND m.created_at<? LIMIT 500",
        )
        .all(team.id, cutoff)
        .map((r) => r.id);
      if (!ids.length) break;
      const r = deleteMessages(sec, ids);
      removed += r.messages;
      files += r.files;
    }
    if (removed) {
      messages += removed;
      sec.log(
        { id: "system" },
        team.id,
        "retention.deleted",
        `${removed} messages older than ${team.retention_days} days`,
      );
    }
  }
  let audit = 0;
  if (auditDays() > 0)
    audit = Number(
      sec.db
        .prepare("DELETE FROM audit WHERE created_at<?")
        .run(new Date(now - auditDays() * 86400000).toISOString()).changes,
    );
  if (messages || audit)
    log("info", "retention.ran", { messages, files, audit_rows: audit });
  return { messages, files, audit };
}

export function startMaintenance() {
  if (state.started) return;
  state.started = true;
  const tick = () => {
    try {
      state.last = runRetention();
    } catch (error) {
      log("error", "retention.failed", {
        reason: String(error.message || error).slice(0, 300),
      });
    }
  };
  setTimeout(tick, 120000).unref?.();
  state.timer = setInterval(tick, 6 * 3600000);
  state.timer.unref?.();
}
