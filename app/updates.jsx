"use client";
import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import Markdown from "./markdown";

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "never");

// Update status for instance administrators: checks GitHub for a newer release, shows the changelog and,
// if the operator configured DISPATCH_UPDATE_COMMAND, runs it.
export default function Updates({ api }) {
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  const load = (force) =>
    api("settings/update" + (force ? "?force=1" : ""))
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!data?.checking) return;
    const timer = setTimeout(load, 1500);
    return () => clearTimeout(timer);
  }, [data]);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      setData(await api("settings/update/apply", {}));
      setNote("Update started. Dispatch will restart in a minute or two.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data && !error) return <Loader2 className="spin" size={20} />;
  return (
    <>
      <h3>Updates</h3>
      <p className="muted">Keep this instance current and see what changed.</p>
      {data && (
        <div className="settings-grid">
          <section className="card wide">
            <div className="update-version">
              <strong>v{data.version}</strong>
              {data.available ? (
                <span className="chip ok">{data.latest.tag} available</span>
              ) : (
                <span className="chip">Up to date</span>
              )}
            </div>
            <p className="muted small">
              {data.checking
                ? "Checking for updates..."
                : "Last checked " + when(data.checked_at)}
              {data.error ? ` · ${data.error}` : ""}
            </p>
            <div className="menu-actions">
              {data.available && data.can_apply && (
                <button className="primary" disabled={busy} onClick={apply}>
                  <Download size={14} />
                  Update to {data.latest.tag}
                </button>
              )}
              <button
                className="subtle-button"
                onClick={() => load(true)}
                disabled={busy}
              >
                <RefreshCw size={14} />
                Check now
              </button>
              {data.latest && (
                <a
                  className="subtle-button"
                  href={data.latest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Release notes
                </a>
              )}
            </div>
            {note && <p className="result ok">{note}</p>}
          </section>
          {data.changelog && (
            <section className="card wide">
              <h4>Changelog</h4>
              <div className="changelog">
                <Markdown>
                  {data.changelog.replace(/^# Changelog\s*/, "")}
                </Markdown>
              </div>
            </section>
          )}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
