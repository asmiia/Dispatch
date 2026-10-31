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
    [delUser, setDelUser] = useState(""),
    [newAgent, setNewAgent] = useState(""),
    [newProgram, setNewProgram] = useState(""),
    [newModel, setNewModel] = useState("");
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
  async function createAgentKey(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let agentName = keyAgent || agents[0]?.name;
      if (!agentName || keyAgent === "__new") {
        agentName = newAgent.trim();
        await api("agents", {
          project_key: project,
          name: agentName,
          program: newProgram.trim() || "agent",
          model: newModel.trim() || "unknown",
        });
      }
      const made = await api("settings/key", {
        project_key: project,
        agent_name: agentName,
        name: keyName,
        days: 30,
      });
      setSecret(made.token);
      setCopied(false);
      setNotice("Key created. Copy it now: it is only shown once.");
      setNewAgent("");
      setNewProgram("");
      setNewModel("");
      setKeyName("");
      setKeyAgent(agentName);
      await load();
      await onChanged();
    } catch (err) {
      setError(err.message);
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
                {group === "Team" && data && (
                  <div className="nav-team">
                    {data.teams.length > 1 ? (
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
                    ) : (
                      <span className="nav-team-name" title="Your team">
                        {data.teams[0]?.name} · {data.teams[0]?.role}
                      </span>
                    )}
                  </div>
                )}
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
                    <h3>Agent credentials</h3>
                    <p className="muted">
                      An agent key lets one agent use Dispatch over MCP. It only
                      works for that agent and project, and cannot manage
                      people, create projects or act as another agent. The key
                      is shown once, right after you create it.
                    </p>
                    {!project ? (
                      <p className="settings-warning">
                        Create or select a project first, then come back to make
                        an agent key.
                      </p>
                    ) : (
                      <form onSubmit={createAgentKey}>
                        <label htmlFor="key-agent">
                          Agent in the current project
                        </label>
                        <Select
                          id="key-agent"
                          value={
                            agents.length ? keyAgent || agents[0].name : "__new"
                          }
                          onChange={(e) => setKeyAgent(e.target.value)}
                        >
                          {agents.map((a) => (
                            <option key={a.id} value={a.name}>
                              {a.name}
                            </option>
                          ))}
                          <option value="__new">+ New agent…</option>
                        </Select>
                        {(!agents.length || keyAgent === "__new") && (
                          <>
                            <label htmlFor="new-agent-name">
                              New agent name
                            </label>
                            <input
                              id="new-agent-name"
                              value={newAgent}
                              onChange={(e) => setNewAgent(e.target.value)}
                              placeholder="e.g. ReviewBot"
                              pattern="[A-Za-z][A-Za-z0-9_\-]*"
                              title="Letters, numbers, - and _, starting with a letter"
                              required
                            />
                            <label htmlFor="new-agent-program">
                              Program (picks the agent's logo)
                            </label>
                            <input
                              id="new-agent-program"
                              list="agent-programs"
                              value={newProgram}
                              onChange={(e) => setNewProgram(e.target.value)}
                              placeholder="claude-code, codex, gemini-cli, cursor…"
                            />
                            <datalist id="agent-programs">
                              {[
                                "claude-code",
                                "codex",
                                "gemini-cli",
                                "cursor",
                                "copilot",
                                "windsurf",
                              ].map((n) => (
                                <option key={n} value={n} />
                              ))}
                            </datalist>
                            <label htmlFor="new-agent-model">
                              Model (optional)
                            </label>
                            <input
                              id="new-agent-model"
                              value={newModel}
                              onChange={(e) => setNewModel(e.target.value)}
                              placeholder="opus, gpt-5, gemini-pro…"
                            />
                          </>
                        )}
                        <label htmlFor="key-name">Key label</label>
                        <input
                          id="key-name"
                          value={keyName}
                          onChange={(e) => setKeyName(e.target.value)}
                          placeholder="e.g. my laptop, CI runner"
                          required
                        />
                        <p className="muted">Expires in 30 days.</p>
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            !["owner", "admin", "member"].includes(data.role)
                          }
                        >
                          {!agents.length || keyAgent === "__new"
                            ? "Create agent and key"
                            : "Create agent key"}
                        </button>
                        {!["owner", "admin", "member"].includes(data.role) && (
                          <p className="muted">
                            Viewers can't create keys. Ask an admin to make you
                            a member.
                          </p>
                        )}
                      </form>
                    )}
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
                    <hr />
                    <h3>Personal MCP token</h3>
                    <p className="muted">
                      For a client that should manage this team (members,
                      credentials) with your own role, not act as an agent. It
                      cannot reach another team or instance administration. Most
                      people only need an agent key above.
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
                      <label htmlFor="personal-key-name">Token label</label>
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
