"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  CornerDownRight,
  Download,
  FileText,
  Maximize2,
  PanelRight,
  Plus,
  Send,
  Star,
  Trash2,
} from "lucide-react";
import AgentAvatar from "./agent-avatar";
import Markdown from "./markdown";
import Composer from "./composer";

const bytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
const full = (iso) =>
  new Date(iso).toLocaleString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 604800) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
const snippet = (md) =>
  md
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/[#>*`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
const isImage = (name) => /\.(png|jpe?g|gif|webp|avif)$/i.test(name);
const clock = (iso) =>
  new Date(iso).toLocaleTimeString("en", {
    hour: "numeric",
    minute: "2-digit",
  });
const root = (subject) => subject.replace(/^((re|fwd?):\s*)+/i, "") || subject;

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      title="Copy message text"
      aria-label="Copy message text"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

// A conversation laid out like an email thread: star by the title, flat messages, inline reply.
export default function Conversation({
  thread,
  chosen,
  project,
  agent,
  agentOf,
  canWrite,
  canDelete,
  starred,
  onStar,
  onReply,
  onQuickReply,
  onConnect,
  onDelete,
  onBack,
}) {
  const last = thread[thread.length - 1],
    scroller = useRef(null),
    [side, setSide] = useState(true),
    [sideTab, setSideTab] = useState("members"),
    [confirm, setConfirm] = useState(false),
    [text, setText] = useState(""),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setConfirm(false);
    setText("");
    setError("");
  }, [chosen?.thread_id]);
  // Keep the newest message in view, like a chat.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chosen?.thread_id, thread.length]);
  const title = root(thread[0]?.subject || chosen.subject),
    everyone = [
      ...new Set(
        thread.flatMap((m) => [
          m.sender_name,
          ...m.recipients.map((r) => r.name),
        ]),
      ),
    ],
    files = thread.flatMap((m) =>
      m.attachments.map((f) => ({ ...f, from: m.sender_name })),
    ),
    high = thread.some((m) => m.importance === "high"),
    replyTo = [
      ...new Set([last.sender_name, ...last.recipients.map((r) => r.name)]),
    ].filter((n) => n !== agent);

  async function send(e) {
    e?.preventDefault();
    setSending(true);
    setError("");
    try {
      await onQuickReply(last, text);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }
  const recipientsLabel = (m) => {
    const names = m.recipients.map((r) => (r.name === agent ? "me" : r.name));
    return "to " + names.join(", ");
  };

  return (
    <>
      <div className="reader-toolbar">
        <button
          className="icon-button mobile-back"
          title="Back"
          onClick={onBack}
        >
          <ArrowLeft size={17} />
        </button>
        <span className="toolbar-title">{project?.name}</span>
        <div className="reader-actions">
          <button
            className={"subtle-button" + (side ? " on" : "")}
            title="Members and files"
            aria-pressed={side}
            onClick={() => setSide(!side)}
          >
            <PanelRight size={14} />
            Details
          </button>
          <button
            className="subtle-button"
            disabled={!canWrite}
            onClick={() => document.getElementById("body")?.focus()}
          >
            <CornerDownRight size={14} />
            Reply
          </button>
          {canDelete && (
            <button
              className="subtle-button danger"
              title="Delete this conversation and files only attached to it"
              onClick={() => (confirm ? onDelete() : setConfirm(true))}
              onBlur={() => setConfirm(false)}
            >
              <Trash2 size={14} />
              {confirm ? "Confirm delete" : "Delete"}
            </button>
          )}
        </div>
      </div>

      <div className="chat-layout">
        <div className="thread-scroll chat">
          <div className="chat-head">
            <div className="title-row">
              <h1>{title}</h1>
              <button
                className={"star-icon" + (starred ? " on" : "")}
                aria-pressed={starred}
                aria-label={starred ? "Remove star" : "Star this conversation"}
                title={
                  starred
                    ? "Starred. Click to remove"
                    : "Star this conversation"
                }
                onClick={onStar}
              >
                <Star size={20} />
              </button>
            </div>
            <div className="thread-meta">
              {high && <span className="chip warn first">High priority</span>}
              <div className="participants" aria-label="Participants">
                {everyone.slice(0, 5).map((name) => (
                  <AgentAvatar
                    key={name}
                    className="avatar tiny"
                    name={name}
                    program={agentOf(name)?.program}
                    model={agentOf(name)?.model}
                  />
                ))}
                <span>
                  {everyone.slice(0, 3).join(", ")}
                  {everyone.length > 3 ? ` +${everyone.length - 3}` : ""}
                </span>
              </div>
              <span>
                {thread.length} {thread.length === 1 ? "message" : "messages"}
              </span>
            </div>
          </div>

          <div className="chat-scroll" ref={scroller}>
            {thread.map((m, i) => {
              const sender = agentOf(m.sender_name),
                mine = m.sender_name === agent,
                prev = thread[i - 1],
                grouped =
                  prev &&
                  prev.sender_name === m.sender_name &&
                  Date.parse(m.created_at) - Date.parse(prev.created_at) <
                    300000,
                readers = m.recipients.filter((r) => r.read_at);
              return (
                <div
                  className={
                    "bubble-row" +
                    (mine ? " mine" : "") +
                    (grouped ? " grouped" : "")
                  }
                  key={m.id}
                >
                  {grouped ? (
                    <span className="bubble-gap" />
                  ) : (
                    <AgentAvatar
                      name={m.sender_name}
                      program={sender?.program}
                      model={sender?.model}
                      className="avatar"
                    />
                  )}
                  <div className="bubble-col">
                    {!grouped && (
                      <div className="bubble-meta">
                        <strong>{m.sender_name}</strong>
                        {sender?.program && <em>{sender.program}</em>}
                        <time title={full(m.created_at)}>
                          {clock(m.created_at)}
                        </time>
                      </div>
                    )}
                    <div className="bubble">
                      <Markdown>{m.body}</Markdown>
                      {m.attachments.length > 0 && (
                        <div className="attachment-grid">
                          {m.attachments.map((f) =>
                            isImage(f.filename) ? (
                              <a
                                className="image-card"
                                key={f.id}
                                href={f.download_url}
                                download={f.filename}
                                title={`Download ${f.filename}`}
                              >
                                <img
                                  src={`${f.download_url}?inline=1`}
                                  alt={f.filename}
                                  loading="lazy"
                                />
                                <span>
                                  {f.filename} · {bytes(f.size)}
                                </span>
                              </a>
                            ) : (
                              <a
                                className="file-card"
                                key={f.id}
                                href={f.download_url}
                                download={f.filename}
                              >
                                <span className="file-icon">
                                  <FileText size={19} />
                                </span>
                                <div>
                                  <strong>{f.filename}</strong>
                                  <span>{bytes(f.size)} · Download</span>
                                </div>
                                <Download size={16} />
                              </a>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                    <div className="bubble-foot">
                      <span className="delivery">
                        <CheckCheck size={12} />
                        {readers.length
                          ? "Read by " + readers.map((r) => r.name).join(", ")
                          : "Delivered"}
                      </span>
                      <span className="bubble-time">{ago(m.created_at)}</span>
                      <CopyButton text={m.body} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {canWrite && (
            <form className="chat-input" onSubmit={send}>
              <Composer
                value={text}
                onChange={setText}
                placeholder={`Message ${(replyTo.length ? replyTo : [agent]).join(", ")}`}
                onSubmit={() => text.trim() && !sending && send()}
              />
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <div className="chat-input-actions">
                <span className="muted small">Ctrl+Enter to send</span>
                <button
                  type="button"
                  className="icon-button"
                  title="Open the full editor to attach files"
                  aria-label="Open the full editor"
                  onClick={() => onReply(last, text)}
                >
                  <Maximize2 size={15} />
                </button>
                <button className="primary" disabled={sending || !text.trim()}>
                  <Send size={14} />
                  Send reply
                </button>
              </div>
            </form>
          )}
        </div>
        {side && (
          <aside className="chat-side">
            <div className="side-tabs" role="tablist">
              {[
                ["members", "Members"],
                ["files", "Files"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={sideTab === id}
                  className={sideTab === id ? "active" : ""}
                  onClick={() => setSideTab(id)}
                >
                  {label}
                  <span>
                    {id === "members" ? everyone.length : files.length}
                  </span>
                </button>
              ))}
            </div>
            {sideTab === "members" ? (
              <div className="side-list">
                {everyone.map((name) => {
                  const a = agentOf(name);
                  return (
                    <div className="side-member" key={name}>
                      <AgentAvatar
                        className="avatar"
                        name={name}
                        program={a?.program}
                        model={a?.model}
                      />
                      <div>
                        <strong>
                          {name}
                          {name === agent && <em className="chip">You</em>}
                        </strong>
                        <span>{a ? `${a.program} · ${a.model}` : "Agent"}</span>
                        {a?.last_active && (
                          <span>Active {ago(a.last_active)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {onConnect && (
                  <button
                    className="subtle-button side-add"
                    onClick={onConnect}
                  >
                    <Plus size={14} />
                    Connect another agent
                  </button>
                )}
              </div>
            ) : (
              <div className="side-list">
                {files.length ? (
                  files.map((f) => (
                    <a
                      className="side-file"
                      key={f.id}
                      href={f.download_url}
                      download={f.filename}
                    >
                      <FileText size={16} />
                      <div>
                        <strong>{f.filename}</strong>
                        <span>
                          {bytes(f.size)} · {f.from}
                        </span>
                      </div>
                      <Download size={14} />
                    </a>
                  ))
                ) : (
                  <p className="muted small">No files in this conversation.</p>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </>
  );
}
