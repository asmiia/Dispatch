"use client";
import Select from "./select";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Mail,
  Inbox,
  Send,
  Paperclip,
  PanelLeft,
  Plus,
  Search,
  ChevronDown,
  Folder,
  Terminal,
  ArrowUpRight,
  Settings as Gear,
  Settings2,
  RefreshCw,
  Loader2,
  X,
  Check,
  Trash2,
  Star,
} from "lucide-react";
import Settings from "./settings";
import Login from "./login";
import AgentAvatar, { logoFor } from "./agent-avatar";
import Connect from "./connect";
import Conversation from "./conversation";
import Composer from "./composer";
function DispatchMark({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 11 21 3l-8 18-2-8-8-2Z" fill="currentColor" />
      <path
        className="mark-cut"
        d="m11 13 10-10"
        stroke="#f2f2f2"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
// Short relative time for the message list: now, 5m, 3h, 2d, then the date.
const when = (iso) => {
  const t = (Date.now() - Date.parse(iso)) / 1000;
  if (t < 60) return "now";
  if (t < 3600) return `${Math.round(t / 60)}m`;
  if (t < 86400) return `${Math.round(t / 3600)}h`;
  if (t < 604800) return `${Math.round(t / 86400)}d`;
  return new Date(iso).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
};
// One-line plain-text preview of a Markdown body.
const preview = (md) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/[#>*`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 125);
const date = (value) =>
  new Date(value).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const size = (value) =>
  value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(1)} MB`;
async function api(path, body) {
  const response = await fetch("/api/" + path, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "Request failed");
    error.status = response.status;
    throw error;
  }
  return value;
}
export default function Workspace() {
  const [authenticated, setAuthenticated] = useState(null),
    [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]),
    [project, setProject] = useState(""),
    [projectTeam, setProjectTeam] = useState(""),
    [agents, setAgents] = useState([]),
    [agent, setAgent] = useState(""),
    [compact, setCompact] = useState(false),
    [sort, setSort] = useState("recent");
  const [messages, setMessages] = useState([]),
    [selected, setSelected] = useState(""),
    [thread, setThread] = useState([]),
    [query, setQuery] = useState(""),
    [folder, setFolder] = useState("inbox");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [newName, setNewName] = useState(""),
    [draft, setDraft] = useState({
      to: [],
      subject: "",
      body_md: "",
      attachment_paths: [],
    }),
    [uploads, setUploads] = useState([]),
    [uploading, setUploading] = useState(false);
  const fileInput = useRef(null),
    searchInput = useRef(null);
  const [starred, setStarred] = useState(() => new Set());
  const refreshProjects = useCallback(async () => {
    try {
      const [list, me] = await Promise.all([api("projects"), api("me")]);
      setProjects(list);
      setUser(me);
      setAuthenticated(true);
      setProject((current) =>
        list.some((p) => p.id === current) ? current : list[0]?.id || "",
      );
    } catch (e) {
      if (e.status === 401) setAuthenticated(false);
      else setError(e.message);
    }
  }, []);
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);
  const refresh = useCallback(async () => {
    if (!project) {
      setAgents([]);
      setMessages([]);
      return;
    }
    try {
      // The web app writes as the signed-in person, not as an agent.
      const me = await api("me/identity", { project_key: project });
      const [people, mail, list, stars] = await Promise.all([
        api("agents?project=" + project),
        api("messages?project=" + project),
        api("projects"),
        api("starred?project=" + project),
      ]);
      setStarred(new Set(stars.threads));
      setProjects(list);
      setAgents(people);
      setAgent(me.name);
      setMessages(mail);
    } catch (e) {
      if (e.status === 401) setAuthenticated(false);
      else setError(e.message);
    }
  }, [project]);
  useEffect(() => {
    try {
      setCompact(localStorage.getItem("dispatch-compact") === "1");
    } catch {}
  }, []);
  useEffect(() => {
    setSelected("");
    setThread([]);
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  // Live updates: the server pings this stream whenever something changes.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource("/api/stream");
    stream.onmessage = () => refresh();
    return () => stream.close();
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    api("messages/" + selected)
      .then((t) => {
        if (active) setThread(t);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [selected, messages]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInput.current?.focus();
      }
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const current = projects.find((p) => p.id === project),
    role = user?.teams?.find((t) => t.id === current?.team_id)?.role;
  const canWrite =
      !!user?.site_admin || ["owner", "admin", "member"].includes(role),
    canDelete = !!user?.site_admin || ["owner", "admin"].includes(role),
    canManage =
      !!user?.site_admin ||
      user?.teams?.some((t) => ["owner", "admin"].includes(t.role));
  const agentOf = (name) => agents.find((a) => a.name === name);
  async function toggleStar(threadId) {
    const on = !starred.has(threadId);
    setStarred((cur) => {
      const next = new Set(cur);
      on ? next.add(threadId) : next.delete(threadId);
      return next;
    });
    try {
      await api("messages/star", { thread_id: threadId, starred: on });
    } catch (e) {
      setError(e.message);
      refresh();
    }
  }
  const unread = (m) => m.recipients.some((r) => !r.read_at);
  const visible = messages.filter(
    (m) =>
      (folder === "starred"
        ? starred.has(m.thread_id)
        : folder === "files"
          ? m.attachments.length
          : folder !== "unread" || unread(m)) &&
      `${m.subject} ${m.body} ${m.sender_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const seen = new Set(),
    unique =
      folder === "starred"
        ? visible.filter((m) => !seen.has(m.thread_id) && seen.add(m.thread_id))
        : visible,
    rows =
      sort === "oldest"
        ? [...unique].reverse()
        : sort === "unread"
          ? [...unique].sort((a, b) => unread(b) - unread(a))
          : unique,
    threadSize = (m) =>
      messages.filter((x) => x.thread_id === m.thread_id).length;
  const chosen = thread.find((m) => m.id === selected) || thread[0];
  async function openMessage(m) {
    setSelected(m.id);
    if (
      agent &&
      canWrite &&
      m.recipients.some((r) => r.name === agent && !r.read_at)
    ) {
      try {
        await api(`messages/${m.id}/read`, { agent_name: agent });
        refresh();
      } catch (e) {
        setError(e.message);
      }
    }
  }
  async function quickReply(reply, body_md) {
    const others = [
      ...new Set([reply.sender_name, ...reply.recipients.map((r) => r.name)]),
    ].filter((n) => n !== agent);
    await api("messages", {
      to: others.length ? others : [agent],
      subject: reply.subject,
      body_md,
      thread_id: reply.thread_id,
      project_key: project,
      sender_name: agent,
    });
    setThread(await api("messages/" + selected));
    await refresh();
  }
  function compose(reply, body = "") {
    const to = reply
      ? [
          ...new Set([
            reply.sender_name,
            ...reply.recipients.map((r) => r.name),
          ]),
        ].filter((n) => n !== agent)
      : [];
    setDraft({
      to: reply && !to.length ? [agent] : to,
      subject: reply?.subject || "",
      body_md: body,
      attachment_paths: [],
      ...(reply ? { thread_id: reply.thread_id } : {}),
    });
    setUploads([]);
    setModal("compose");
    setError("");
  }
  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const m = await api("messages", {
        ...draft,
        project_key: project,
        sender_name: agent,
      });
      setModal(null);
      setFolder("inbox");
      setSelected(m.id);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function addFiles(e) {
    setUploading(true);
    try {
      for (const file of [...e.target.files]) {
        if (file.size > 6 * 1024 * 1024)
          throw new Error("Each file must be smaller than 6 MB");
        const encoded = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const f = await api("files", {
          project_key: project,
          filename: file.name,
          data_base64: encoded,
        });
        setUploads((old) => [...old, f]);
        setDraft((old) => ({
          ...old,
          attachment_paths: [...old.attachment_paths, f.id],
        }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (modal === "project") {
        const p = await api("projects", {
          name: newName,
          team_id:
            projectTeam ||
            user?.teams?.find((t) => ["owner", "admin"].includes(t.role))?.id,
        });
        await refreshProjects();
        setProject(p.id);
      } else {
        const a = await api("agents", {
          project_key: project,
          name: newName,
          program: "browser",
          model: "operator",
        });
        setAgent(a.name);
        await refresh();
      }
      setNewName("");
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (authenticated === null)
    return (
      <main className="boot">
        <Loader2 className="spin" size={20} />
        Opening Dispatch
      </main>
    );
  if (!authenticated) return <Login onAuthed={refreshProjects} />;
  return (
    <div className="workspace">
      <aside className={"sidebar" + (compact ? " compact" : "")}>
        <div className="brand">
          <span className="brandmark">
            <DispatchMark size={18} />
          </span>
          <span className="brand-name">Dispatch</span>
          <button
            className="icon-button collapse-toggle"
            aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
            title={compact ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => {
              setCompact(!compact);
              try {
                localStorage.setItem("dispatch-compact", compact ? "" : "1");
              } catch {}
            }}
          >
            <PanelLeft size={16} />
          </button>
        </div>
        <div className="project-switch">
          <span className="project-avatar">{current?.name?.[0] || "T"}</span>
          <Select
            aria-label="Project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            {!projects.length && <option value="">Your workspace</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <ChevronDown size={13} />
        </div>
        <button
          className="compose"
          disabled={!agent || !canWrite}
          onClick={() => compose()}
        >
          <Plus size={16} />
          <span className="nav-label">Compose message</span>
          <span className="key">N</span>
        </button>
        <div className="section-label">WORKSPACE</div>
        <nav>
          {[
            ["inbox", Inbox, "Inbox"],
            ["unread", Mail, "Unread"],
            ["starred", Star, "Starred"],
            ["files", Paperclip, "Attachments"],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              title={label}
              className={folder === id ? "active" : ""}
              onClick={() => {
                setFolder(id);
                setSelected("");
                setThread([]);
              }}
            >
              <Icon size={16} />
              <span className="nav-label">{label}</span>
              {id === "inbox" && (
                <span className="count">{messages.length}</span>
              )}
              {id === "starred" && starred.size > 0 && (
                <span className="count">{starred.size}</span>
              )}
              {id === "unread" && (
                <span className="count">{messages.filter(unread).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="section-label section-row">
          PROJECTS
          <button
            aria-label="New project"
            disabled={!canManage}
            onClick={() => {
              setNewName("");
              setModal("project");
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="project-list">
          {projects.map((p) => (
            <button
              key={p.id}
              className={project === p.id ? "current" : ""}
              onClick={() => setProject(p.id)}
            >
              <Folder size={15} />
              <span>{p.name}</span>
              <span className="quiet-count">{p.message_count || 0}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setModal("connect")}>
            <Terminal size={16} />
            <span className="nav-label">Connect an agent</span>
            <ArrowUpRight size={13} className="nav-arrow" />
          </button>
          <button
            className="settings-open"
            onClick={() => setModal("settings")}
          >
            <Gear size={16} />
            <span className="nav-label">Settings</span>
          </button>
        </div>
      </aside>
      <main className="mail-main">
        {error && !modal && (
          <div className="error inline-error" role="alert">
            {error}
            <button onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className={"mail-columns " + (selected ? "has-selection" : "")}>
          <section className="message-list">
            <div className="list-heading">
              <h1>
                {folder === "files"
                  ? "Attachments"
                  : folder[0].toUpperCase() + folder.slice(1)}
              </h1>
              <button
                className="icon-button"
                aria-label="New message"
                disabled={!agent || !canWrite}
                onClick={() => compose()}
              >
                <Plus size={17} />
              </button>
            </div>
            <div className="search">
              <Search size={15} />
              <input
                ref={searchInput}
                aria-label="Search messages"
                placeholder="Search conversations..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>Ctrl K</kbd>
            </div>
            <div className="list-meta">
              <span>
                {rows.length}{" "}
                {rows.length === 1 ? "conversation" : "conversations"}
              </span>
              <Select
                aria-label="Sort"
                className="sort-pick"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="recent">Most recent</option>
                <option value="oldest">Oldest first</option>
                <option value="unread">Unread first</option>
              </Select>
            </div>
            <div className="message-scroll">
              {rows.map((m) => (
                <button
                  key={m.id}
                  className={
                    "message-row " +
                    (selected === m.id ? "selected " : "") +
                    (unread(m) ? "unread" : "")
                  }
                  onClick={() => openMessage(m)}
                >
                  <AgentAvatar
                    name={m.sender_name}
                    program={agentOf(m.sender_name)?.program}
                    model={agentOf(m.sender_name)?.model}
                  />
                  <div className="row-main">
                    <div className="row-top">
                      <strong>{m.sender_name}</strong>
                      {starred.has(m.thread_id) && (
                        <Star size={12} className="row-star" />
                      )}
                      <time title={new Date(m.created_at).toLocaleString()}>
                        {when(m.created_at)}
                      </time>
                    </div>
                    <div className="row-subject">
                      {unread(m) && <span className="new-dot" />}
                      <span>{m.subject}</span>
                      {folder === "starred" && threadSize(m) > 1 && (
                        <span className="row-chip">{threadSize(m)}</span>
                      )}
                      {m.importance === "high" && (
                        <span className="priority-dot" title="High priority" />
                      )}
                    </div>
                    <p>{preview(m.body)}</p>
                    <div className="row-foot">
                      <span>
                        to {m.recipients.map((r) => r.name).join(", ")}
                      </span>
                      {m.attachments.length > 0 && (
                        <span className="row-chip">
                          <Paperclip size={11} />
                          {m.attachments.length}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {!rows.length && (
                <div className="list-empty">
                  {folder === "starred" ? (
                    <Star size={24} />
                  ) : (
                    <Inbox size={24} />
                  )}
                  <strong>
                    {query
                      ? "No matches"
                      : folder === "starred"
                        ? "No starred conversations"
                        : "Nothing here yet"}
                  </strong>
                  <span>
                    {folder === "starred"
                      ? "Open a conversation and click its star to pin it here."
                      : "Your next conversation starts here."}
                  </span>
                  {!project && canManage ? (
                    <button
                      className="subtle-button"
                      onClick={() => setModal("project")}
                    >
                      Create project
                    </button>
                  ) : !agent && canWrite ? (
                    <button
                      className="subtle-button"
                      onClick={() => setModal("agent")}
                    >
                      Register agent
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>
          <section className="reader">
            {chosen ? (
              <>
                <Conversation
                  thread={thread}
                  chosen={chosen}
                  project={current}
                  agent={agent}
                  agentOf={agentOf}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  starred={starred.has(chosen.thread_id)}
                  onStar={() => toggleStar(chosen.thread_id)}
                  onReply={compose}
                  onQuickReply={quickReply}
                  onConnect={() => setModal("connect")}
                  onBack={() => {
                    setSelected("");
                    setThread([]);
                  }}
                  onDelete={async () => {
                    try {
                      await api("messages/delete", {
                        ids: thread.map((m) => m.id),
                      });
                      setSelected("");
                      setThread([]);
                      refresh();
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                />
              </>
            ) : (
              <div className="reader-empty">
                <div className="empty-orbit">
                  <DispatchMark size={30} />
                </div>
                <h2>Your team, connected.</h2>
                <p>
                  Keep your agents’ conversations, updates, and files together
                  in a secure workspace.
                </p>
                <button
                  className="subtle-button"
                  disabled={!agent || !canWrite}
                  onClick={() => compose()}
                >
                  <Plus size={14} />
                  New conversation
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
      {modal === "settings" && (
        <Settings
          onClose={() => setModal(null)}
          onChanged={refreshProjects}
          project={project}
          agents={agents}
        />
      )}
      {modal && modal !== "settings" && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy && !uploading)
              setModal(null);
          }}
        >
          <section
            className={"modal " + (modal === "compose" ? "compose-modal" : "")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <header>
              <div>
                <span className="eyebrow">DISPATCH</span>
                <h2 id="dialog-title">
                  {modal === "compose"
                    ? draft.thread_id
                      ? "Reply to conversation"
                      : "New message"
                    : modal === "project"
                      ? "Create a project"
                      : modal === "agent"
                        ? "Register an agent"
                        : "Connect your agents"}
                </h2>
              </div>
              <button
                className="icon-button"
                title="Close"
                onClick={() => setModal(null)}
              >
                <X size={17} />
              </button>
            </header>
            {modal === "compose" ? (
              <form onSubmit={send}>
                <div className="compose-from">
                  From <strong>{agent}</strong>
                  <span>in {current?.name}</span>
                </div>
                <label>To</label>
                <div className="recipients">
                  {agents.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={draft.to.includes(a.name) ? "chosen" : ""}
                      onClick={() =>
                        setDraft((old) => ({
                          ...old,
                          to: old.to.includes(a.name)
                            ? old.to.filter((n) => n !== a.name)
                            : [...old.to, a.name],
                        }))
                      }
                    >
                      {draft.to.includes(a.name) && <Check size={12} />}
                      <span className="presence" />
                      {a.name}
                    </button>
                  ))}
                </div>
                <label htmlFor="subject">Subject</label>
                <input
                  id="subject"
                  required
                  maxLength={200}
                  value={draft.subject}
                  onChange={(e) =>
                    setDraft({ ...draft, subject: e.target.value })
                  }
                  placeholder="What's the update?"
                />
                <label htmlFor="body">
                  Message <span>Markdown supported</span>
                </label>
                <Composer
                  value={draft.body_md}
                  onChange={(v) => setDraft({ ...draft, body_md: v })}
                  placeholder="Share context, decisions, or what needs to happen next..."
                />
                {uploads.length > 0 && (
                  <div className="upload-chips">
                    {uploads.map((f) => (
                      <span key={f.id}>
                        <Paperclip size={12} />
                        {f.filename}
                        <button
                          type="button"
                          aria-label={"Remove " + f.filename}
                          onClick={() => {
                            setUploads((old) =>
                              old.filter((x) => x.id !== f.id),
                            );
                            setDraft((old) => ({
                              ...old,
                              attachment_paths: old.attachment_paths.filter(
                                (id) => id !== f.id,
                              ),
                            }));
                          }}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="compose-actions">
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    multiple
                    onChange={addFiles}
                  />
                  <button
                    type="button"
                    className="subtle-button"
                    disabled={uploading || draft.attachment_paths.length >= 10}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Paperclip size={14} />
                    )}
                    Attach files<span className="muted">6 MB each</span>
                  </button>
                  <button
                    className="primary"
                    disabled={busy || uploading || !draft.to.length}
                  >
                    <Send size={14} />
                    Send message
                  </button>
                </div>
              </form>
            ) : modal === "connect" ? (
              <Connect
                api={api}
                project={project}
                projectName={current?.name}
                onChanged={refresh}
              />
            ) : (
              <form onSubmit={create}>
                <label htmlFor="new-name">
                  {modal === "project" ? "Project name" : "Agent name"}
                </label>
                <input
                  id="new-name"
                  autoFocus
                  required={modal === "project"}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={
                    modal === "project"
                      ? "e.g. Website"
                      : "Leave blank for a random name"
                  }
                />
                {modal === "project" && (
                  <>
                    <label htmlFor="project-team">Team</label>
                    <Select
                      id="project-team"
                      value={
                        projectTeam ||
                        user?.teams?.find((t) =>
                          ["owner", "admin"].includes(t.role),
                        )?.id ||
                        ""
                      }
                      onChange={(e) => setProjectTeam(e.target.value)}
                    >
                      {user?.teams
                        ?.filter((t) => ["owner", "admin"].includes(t.role))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </Select>
                  </>
                )}
                <p className="muted">
                  {modal === "project"
                    ? "Keep related conversations, agents and files together."
                    : "Leave it blank for a random name like CopperGrove, or use letters, numbers, underscores or hyphens."}
                </p>
                <button className="primary" disabled={busy}>
                  <Plus size={14} />
                  {modal === "project" ? "Create project" : "Register agent"}
                </button>
              </form>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
