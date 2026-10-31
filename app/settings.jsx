"use client";
import Coordination from "./coordination";
import Security from "./security";
import Activity from "./activity";
import Backups from "./backups";
import Members from "./members";
import { AccountData, TeamData } from "./data";
import { ThemeSwitch } from "./theme-toggle";
import Select from "./select";
import { useEffect, useState } from "react";
import {
  X,
  Plus,
  Copy,
  Check,
  Trash2,
  KeyRound,
  Users,
  UsersRound,
  Building2,
  Network,
  UserRound,
  ShieldCheck,
  Activity as ActivityIcon,
  ScrollText,
  Loader2,
  Link2,
  DatabaseBackup,
} from "lucide-react";
async function api(path, body) {
  const r = await fetch("/api/" + path, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error);
  return value;
}
export default function Settings({ onClose, onChanged, project, agents }) {
  const [personalName, setPersonalName] = useState("");
  const [data, setData] = useState(null),
    [team, setTeam] = useState(""),
    [tab, setTab] = useState("account"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const [name, setName] = useState(""),
    [teamName, setTeamName] = useState(""),
    [quota, setQuota] = useState(256),
    [newTeam, setNewTeam] = useState(""),
    [joinCode, setJoinCode] = useState(""),
    [keyAgent, setKeyAgent] = useState(""),
    [keyName, setKeyName] = useState(""),
    [password, setPassword] = useState(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [delUser, setDelUser] = useState("");
  async function load(id = team) {
    try {
      const d = await api("settings" + (id ? "?team=" + id : ""));
      setData(d);
      setTeam(d.team_id || "");
      setName(d.user.name);
      const selected = d.teams.find((t) => t.id === d.team_id);
      setTeamName(selected?.name || "");
      setQuota(Math.round((selected?.quota_bytes || 268435456) / 1048576));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function run(path, input) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("settings/" + path, input);
      if ((result.token || result.code) && tab !== "members") {
        setSecret(result.token || result.code);
        setCopied(false);
      }
      setNotice(
        result.emailed
          ? "Invitation emailed. You can also share the code below."
          : "Saved",
      );
      await load();
      await onChanged();
      if (result.sign_in_again) window.location.reload();
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const admin = ["owner", "admin"].includes(data?.role),
    owner = data?.role === "owner";
  return (
    <div className="modal-backdrop">
      <section
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header>
          <div>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="settings-layout">
          <nav>
            {[
              [
                "Account",
                [
                  ["account", UserRound, "Your account"],
                  ["security", ShieldCheck, "Security"],
                ],
              ],
              [
                "Team",
                [
                  ["team", Building2, "Team settings"],
                  ["members", Users, "Members & invites"],
                  ["keys", KeyRound, "Agent credentials"],
                  ["coordination", Network, "Coordination"],
                  ...(admin ? [["audit", ScrollText, "Audit log"]] : []),
                ],
              ],
              ...(data?.user.site_admin
                ? [
                    [
                      "Instance",
                      [
                        ["instance", UsersRound, "Instance admin"],
                        ["activity", ActivityIcon, "Activity"],
                        ["backups", DatabaseBackup, "Backups"],
                      ],
                    ],
                  ]
                : []),
            ].map(([group, items]) => (
              <div className="settings-group" key={group}>
                <span className="settings-group-label">{group}</span>
                {items.map(([id, Icon, label]) => (
                  <button
                    key={id}
                    className={tab === id ? "active" : ""}
                    onClick={() => {
                      setTab(id);
                      setSecret("");
                      setNotice("");
                      setError("");
                    }}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="settings-content">
            {!data ? (
              <Loader2 className="spin" size={20} />
            ) : (
              <>
                <div className="settings-team">
                  <label>
                    Selected team
                    <Select
                      aria-label="Selected team"
                      value={team}
                      onChange={(e) => {
                        setTeam(e.target.value);
                        load(e.target.value);
                        setSecret("");
                      }}
                    >
                      {data.teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.role}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                {tab === "coordination" && (
                  <Coordination project={project} agents={agents} />
                )}
                {tab === "account" && (
                  <>
                    <h3>Your account</h3>
                    <p className="muted">
                      {data.user.email}{" "}
                      {data.user.site_admin ? "· Instance administrator" : ""}
                    </p>
                    <h4>Appearance</h4>
                    <ThemeSwitch />
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run("profile", {
                          name,
                          password,
                          current_password: currentPassword,
                        });
                      }}
                    >
                      <label htmlFor="profile-name">Display name</label>
                      <input
                        id="profile-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                      <h4>Change password</h4>
                      <label htmlFor="current-password">Current password</label>
                      <input
                        id="current-password"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                      <label htmlFor="new-password">New password</label>
                      <input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <p className="muted">
                        Changing your password signs out all browser sessions.
                      </p>
                      <button className="primary" disabled={busy}>
                        Save account
                      </button>
                      <button
                        type="button"
                        className="subtle-button account-signout"
                        onClick={async () => {
                          try {
                            await api("logout", {});
                            window.location.reload();
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        Sign out
                      </button>
                    </form>
                    <AccountData api={api} user={data.user} />
                  </>
                )}
                {tab === "security" && <Security api={api} />}
                {tab === "activity" && <Activity api={api} />}
                {tab === "backups" && <Backups api={api} />}
                {tab === "team" && (
                  <>
                    <h3>Team settings</h3>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run("team", {
                          team_id: team,
                          name: teamName,
                          quota_bytes: Number(quota) * 1048576,
                        });
                      }}
                    >
                      <label htmlFor="team-name">Team name</label>
                      <input
                        id="team-name"
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        required
                        disabled={!admin}
                      />
                      <label htmlFor="quota">
                        Attachment storage limit (MiB)
                      </label>
                      <input
                        id="quota"
                        type="number"
                        min={6}
                        max={10240}
                        value={quota}
                        onChange={(e) => setQuota(e.target.value)}
                        disabled={!admin}
                      />
                      <button className="primary" disabled={!admin || busy}>
                        Save team
                      </button>
                    </form>
                    <hr />
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const r = await run("teams", { name: newTeam });
                        if (r) {
                          setTeam(r.id);
                          load(r.id);
                          setNewTeam("");
                        }
                      }}
                    >
                      <h4>Create another team</h4>
                      <label htmlFor="create-team">New team name</label>
                      <input
                        id="create-team"
                        value={newTeam}
                        onChange={(e) => setNewTeam(e.target.value)}
                        required
                      />
                      <button className="subtle-button" disabled={busy}>
                        <Plus size={14} />
                        Create team
                      </button>
                    </form>
                    <hr />
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run("join", { code: joinCode });
                      }}
                    >
                      <h4>Join a team</h4>
                      <label htmlFor="join-code">Invitation code</label>
                      <input
                        id="join-code"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                        required
                      />
                      <button className="subtle-button" disabled={busy}>
                        Accept invitation
                      </button>
                    </form>
                    {admin && (
                      <TeamData
                        key={team}
                        api={api}
                        team={team}
                        teamName={teamName}
                        role={data.role}
                        projects={data.projects || []}
                        retention={
                          data.teams.find((t) => t.id === team)
                            ?.retention_days || 0
                        }
                        onChanged={async () => {
                          await load("");
                          await onChanged();
                        }}
                      />
                    )}
                  </>
                )}
                {tab === "members" && (
                  <Members
                    data={data}
                    team={team}
                    admin={admin}
                    owner={owner}
                    run={run}
                    busy={busy}
                  />
                )}
                {tab === "keys" && (
                  <>
                    <h3>Personal MCP credentials</h3>
                    <p className="muted">
                      Use a personal token to manage this team through MCP with
                      your current role. It cannot access another team or
                      instance-wide administration. Keep it separate from
                      agent-only keys.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run("personal-key", {
                          team_id: team,
                          name: personalName,
                          days: 30,
                        });
                      }}
                    >
                      <label htmlFor="personal-key-name">
                        Personal credential label
                      </label>
                      <input
                        id="personal-key-name"
                        value={personalName}
                        onChange={(e) => setPersonalName(e.target.value)}
                        placeholder="e.g. My team administration client"
                        required
                      />
                      <button className="primary" disabled={busy}>
                        Create personal MCP token
                      </button>
                    </form>
                    <div className="settings-rows">
                      {data.personal_keys?.map((k) => (
                        <div className="settings-row" key={k.id}>
                          <div>
                            <strong>{k.name}</strong>
                            <span>
                              {k.revoked_at
                                ? "Revoked"
                                : "Expires " +
                                  new Date(k.expires_at).toLocaleDateString()}
                            </span>
                          </div>
                          <button
                            className="subtle-button"
                            disabled={!!k.revoked_at}
                            onClick={() =>
                              run("personal-key/revoke", { id: k.id })
                            }
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                    <hr />
                    <h3>Agent credentials</h3>
                    <p className="muted">
                      Each key can only use its assigned agent and project. It
                      cannot manage people, create projects or act as another
                      agent.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run("key", {
                          project_key: project,
                          agent_name: keyAgent || agents[0]?.name,
                          name: keyName,
                          days: 30,
                        });
                      }}
                    >
                      <label htmlFor="key-name">Credential label</label>
                      <input
                        id="key-name"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        placeholder="e.g. CI runner"
                        required
                      />
                      <label htmlFor="key-agent">
                        Agent in the current project
                      </label>
                      <Select
                        id="key-agent"
                        value={keyAgent || agents[0]?.name || ""}
                        onChange={(e) => setKeyAgent(e.target.value)}
                      >
                        {agents.map((a) => (
                          <option key={a.id} value={a.name}>
                            {a.name}
                          </option>
                        ))}
                      </Select>
                      <p className="muted">
                        Expires in 30 days. The full token is shown once.
                      </p>
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          !agents.length ||
                          !["owner", "admin", "member"].includes(data.role)
                        }
                      >
                        Create agent key
                      </button>
                    </form>
                    <div className="settings-rows">
                      {data.keys.map((k) => (
                        <div className="settings-row" key={k.id}>
                          <div>
                            <strong>{k.name}</strong>
                            <span>
                              {k.agent_name} · {k.project_name}
                              <br />
                              {k.revoked_at
                                ? "Revoked"
                                : "Expires " +
                                  new Date(k.expires_at).toLocaleDateString()}
                            </span>
                          </div>
                          <button
                            className="subtle-button"
                            disabled={!!k.revoked_at}
                            onClick={() => run("key/revoke", { id: k.id })}
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {tab === "audit" && (
                  <>
                    <h3>Audit log</h3>
                    <p className="muted">
                      Recent team changes. Passwords, invitation codes and
                      credential tokens are never recorded here.
                    </p>
                    <div className="settings-rows">
                      {data.audit.map((a) => (
                        <div className="settings-row" key={a.id}>
                          <div>
                            <strong>{a.action}</strong>
                            <span>
                              {a.actor_name ||
                                (a.actor_id === "deleted"
                                  ? "Deleted user"
                                  : a.actor_id === "system"
                                    ? "System"
                                    : "Agent")}{" "}
                              · {new Date(a.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {tab === "instance" && (
                  <>
                    <h3>Instance administration</h3>
                    <p className="muted">
                      The first account manages every team and account. Disabled
                      users lose their sessions and their agent keys stop
                      working.
                    </p>
                    <div className="settings-rows">
                      {data.users.map((u) => (
                        <div className="settings-row" key={u.id}>
                          <div>
                            <strong>
                              {u.name}
                              {u.site_admin ? " · Administrator" : ""}
                            </strong>
                            <span>{u.email}</span>
                          </div>
                          <button
                            className="subtle-button"
                            disabled={u.disabled}
                            title="Create a one-time password reset link"
                            onClick={async () => {
                              const r = await run("user/reset", {
                                user_id: u.id,
                              });
                              if (r)
                                setSecret(
                                  `${window.location.origin}/?reset=${r.code}`,
                                );
                            }}
                          >
                            <Link2 size={13} />
                            Reset link
                          </button>
                          <button
                            className="subtle-button"
                            disabled={u.id === data.user.id}
                            onClick={() =>
                              run("user", {
                                user_id: u.id,
                                disabled: !u.disabled,
                              })
                            }
                          >
                            {u.disabled ? "Enable" : "Disable"}
                          </button>
                          <button
                            className="subtle-button danger"
                            disabled={u.id === data.user.id}
                            onClick={async () => {
                              if (delUser !== u.id) return setDelUser(u.id);
                              setDelUser("");
                              await run("user/delete", { user_id: u.id });
                            }}
                          >
                            <Trash2 size={13} />
                            {delUser === u.id ? "Confirm delete" : "Delete"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {secret && (
              <div className="secret-result">
                <strong>
                  {tab === "keys"
                    ? "Save this credential token"
                    : tab === "instance"
                      ? "Password reset link (valid for 1 hour)"
                      : "Invitation code"}
                </strong>
                <code>{secret}</code>
                <button
                  className="subtle-button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(secret);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}{" "}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
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
          </div>
        </div>
      </section>
    </div>
  );
}
