"use client";
import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";

const bytes = (n) =>
  n < 1048576
    ? `${Math.max(0, Math.round(n / 1024))} KB`
    : n < 1073741824
      ? `${(n / 1048576).toFixed(1)} MB`
      : `${(n / 1073741824).toFixed(2)} GB`;

// Everything about the selected team, as cards: general, retention, projects, export and delete.
export default function TeamSettings({
  data,
  team,
  admin,
  owner,
  run,
  busy,
  api,
  onChanged,
}) {
  const current = data.teams.find((t) => t.id === team) || data.teams[0],
    [name, setName] = useState(current?.name || ""),
    [quota, setQuota] = useState(
      Math.round((current?.quota_bytes || 0) / 1048576),
    ),
    [days, setDays] = useState(current?.retention_days || 0),
    [target, setTarget] = useState(null),
    [typed, setTyped] = useState(""),
    [teamTyped, setTeamTyped] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setName(current?.name || "");
    setQuota(Math.round((current?.quota_bytes || 0) / 1048576));
    setDays(current?.retention_days || 0);
    setTarget(null);
  }, [team, current?.name, current?.quota_bytes, current?.retention_days]);
  if (!current) return null;

  const used = data.usage_bytes || 0,
    limit = current.quota_bytes || 1,
    pct = Math.min(100, (used / limit) * 100);
  async function act(path, body, message) {
    setError("");
    setNotice("");
    try {
      await api(path, body);
      setNotice(message);
      setTarget(null);
      setTyped("");
      setTeamTyped("");
      await onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <h3>Team settings</h3>
        <p className="muted">
          {current.name} · you are{" "}
          {current.role === "admin"
            ? "an admin"
            : `a${/^[aeiou]/.test(current.role) ? "n" : ""} ${current.role}`}
          {!admin && ". Only admins can change these settings."}
        </p>
      </div>

      <div className="settings-grid">
        <section className="card wide">
          <h4>General</h4>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run("team", {
                team_id: team,
                name,
                quota_bytes: Number(quota) * 1048576,
              });
            }}
          >
            <div className="two-fields">
              <label className="field">
                <span>Team name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={!admin}
                />
              </label>
              <label className="field">
                <span>Attachment storage limit (MiB)</span>
                <input
                  type="number"
                  min={6}
                  max={10240}
                  value={quota}
                  onChange={(e) => setQuota(e.target.value)}
                  disabled={!admin}
                />
              </label>
            </div>
            <div className="usage">
              <div
                className="usage-bar"
                role="img"
                aria-label={`${bytes(used)} of ${bytes(limit)} used`}
              >
                <i
                  style={{ width: `${Math.max(pct, used ? 2 : 0)}%` }}
                  className={pct > 90 ? "hot" : ""}
                />
              </div>
              <span>
                {bytes(used)} of {bytes(limit)} used ({Math.round(pct)}%)
              </span>
            </div>
            {admin && (
              <button className="primary" disabled={busy}>
                Save changes
              </button>
            )}
          </form>
        </section>

        {admin && (
          <section className="card">
            <h4>Retention</h4>
            <p className="muted">
              Automatically delete messages older than a set number of days. 0
              keeps everything.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run("team/retention", { team_id: team, days: Number(days) });
              }}
            >
              <label className="field">
                <span>Delete messages older than (days)</span>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </label>
              <p className="muted small">
                Files only attached to those messages go too. Older backups keep
                the data until they expire.
              </p>
              <button className="subtle-button" disabled={busy}>
                Save retention
              </button>
            </form>
          </section>
        )}

        {admin && (
          <section className="card">
            <h4>Export</h4>
            <p className="muted">
              Download every project, agent, message and attachment in this team
              as one .tar.gz file.
            </p>
            <a
              className="subtle-button"
              href={`/api/settings/export/team?team=${encodeURIComponent(team)}`}
              download
            >
              <Download size={14} />
              Export team data
            </a>
          </section>
        )}

        {admin && (
          <section className="card wide">
            <h4>Projects</h4>
            <div className="settings-rows plain">
              {(data.projects || []).length === 0 && (
                <p className="muted">No projects yet.</p>
              )}
              {(data.projects || []).map((p) => (
                <div className="settings-row" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <span>
                      {p.messages} message{p.messages === 1 ? "" : "s"}
                    </span>
                  </div>
                  <button
                    className="subtle-button danger"
                    onClick={() => {
                      setTarget(p);
                      setTyped("");
                    }}
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              ))}
            </div>
            {target && (
              <form
                className="inline-confirm"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    "projects/delete",
                    { project_key: target.id, confirm: typed },
                    `Deleted ${target.name}`,
                  );
                }}
              >
                <label className="field">
                  <span>
                    Type "{target.name}" to delete the project, its agents,
                    messages and files
                  </span>
                  <input
                    required
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                </label>
                <div className="menu-actions">
                  <button
                    className="subtle-button danger"
                    disabled={typed !== target.name}
                  >
                    Permanently delete project
                  </button>
                  <button
                    type="button"
                    className="subtle-button"
                    onClick={() => setTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {owner && (
          <section className="card wide danger-card">
            <h4>Delete team</h4>
            <p className="muted">
              Removes the team, all its projects, messages and files. This can't
              be undone.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(
                  "settings/teams/delete",
                  { team_id: team, confirm: teamTyped },
                  "Team deleted",
                );
              }}
            >
              <label className="field">
                <span>Type "{current.name}" to confirm</span>
                <input
                  value={teamTyped}
                  onChange={(e) => setTeamTyped(e.target.value)}
                />
              </label>
              <button
                className="subtle-button danger"
                disabled={teamTyped !== current.name}
              >
                Permanently delete team
              </button>
            </form>
          </section>
        )}
      </div>
      {notice && (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
