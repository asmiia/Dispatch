"use client";
import { useEffect, useState } from "react";
import { Camera, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import UserAvatar from "./user-avatar";
import PhotoEditor from "./photo-editor";
import { ThemeSwitch } from "./theme-toggle";
import { AccountData } from "./data";

// Your profile: photo, name, theme, password, sign-out, and your data.
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
      <h3>Your account</h3>
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
        </div>
      </section>
      {editing && (
        <PhotoEditor
          busy={busy}
          onSave={savePhoto}
          onCancel={() => setEditing(false)}
        />
      )}

      <h4>Profile</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run("profile", { name });
        }}
      >
        <label htmlFor="profile-name">Display name</label>
        <input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <label htmlFor="profile-email">Email</label>
        <input id="profile-email" value={user.email} disabled readOnly />
        <p className="muted">
          Your email is your sign-in and can't be changed here yet.
        </p>
        <button
          className="primary"
          disabled={busy || name.trim() === user.name}
        >
          Save name
        </button>
      </form>

      <h4>Appearance</h4>
      <ThemeSwitch />

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
        <label htmlFor="current-password">Current password</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <p className="muted">
          At least 12 characters. Changing your password signs you out
          everywhere.
        </p>
        <button className="primary" disabled={busy}>
          Change password
        </button>
      </form>

      <h4>Session</h4>
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
      <AccountData api={api} user={user} />
    </>
  );
}
