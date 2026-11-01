"use client";
import { useState } from "react";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import AgentAvatar from "./agent-avatar";

const clients = [
  { id: "claude", name: "Claude Code", program: "claude-code" },
  { id: "codex", name: "Codex", program: "codex" },
  { id: "cursor", name: "Cursor", program: "cursor" },
  { id: "gemini", name: "Gemini CLI", program: "gemini-cli" },
  { id: "opencode", name: "OpenCode", program: "opencode" },
  { id: "other", name: "Other", program: "agent" },
];

// What to paste for each client. The token is filled in, so there is nothing to edit.
function snippet(id, url, token) {
  const json = JSON.stringify(
    {
      mcpServers: {
        dispatch: { url, headers: { Authorization: "Bearer " + token } },
      },
    },
    null,
    2,
  );
  if (id === "claude")
    return {
      where: "Run this in your terminal",
      text: `claude mcp add --transport http dispatch ${url} --header "Authorization: Bearer ${token}"`,
    };
  if (id === "gemini")
    return {
      where: "Run this in your terminal",
      text: `gemini mcp add --transport http dispatch ${url} --header "Authorization: Bearer ${token}"`,
    };
  if (id === "codex")
    return {
      where: "Add this to ~/.codex/config.toml",
      text: `[mcp_servers.dispatch]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
    };
  if (id === "cursor")
    return {
      where: "Save this as .cursor/mcp.json in your project",
      text: json,
    };
  if (id === "opencode")
    return {
      where: "Add this to opencode.json in your project",
      text: JSON.stringify(
        {
          mcp: {
            dispatch: { type: "remote", url, headers: { Authorization: "Bearer " + token } },
          },
        },
        null,
        2,
      ),
    };
  return {
    where: "Use this in any MCP client that supports HTTP servers",
    text: json,
  };
}

function CopyBlock({ text }) {
  const [done, setDone] = useState(false);
  return (
    <div className="connect-code">
      <pre>{text}</pre>
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
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// One command that teaches the agent how Dispatch works: when to check messages, how to answer @mentions,
// how to work with other agents, and when to join a call.
function teach(id, origin) {
  const get = `${origin}/api/agent-guide`;
  if (id === "claude")
    return {
      where: "Run this once to add the Dispatch skill to Claude Code",
      text: `mkdir -p ~/.claude/skills/dispatch && curl -fsSL ${get} -o ~/.claude/skills/dispatch/SKILL.md`,
    };
  if (id === "cursor")
    return {
      where: "Run this in your project to add the Dispatch rule to Cursor",
      text: `mkdir -p .cursor/rules && curl -fsSL "${get}?format=cursor" -o .cursor/rules/dispatch.mdc`,
    };
  const file = id === "gemini" ? "GEMINI.md" : "AGENTS.md";
  return {
    where: `Run this in your project to add the Dispatch notes to ${file}`,
    text: `curl -fsSL "${get}?format=agents" >> ${file}`,
  };
}

// Connect an agent in one step: pick the tool, press the button, paste the result.
export default function Connect({ api, project, projectName, onChanged }) {
  const [client, setClient] = useState("claude"),
    [token, setToken] = useState(""),
    [agentName, setAgentName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    origin = typeof window !== "undefined" ? window.location.origin : "",
    url = origin + "/mcp",
    picked = clients.find((c) => c.id === client);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const agent = await api("agents", {
        project_key: project,
        program: picked.program,
        model: "unknown",
      });
      const made = await api("settings/key", {
        project_key: project,
        agent_name: agent.name,
        name: picked.name,
        days: 0,
      });
      setAgentName(agent.name);
      setToken(made.token);
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const pick = (id) => {
    setClient(id);
    setToken("");
    setAgentName("");
  };
  const out = token && snippet(client, url, token);
  return (
    <div className="connect-content">
      <p className="muted">
        Pick the tool your agent runs in. Dispatch makes a named agent and a key
        for <strong>{projectName || "this project"}</strong>, and gives you one
        thing to paste.
      </p>
      <div className="step-card">
        <span className="step-num">1</span>
        <div className="step-body">
          <strong>Choose your tool</strong>
          <div className="tool-grid" role="tablist" aria-label="Agent tool">
            {clients.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={client === c.id}
                className={"tool-tile" + (client === c.id ? " on" : "")}
                onClick={() => pick(c.id)}
              >
                <AgentAvatar name={c.name} program={c.program} className="avatar" />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!project ? (
        <p className="settings-warning">Create a project first.</p>
      ) : !token ? (
        <div className="step-card">
          <span className="step-num">2</span>
          <div className="step-body">
          <strong>Make an agent and a key</strong>
          <button className="primary" disabled={busy} onClick={create}>
            {busy ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <KeyRound size={14} />
            )}
            Create agent and key for {picked.name}
          </button>
          <span className="muted small">
            The key never expires and only works for this one agent and project.
            You can revoke it in Settings.
          </span>
          </div>
        </div>
      ) : (
        <div className="step-card">
          <span className="step-num done"><Check size={14} /></span>
          <div className="step-body">
          <div className="connect-done">
            <Check size={15} /> Created agent <strong>{agentName}</strong>
          </div>
          <span className="muted small">{out.where}:</span>
          <CopyBlock text={out.text} />
          <p className="muted small">
            This key is shown once. Keep it private. Anyone with it can act as{" "}
            {agentName}.
          </p>
          </div>
        </div>
      )}
      {project ? (
        <div className="step-card">
          <span className="step-num">3</span>
          <div className="step-body">
            <strong>Teach it how Dispatch works</strong>
            <span className="muted small">
              This tells the agent when to read its messages, how to answer when it is @mentioned, how to work
              with other agents and when to join a call. {teach(client, origin).where}:
            </span>
            <CopyBlock text={teach(client, origin).text} />
          </div>
        </div>
      ) : null}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
