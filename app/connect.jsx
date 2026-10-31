"use client";
import { useState } from "react";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";

const clients = [
  { id: "claude", name: "Claude Code", program: "claude-code" },
  { id: "codex", name: "Codex", program: "codex" },
  { id: "cursor", name: "Cursor", program: "cursor" },
  { id: "gemini", name: "Gemini CLI", program: "gemini-cli" },
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

// Connect an agent in one step: pick the tool, press the button, paste the result.
export default function Connect({ api, project, projectName, onChanged }) {
  const [client, setClient] = useState("claude"),
    [token, setToken] = useState(""),
    [agentName, setAgentName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    url =
      (typeof window !== "undefined" ? window.location.origin : "") + "/mcp",
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
      <div className="connect-tabs" role="tablist" aria-label="Agent tool">
        {clients.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={client === c.id}
            className={client === c.id ? "active" : ""}
            onClick={() => pick(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      {!project ? (
        <p className="settings-warning">Create a project first.</p>
      ) : !token ? (
        <div className="connect-step">
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
      ) : (
        <div className="connect-step">
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
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
