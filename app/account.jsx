"use client";
import { useEffect, useState } from "react";
import { Camera, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import UserAvatar from "./user-avatar";
import PhotoEditor from "./photo-editor";
import { ThemeSwitch } from "./theme-toggle";
import { AccountData } from "./data";

// Your profile: a header with your photo, then cards for name, look, password, session and your data.
export default function Account({ data, api, run, busy, setError, goTo }) {
  const user = data.user,
    [name, setName] = useState(user.name),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [editing, setEditing] = useState(false),
    [mfa, setMfa] = useState(null);
  useEffect(() => {
    api("settings/security")
      .then((s) => setMfa(s.enabled))
      .catch(() => {});
  }, []);
  const roles = data.teams.map((t) => `${t.name} · ${t.role}`);

  async function savePhoto(data_base64) {
    const r = await run("avatar", { data_base64 });
    if (r) setEditing(false);
  }
  return (
    <>
      <div className="page-head">
        <h3>Your account</h3>
        <p className="muted">
          Your profile, how Dispatch looks for you, and your sign-in.
        </p>
      </div>

      <section className="profile-card">
        <UserAvatar
          id={user.id}
          name={user.name}
          v={user.avatar_v}
          size={96}
          className="big"
        />
        <div className="profile-info">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <div className="profile-chips">
            {user.site_admin && (
              <span className="chip role">Instance administrator</span>
            )}
            {roles.slice(0, 3).map((r) => (
              <span className="chip role" key={r}>
                {r}
              </span>
            ))}
            {mfa !== null && (
              <button
                type="button"
                className={"chip role link" + (mfa ? " ok" : "")}
                onClick={() => goTo("security")}
              >
                <ShieldCheck size={12} />
                {mfa ? "Two-factor on" : "Two-factor off"}
              </button>
            )}
          </div>
        </div>
        {!editing && (
          <div className="profile-actions">
            <button
              type="button"
              className="subtle-button"
              onClick={() => setEditing(true)}
            >
              <Camera size={14} />
              {user.avatar_v ? "Change photo" : "Add photo"}
            </button>
            {user.avatar_v && (
              <button
                type="button"
                className="subtle-button"
                onClick={() => run("avatar/remove", {})}
              >
                <Trash2 size={14} />
                Remove
              </button>
            )}
          </div>
        )}
      </section>
      {editing && (
        <PhotoEditor
          busy={busy}
          onSave={savePhoto}
          onCancel={() => setEditing(false)}
        />
      )}

      <div className="settings-grid">
        <section className="card">
          <h4>Profile</h4>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run("profile", { name });
            }}
          >
            <label className="field">
              <span>Display name</span>
              <input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input value={user.email} disabled readOnly />
            </label>
            <p className="muted small">
              Your email is your sign-in and can't be changed here yet.
            </p>
            <button
              className="primary"
              disabled={busy || name.trim() === user.name}
            >
              Save name
            </button>
          </form>
        </section>

        <section className="card">
          <h4>Appearance</h4>
          <p className="muted">Choose light, dark, or follow your device.</p>
          <ThemeSwitch />
        </section>

        <section className="card">
          <h4>Password</h4>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run("profile", {
                name: user.name,
                password: next,
                current_password: current,
              });
              if (r) {
                setCurrent("");
                setNext("");
              }
            }}
          >
            <label className="field">
              <span>Current password</span>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            </label>
            <p className="muted small">
              At least 12 characters. Changing it signs you out everywhere.
            </p>
            <button className="primary" disabled={busy}>
              Change password
            </button>
          </form>
        </section>

        <section className="card">
          <h4>Session</h4>
          <p className="muted">
            See where you're signed in, or end this session.
          </p>
          <div className="menu-actions">
            <button
              type="button"
              className="subtle-button"
              onClick={() => goTo("security")}
            >
              <ShieldCheck size={14} />
              Security and devices
            </button>
            <button
              type="button"
              className="subtle-button"
              onClick={async () => {
                try {
                  await api("logout", {});
                  window.location.reload();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </section>

        <section className="card wide">
          <AccountData api={api} user={user} />
        </section>
      </div>
    </>
  );
}
