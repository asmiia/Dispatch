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
        Download your account details, team memberships, tokens (without
        secrets), sign-in history and activity as JSON.
      </p>
      <a className="subtle-button" href="/api/settings/export/account" download>
        <Download size={14} />
        Export my data
      </a>
      <div className="danger-zone">
        <h4>Delete account</h4>
        <p className="muted">
          Removes your sign-in, memberships, tokens and sign-in history.
          Messages that agents sent stay with their team. Transfer ownership of
          any team you own first.
        </p>
        {!open ? (
          <button
            type="button"
            className="subtle-button danger"
            onClick={() => setOpen(true)}
          >
            <Trash2 size={14} />
            Delete my account
          </button>
        ) : (
          <form onSubmit={remove}>
            <label htmlFor="del-password">Password</label>
            <input
              id="del-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <label htmlFor="del-code">
              Authenticator or recovery code (if two-factor is on)
            </label>
            <input
              id="del-code"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <label htmlFor="del-confirm">
              Type your email, {user.email}, to confirm
            </label>
            <input
              id="del-confirm"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button
              className="subtle-button danger"
              disabled={busy || confirm !== user.email}
            >
              Permanently delete my account
            </button>
            <button
              type="button"
              className="subtle-button"
              onClick={() => setOpen(false)}
            >
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
