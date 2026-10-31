"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  CornerDownRight,
  Download,
  FileText,
  Maximize2,
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
  onDelete,
  onBack,
}) {
  const last = thread[thread.length - 1],
    [open, setOpen] = useState(new Set([last?.id])),
    [confirm, setConfirm] = useState(false),
    [drafting, setDrafting] = useState(false),
    [text, setText] = useState(""),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setOpen(new Set([last?.id]));
    setConfirm(false);
    setDrafting(false);
    setText("");
    setError("");
  }, [chosen?.thread_id, last?.id]);
  const toggle = (id) =>
    setOpen((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const title = root(thread[0]?.subject || chosen.subject),
    everyone = [
      ...new Set(
        thread.flatMap((m) => [
          m.sender_name,
          ...m.recipients.map((r) => r.name),
        ]),
      ),
    ],
    allOpen = open.size >= thread.length,
    high = thread.some((m) => m.importance === "high"),
    replyTo = [
      ...new Set([last.sender_name, ...last.recipients.map((r) => r.name)]),
    ].filter((n) => n !== agent);

  async function send(e) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      await onQuickReply(last, text);
      setText("");
      setDrafting(false);
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
            className="subtle-button"
            disabled={!canWrite}
            onClick={() => {
              setDrafting(true);
              requestAnimationFrame(() =>
                document.getElementById("body")?.focus(),
              );
            }}
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

      <div className="thread-scroll flat">
        <div className="thread-heading">
          <div className="title-row">
            <h1>{title}</h1>
            <button
              className={"star-icon" + (starred ? " on" : "")}
              aria-pressed={starred}
              aria-label={starred ? "Remove star" : "Star this conversation"}
              title={
                starred ? "Starred. Click to remove" : "Star this conversation"
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
            {thread.length > 2 && (
              <button
                className="link-button"
                onClick={() =>
                  setOpen(
                    allOpen
                      ? new Set([last.id])
                      : new Set(thread.map((m) => m.id)),
                  )
                }
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            )}
          </div>
        </div>

        <div className="messages">
          {thread.map((m) => {
            const expanded = open.has(m.id),
              sender = agentOf(m.sender_name),
              readers = m.recipients.filter((r) => r.read_at);
            return (
              <article
                className={"mail" + (expanded ? " open" : "")}
                key={m.id}
              >
                <header
                  onClick={() => toggle(m.id)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") &&
                    (e.preventDefault(), toggle(m.id))
                  }
                >
                  <AgentAvatar
                    name={m.sender_name}
                    program={sender?.program}
                    model={sender?.model}
                    className={expanded ? "avatar" : "avatar small"}
                  />
                  <div className="mail-who">
                    <div>
                      <strong>{m.sender_name}</strong>
                      {sender?.program && <em>{sender.program}</em>}
                    </div>
                    <span>
                      {expanded ? recipientsLabel(m) : snippet(m.body)}
                    </span>
                  </div>
                  <time title={full(m.created_at)}>{ago(m.created_at)}</time>
                </header>

                {expanded && (
                  <div className="mail-body">
                    <Markdown>{m.body}</Markdown>

                    {m.attachments.length > 0 && (
                      <div className="attachments">
                        <div className="section-label">
                          {m.attachments.length} ATTACHMENT
                          {m.attachments.length === 1 ? "" : "S"}
                        </div>
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
                      </div>
                    )}

                    <footer className="mail-foot">
                      <span className="delivery">
                        <CheckCheck size={13} />
                        {readers.length
                          ? "Read by " + readers.map((r) => r.name).join(", ")
                          : "Delivered"}
                      </span>
                      <CopyButton text={m.body} />
                    </footer>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {canWrite &&
          (drafting ? (
            <form className="inline-reply" onSubmit={send}>
              <div className="inline-reply-head">
                <AgentAvatar
                  className="avatar small"
                  name={agent}
                  program={agentOf(agent)?.program}
                  model={agentOf(agent)?.model}
                />
                <span>
                  Replying to{" "}
                  <strong>
                    {(replyTo.length ? replyTo : [agent]).join(", ")}
                  </strong>
                </span>
                <button
                  type="button"
                  className="icon-button"
                  title="Open the full editor to attach files"
                  aria-label="Open the full editor"
                  onClick={() => onReply(last, text)}
                >
                  <Maximize2 size={15} />
                </button>
              </div>
              <Composer
                value={text}
                onChange={setText}
                placeholder="Write your reply. Markdown works: **bold**, `code`, lists, links."
              />
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <div className="menu-actions">
                <button className="primary" disabled={sending || !text.trim()}>
                  <Send size={14} />
                  Send reply
                </button>
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() => {
                    setDrafting(false);
                    setText("");
                  }}
                >
                  Discard
                </button>
              </div>
            </form>
          ) : (
            <button className="reply-box" onClick={() => setDrafting(true)}>
              <AgentAvatar
                className="avatar small"
                name={agent}
                program={agentOf(agent)?.program}
                model={agentOf(agent)?.model}
              />
              Reply to {(replyTo.length ? replyTo : [agent]).join(", ")}...
              <CornerDownRight size={15} />
            </button>
          ))}
      </div>
    </>
  );
}
