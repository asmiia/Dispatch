"use client";
import UserAvatar from "./user-avatar";
import { useState } from "react";
import { Check, Copy, Link2, Plus, Trash2, UserPlus, X } from "lucide-react";
import Select from "./select";

const initials = (name) =>
  (name || "?")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
const days = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 86400000));
const roleHelp = {
  viewer: "Can read conversations and files",
  member: "Can read and send",
  admin: "Can manage members, keys and settings",
  owner: "Full control, including deleting the team",
};

function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="subtle-button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? "Copied" : label}
    </button>
  );
}

// Members of the selected team and invitations. Invites are shared by link because email may not be set up.
export default function Members({ data, team, admin, owner, run, busy }) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("member"),
    [open, setOpen] = useState(false),
    [made, setMade] = useState(null),
    [confirm, setConfirm] = useState("");
  const pending = (data.invitations || []).filter((i) => !i.used_at);
  const canEdit = (m) =>
    admin &&
    m.role !== "owner" &&
    m.id !== data.user.id &&
    (owner || m.role !== "admin");

  async function invite(e) {
    e.preventDefault();
    const address = email.trim();
    const result = await run("invite", { team_id: team, email: address, role });
    if (result?.code) {
      setMade({
        email: address,
        role,
        code: result.code,
        emailed: result.emailed,
        link: `${window.location.origin}/?invite=${encodeURIComponent(result.code)}&email=${encodeURIComponent(address)}`,
      });
      setEmail("");
    }
  }

  return (
    <>
      <div className="members-head">
        <div>
          <h3>Members</h3>
          <p className="muted">
            {data.members.length}{" "}
            {data.members.length === 1 ? "person" : "people"} in this team
            {pending.length
              ? ` · ${pending.length} pending invitation${pending.length === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
        {admin && (
          <button className="primary" onClick={() => setOpen((v) => !v)}>
            {open ? <X size={15} /> : <UserPlus size={15} />}
            {open ? "Close" : "Invite teammate"}
          </button>
        )}
      </div>

      {admin && (open || made) && (
        <section className="invite-card">
          <form onSubmit={invite} className="invite-row">
            <label className="field grow">
              <span>Email address</span>
              <input
                type="email"
                required
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Role</span>
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label="Role"
              >
                <option value="member">Member — read and send</option>
                <option value="viewer">Viewer — read only</option>
                {owner && <option value="admin">Admin — manage team</option>}
              </Select>
            </label>
            <button className="primary" disabled={busy}>
              <Plus size={15} />
              Create invitation
            </button>
          </form>
          <p className="muted small">
            {roleHelp[role]}. The invite works once, for that email only, and
            expires in 7 days.
          </p>

          {made && (
            <div className="invite-result" role="status">
              <div className="invite-result-head">
                <Link2 size={15} />
                <strong>Invite for {made.email}</strong>
                <span className="chip">{made.role}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Dismiss"
                  onClick={() => setMade(null)}
                >
                  <X size={14} />
                </button>
              </div>
              <p className="muted small">
                {made.emailed
                  ? "We emailed this link. You can also send it yourself:"
                  : "Send them this link. Email isn't set up, so Dispatch can't send it for you."}
              </p>
              <div className="copy-row">
                <input
                  readOnly
                  value={made.link}
                  onFocus={(e) => e.target.select()}
                  aria-label="Invite link"
                />
                <CopyButton text={made.link} label="Copy link" />
              </div>
              <div className="copy-row">
                <input
                  readOnly
                  className="mono"
                  value={made.code}
                  onFocus={(e) => e.target.select()}
                  aria-label="Invite code"
                />
                <CopyButton text={made.code} label="Copy code" />
              </div>
              <p className="muted small">
                The link or code is shown once. If you lose it, revoke the
                invite and make a new one.
              </p>
            </div>
          )}
        </section>
      )}

      <div className="member-table" role="table" aria-label="Members">
        <div className="member-row member-head" role="row">
          <span>Member</span>
          <span>Role</span>
          <span />
        </div>
        {[...data.members]
          .sort(
            (a, b) =>
              ["owner", "admin", "member", "viewer"].indexOf(a.role) -
                ["owner", "admin", "member", "viewer"].indexOf(b.role) ||
              a.name.localeCompare(b.name),
          )
          .map((m) => (
            <div className="member-row" role="row" key={m.id}>
              <div className="member-who">
                <UserAvatar id={m.id} name={m.name} v={m.avatar_v} size={38} />
                <div>
                  <strong>
                    {m.name}
                    {m.id === data.user.id && <span className="chip">You</span>}
                    {!!m.disabled && (
                      <span className="chip warn">Disabled</span>
                    )}
                  </strong>
                  <span>{m.email}</span>
                </div>
              </div>
              <div>
                {canEdit(m) ? (
                  <Select
                    aria-label={"Role for " + m.name}
                    value={m.role}
                    onChange={(e) =>
                      run("member", {
                        team_id: team,
                        user_id: m.id,
                        role: e.target.value,
                      })
                    }
                  >
                    {(owner || m.role === "admin") && (
                      <option value="admin">Admin</option>
                    )}
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                ) : (
                  <span className="chip role" title={roleHelp[m.role]}>
                    {m.role}
                  </span>
                )}
              </div>
              <div className="member-actions">
                {canEdit(m) &&
                  (confirm === m.id ? (
                    <>
                      <button
                        className="subtle-button danger"
                        onClick={() => {
                          setConfirm("");
                          run("member", {
                            team_id: team,
                            user_id: m.id,
                            remove: true,
                          });
                        }}
                      >
                        Confirm remove
                      </button>
                      <button
                        className="subtle-button"
                        onClick={() => setConfirm("")}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="subtle-button danger"
                      aria-label={"Remove " + m.name}
                      onClick={() => setConfirm(m.id)}
                    >
                      <Trash2 size={14} />
                      Remove
                    </button>
                  ))}
              </div>
            </div>
          ))}
      </div>

      {admin && (
        <>
          <h4 className="members-sub">Pending invitations</h4>
          {pending.length === 0 ? (
            <p className="muted">
              No pending invitations. Use “Invite teammate” to add someone.
            </p>
          ) : (
            <div className="member-table">
              {pending.map((i) => {
                const left = days(i.expires_at);
                return (
                  <div className="member-row" key={i.id}>
                    <div className="member-who">
                      <span className="m-avatar ghost" aria-hidden="true">
                        {initials(i.email)}
                      </span>
                      <div>
                        <strong>{i.email}</strong>
                        <span>
                          {left > 0
                            ? `Expires in ${left} day${left === 1 ? "" : "s"}`
                            : "Expired"}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="chip role">{i.role}</span>
                    </div>
                    <div className="member-actions">
                      <button
                        className="subtle-button"
                        onClick={() => run("invite/revoke", { id: i.id })}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <p className="muted small members-legend">
        <strong>Viewer</strong> reads · <strong>Member</strong> reads and sends
        · <strong>Admin</strong> manages the team · <strong>Owner</strong> can
        delete it. Everyone on a team can read every conversation in it.
      </p>
    </>
  );
}
