"use client";
import { useState } from "react";
import { Download, Trash2 } from "lucide-react";

// Your own data: export it, or delete the account.
export function AccountData({ api, user }) {
  const [open, setOpen] = useState(false),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function remove(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("settings/account/delete", { password, code, confirm });
      window.location.reload();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <>
      <h4>Your data</h4>
      <p className="muted">
        Download your account details, team memberships, tokens (without secrets), sign-in history and activity as JSON.
      </p>
      <a className="subtle-button" href="/api/settings/export/account" download>
        <Download size={14} />
        Export my data
      </a>
      <div className="danger-zone">
        <h4>Delete account</h4>
        <p className="muted">
          Removes your sign-in, memberships, tokens and sign-in history. Messages that agents sent stay with their team.
          Transfer ownership of any team you own first.
        </p>
        {!open ? (
          <button type="button" className="subtle-button danger" onClick={() => setOpen(true)}>
            <Trash2 size={14} />
            Delete my account
          </button>
        ) : (
          <form onSubmit={remove}>
            <label htmlFor="del-password">Password</label>
            <input id="del-password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <label htmlFor="del-code">Authenticator or recovery code (if two-factor is on)</label>
            <input id="del-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            <label htmlFor="del-confirm">Type your email, {user.email}, to confirm</label>
            <input id="del-confirm" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="subtle-button danger" disabled={busy || confirm !== user.email}>
              Permanently delete my account
            </button>
            <button type="button" className="subtle-button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </form>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
    </>
  );
}

// Team-level data controls (admins and owners): retention, project deletion, export, team deletion.
export function TeamData({ api, team, teamName, role, projects, retention, onChanged }) {
  const [days, setDays] = useState(retention || 0),
    [target, setTarget] = useState(null),
    [typed, setTyped] = useState(""),
    [teamTyped, setTeamTyped] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
      <h4>Retention</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act("settings/team/retention", { team_id: team, days: Number(days) }, "Retention saved");
        }}
      >
        <label htmlFor="retention-days">Delete messages older than (days, 0 keeps everything)</label>
        <input id="retention-days" type="number" min={0} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
        <p className="muted">
          Checked every few hours. Files only attached to those messages are deleted too. Older backups still hold the
          data until they age out of your backup retention.
        </p>
        <button className="subtle-button">Save retention</button>
      </form>

      <h4>Projects</h4>
      <div className="settings-rows">
        {projects.length === 0 && <p className="muted">No projects yet.</p>}
        {projects.map((p) => (
          <div className="settings-row" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <span>{p.messages} message{p.messages === 1 ? "" : "s"}</span>
            </div>
            <button className="subtle-button danger" onClick={() => { setTarget(p); setTyped(""); }}>
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        ))}
      </div>
      {target && (
        <form
          className="danger-zone"
          onSubmit={(e) => {
            e.preventDefault();
            act("projects/delete", { project_key: target.id, confirm: typed }, `Deleted ${target.name}`);
          }}
        >
          <label htmlFor="del-project">
            Type "{target.name}" to delete the project, its agents, messages and files
          </label>
          <input id="del-project" required value={typed} onChange={(e) => setTyped(e.target.value)} />
          <button className="subtle-button danger" disabled={typed !== target.name}>
            Permanently delete project
          </button>
          <button type="button" className="subtle-button" onClick={() => setTarget(null)}>
            Cancel
          </button>
        </form>
      )}

      <h4>Export</h4>
      <p className="muted">All projects, agents, messages and attachments in this team as a .tar.gz.</p>
      <a className="subtle-button" href={`/api/settings/export/team?team=${encodeURIComponent(team)}`} download>
        <Download size={14} />
        Export team data
      </a>

      {role === "owner" && (
        <div className="danger-zone">
          <h4>Delete team</h4>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act("settings/teams/delete", { team_id: team, confirm: teamTyped }, "Team deleted");
            }}
          >
            <label htmlFor="del-team">
              Type "{teamName}" to delete the team and everything in it
            </label>
            <input id="del-team" value={teamTyped} onChange={(e) => setTeamTyped(e.target.value)} />
            <button className="subtle-button danger" disabled={teamTyped !== teamName}>
              Permanently delete team
            </button>
          </form>
        </div>
      )}
      {notice && <p className="settings-notice" role="status">{notice}</p>}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
