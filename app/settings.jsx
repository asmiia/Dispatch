"use client";
import Coordination from "./coordination";
import Security from "./security";
import Activity from "./activity";
import Backups from "./backups";
import Updates from "./updates";
import Appearance from "./appearance";
import InstanceSettings from "./instance-settings";
import Members from "./members";
import Account from "./account";
import Overview from "./overview";
import InstanceUsers from "./instance-users";
import TeamSettings from "./team-settings";
import TeamSwitcher from "./team-switcher";
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
  BarChart3,
  Download,
  Palette,
  SlidersHorizontal,
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
const expires = (t) =>
  t > 4e12 ? "Never expires" : "Expires " + new Date(t).toLocaleDateString();
const lifetimes = [
  ["0", "Never expires"],
  ["365", "1 year"],
  ["90", "90 days"],
  ["30", "30 days"],
  ["7", "7 days"],
];
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
    [newModel, setNewModel] = useState(""),
    [keyDays, setKeyDays] = useState("0"),
    [personalDays, setPersonalDays] = useState("365");
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
        const created = await api("agents", {
          project_key: project,
          name: newAgent.trim() || undefined,
          program: newProgram.trim() || "agent",
          model: newModel.trim() || "unknown",
        });
        agentName = created.name;
      }
      const made = await api("settings/key", {
        project_key: project,
        agent_name: agentName,
        name: keyName,
        days: Number(keyDays),
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
                  ["appearance", Palette, "Appearance"],
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
                        ["analytics", BarChart3, "Overview"],
                        ["instance", UsersRound, "Users"],
                        ["activity", ActivityIcon, "Activity"],
                        ["backups", DatabaseBackup, "Backups"],
                        ["updates", Download, "Updates"],
                        ["instance-settings", SlidersHorizontal, "Settings"],
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
            {data && (
              <TeamSwitcher
                teams={data.teams}
                team={team}
                run={run}
                onSwitch={(id) => {
                  setTeam(id);
                  load(id);
                  setSecret("");
                }}
              />
            )}
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
                  <Account
                    data={data}
                    api={api}
                    run={run}
                    busy={busy}
                    setError={setError}
                    goTo={(id) => {
                      setTab(id);
                      setSecret("");
                      setNotice("");
                      setError("");
                    }}
                  />
                )}
                {tab === "security" && <Security api={api} />}
                {tab === "appearance" && <Appearance />}
                {tab === "instance-settings" && <InstanceSettings api={api} />}
                {tab === "activity" && <Activity api={api} />}
                {tab === "backups" && <Backups api={api} />}
                {tab === "updates" && <Updates api={api} />}
                {tab === "team" && (
                  <TeamSettings
                    data={data}
                    team={team}
                    admin={admin}
                    owner={owner}
                    run={run}
                    busy={busy}
                    api={api}
                    onChanged={async () => {
                      await load("");
                      await onChanged();
                    }}
                  />
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
                              placeholder="A random name, like CopperGrove"
                              pattern="[A-Za-z][A-Za-z0-9_\-]*"
                              title="Letters, numbers, - and _, starting with a letter"
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
                        <label htmlFor="key-days">Lifetime</label>
                        <Select
                          id="key-days"
                          value={keyDays}
                          onChange={(e) => setKeyDays(e.target.value)}
                        >
                          {lifetimes.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </Select>
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
                              {k.revoked_at ? "Revoked" : expires(k.expires_at)}
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
                          days: Number(personalDays),
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
                      <label htmlFor="personal-days">Lifetime</label>
                      <Select
                        id="personal-days"
                        value={personalDays}
                        onChange={(e) => setPersonalDays(e.target.value)}
                      >
                        {lifetimes.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </Select>
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
                              {k.revoked_at ? "Revoked" : expires(k.expires_at)}
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
                {tab === "analytics" && <Overview api={api} />}
                {tab === "instance" && (
                  <InstanceUsers
                    data={data}
                    run={run}
                    resetLink={async (id) => {
                      const r = await run("user/reset", { user_id: id });
                      if (r)
                        setSecret(`${window.location.origin}/?reset=${r.code}`);
                    }}
                  />
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
