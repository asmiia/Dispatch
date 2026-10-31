"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, DatabaseBackup, Loader2 } from "lucide-react";

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "never");
const size = (n) =>
  n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`;

// Backup status for instance administrators. Backups run on a schedule; this can also run one now.
export default function Backups({ api }) {
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    api("settings/backups")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function now() {
    setBusy(true);
    setError("");
    try {
      await api("settings/backups/run", {});
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data && !error) return <Loader2 className="spin" size={20} />;
  return (
    <>
      <h3>Backups</h3>
      {data && (
        <>
          <div className="settings-card">
            <div className="settings-card-head">
              <span className={"settings-card-icon" + (data.last_ok && !data.last_error ? " on" : "")}>
                <DatabaseBackup size={18} />
              </span>
              <div>
                <strong>
                  {data.enabled ? `Automatic, every ${data.interval_hours} h` : "Automatic backups are off"}
                </strong>
                <span>
                  Last successful: {when(data.last_ok || data.backups[0]?.created)}
                  {data.enabled && data.next_at ? ` · Next: ${when(data.next_at)}` : ""}
                </span>
              </div>
            </div>
            <p className="muted">
              Keeps the newest {data.keep} snapshots in <code>{data.directory}</code>. Attachments are
              copied once and shared between snapshots.
            </p>
            {data.last_error && (
              <div className="error" role="alert">
                Last backup failed: {data.last_error}
              </div>
            )}
            {!data.enabled && (
              <p className="muted">
                Set <code>DISPATCH_BACKUP_INTERVAL_HOURS</code> above 0 to turn them on.
              </p>
            )}
            {data.same_disk_as_data && (
              <p className="settings-warning">
                <AlertTriangle size={14} /> Backups are on the same disk as your data. Set{" "}
                <code>DISPATCH_BACKUP_DIR</code> to another drive, or copy them elsewhere.
              </p>
            )}
            {!data.encrypted_key && (
              <p className="settings-warning">
                <AlertTriangle size={14} /> Backups include the two-factor encryption key unencrypted. Set{" "}
                <code>DISPATCH_BACKUP_PASSPHRASE</code> to protect it.
              </p>
            )}
            <button className="primary" disabled={busy || data.running} onClick={now}>
              {(busy || data.running) && <Loader2 size={14} className="spin" />}
              Back up now
            </button>
          </div>
          <h4>Snapshots</h4>
          <div className="settings-rows">
            {data.backups.length === 0 && <p className="muted">No backups yet.</p>}
            {data.backups.map((b) => (
              <div className="settings-row" key={b.stamp}>
                <div>
                  <strong>{when(b.created)}</strong>
                  <span>
                    Database {size(b.db_bytes)} · {b.files_total} attachment{b.files_total === 1 ? "" : "s"} · key {b.key}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="muted">
            Restore from a terminal with Dispatch stopped: <code>npm run restore</code>. See the README.
          </p>
        </>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
