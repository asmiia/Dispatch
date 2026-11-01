"use client";
import { useState } from "react";
import { Link2, Search, ShieldCheck, Trash2 } from "lucide-react";
import UserAvatar from "./user-avatar";

const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 90
    ? "just now"
    : s < 5400
      ? `${Math.round(s / 60)} min ago`
      : s < 129600
        ? `${Math.round(s / 3600)} h ago`
        : new Date(iso).toLocaleDateString();
};

// Everyone on this instance: search, reset links, disable, delete.
export default function InstanceUsers({ data, run, resetLink }) {
  const [query, setQuery] = useState(""),
    [confirm, setConfirm] = useState("");
  const q = query.trim().toLowerCase(),
    users = data.users.filter(
      (u) =>
        !q || `${u.name} ${u.email} ${u.teams || ""}`.toLowerCase().includes(q),
    );
  return (
    <>
      <div className="members-head">
        <div>
          <h3>Users</h3>
          <p className="muted">
            {data.users.length} account{data.users.length === 1 ? "" : "s"} on
            this instance. Disabled people lose their sessions and their agent
            keys stop working.
          </p>
        </div>
        <label className="search-box">
          <Search size={14} />
          <input
            placeholder="Search name, email or server"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search users"
          />
        </label>
      </div>
      <div className="member-table users-table">
        <div className="member-row member-head">
          <span>User</span>
          <span>Last sign-in</span>
          <span />
        </div>
        {users.length === 0 && (
          <p className="muted pad">No one matches “{query}”.</p>
        )}
        {users.map((u) => (
          <div className="member-row" key={u.id}>
            <div className="member-who">
              <UserAvatar id={u.id} name={u.name} v={u.avatar_v} size={40} />
              <div>
                <strong>
                  {u.name}
                  {!!u.site_admin && (
                    <span className="chip">Administrator</span>
                  )}
                  {!!u.disabled && <span className="chip warn">Disabled</span>}
                  {!!u.mfa && (
                    <span
                      className="chip ok"
                      title="Two-factor authentication is on"
                    >
                      <ShieldCheck size={11} /> 2FA
                    </span>
                  )}
                  {u.id === data.user.id && <span className="chip">You</span>}
                </strong>
                <span>{u.email}</span>
                <span>{u.teams || "No server"}</span>
              </div>
            </div>
            <div className="last-seen">
              <strong>{ago(u.last_login)}</strong>
              <span>Joined {new Date(u.created_at).toLocaleDateString()}</span>
            </div>
            <div className="member-actions">
              <button
                className="subtle-button"
                disabled={!!u.disabled}
                title="Create a one-time password reset link"
                onClick={() => resetLink(u.id)}
              >
                <Link2 size={13} />
                Reset link
              </button>
              <button
                className="subtle-button"
                disabled={u.id === data.user.id}
                onClick={() =>
                  run("user", { user_id: u.id, disabled: !u.disabled })
                }
              >
                {u.disabled ? "Enable" : "Disable"}
              </button>
              {confirm === u.id ? (
                <button
                  className="subtle-button danger"
                  onClick={() => {
                    setConfirm("");
                    run("user/delete", { user_id: u.id });
                  }}
                >
                  Confirm delete
                </button>
              ) : (
                <button
                  className="subtle-button danger"
                  disabled={u.id === data.user.id}
                  aria-label={"Delete " + u.name}
                  onClick={() => setConfirm(u.id)}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
