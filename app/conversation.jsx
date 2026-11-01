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
  Phone,
  Plus,
  Video,
  Reply,
  MessagesSquare,
  Users,
  Search,
  Send,
  Smile,
  Pin,
  Trash2,
  UserRound,
} from "lucide-react";
import AgentAvatar, { photoOf } from "./agent-avatar";
import Markdown from "./markdown";
import UserAvatar from "./user-avatar";
import { hueFor } from "./gradient";
import Resizer, { useSize } from "./resizer";
import Fluid from "./fluid";

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
const EMOJIS = [
  "😀",
  "😂",
  "😅",
  "😊",
  "😍",
  "🤔",
  "😎",
  "😭",
  "🙏",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🔥",
  "🎉",
  "❤️",
  "💯",
  "✅",
  "❌",
  "👀",
  "🚀",
  "💡",
  "🐛",
  "⚠️",
];
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
  onMenu,
  onProfile,
  callThread,
  onStartCall,
  onLeaveCall,
  api,
  myId,
  onDelete,
  onBack,
}) {
  const last = thread[thread.length - 1],
    scroller = useRef(null),
    [side, setSide] = useState(true),
    [emojis, setEmojis] = useState(false),
    [sideW, setSideW, resetSideW] = useSize("side", 280, 200, 480),
    [callH, setCallH, resetCallH] = useSize("callh", 300, 200, 760),
    [inCall, setInCall] = useState([]),
    [find, setFind] = useState(""),
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
  const calling = !!callThread && callThread === chosen?.thread_id;
  // Show who is already in this conversation's call.
  useEffect(() => {
    if (calling || !last?.id || !api) return;
    let live = true;
    const look = () =>
      api("calls/status?message_id=" + last.id)
        .then((r) => live && setInCall(r.people))
        .catch(() => {});
    look();
    const t = setInterval(look, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [calling, last?.id]);
  // Keep the newest message in view, like a chat.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chosen?.thread_id, thread.length]);
  // People are shown by their real name, not the identity slug.
  const shown = (n) =>
    agentOf(n)?.program === "human" ? agentOf(n).owner_name || n : n;
  const title = root(thread[0]?.subject || chosen.subject),
    everyone = [
      ...new Set(
        thread.flatMap((m) => [
          m.sender_name,
          ...m.recipients.map((r) => r.name),
        ]),
      ),
    ],
    owners = [
      ...everyone
        .reduce((map, name) => {
          const a = agentOf(name),
            key = a?.owner_name || "No owner",
            node = map.get(key) || { person: null, agents: [], photo: null };
          if (a?.owner_avatar_v)
            node.photo = { id: a.owner_id, v: a.owner_avatar_v };
          if (a?.program === "human") node.person = { name, a };
          else node.agents.push({ name, a });
          map.set(key, node);
          return map;
        }, new Map())
        .entries(),
    ],
    files = thread.flatMap((m) =>
      m.attachments.map((f) => ({ ...f, from: m.sender_name })),
    ),
    high = thread.some((m) => m.importance === "high"),
    replyTo = [
      ...new Set([last.sender_name, ...last.recipients.map((r) => r.name)]),
    ].filter((n) => n !== agent);

  // The search box filters this conversation's messages, by text, sender or attachment name.
  const q = find.trim().toLowerCase(),
    has = (...t) =>
      t.some((x) =>
        String(x || "")
          .toLowerCase()
          .includes(q),
      ),
    shownThread = !q
      ? thread
      : thread.filter((m) =>
          has(
            m.body,
            m.sender_name,
            shown(m.sender_name),
            ...m.attachments.map((f) => f.filename),
          ),
        ),
    visibleOwners = owners,
    visibleFiles = files;
  const kindOf = (n) => (agentOf(n)?.program === "human" ? "person" : "agent");
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
      <div className="chat-layout" style={{ "--side-w": sideW + "px" }}>
        <div
          className="thread-scroll chat"
          style={{ "--call-h": callH + "px" }}
        >
          <div className="chat-head slim">
            <button
              className="icon-button mobile-back"
              title="Back"
              onClick={onBack}
            >
              <ArrowLeft size={17} />
            </button>
            <MessagesSquare size={20} className="head-icon" />
            <h1 title={title}>{title}</h1>
            {high && <span className="chip warn first">High priority</span>}
            <span className="head-sep" />
            <span className="head-sub">
              {thread.length} {thread.length === 1 ? "message" : "messages"}
            </span>
            <div className="head-actions">
              <button
                className={
                  "head-btn" +
                  (calling ? " active" : "") +
                  (inCall.length && !calling ? " live" : "")
                }
                aria-pressed={calling}
                aria-label={calling ? "Leave call" : "Join the voice call"}
                title={
                  calling
                    ? "Leave call"
                    : inCall.length
                      ? `In the call: ${inCall.map((p) => p.name).join(", ")}. Click to join`
                      : "Start a voice call"
                }
                onClick={() => (calling ? onLeaveCall() : onStartCall(false))}
              >
                <Phone size={20} />
                {inCall.length > 0 && !calling && (
                  <span className="live-dot">{inCall.length}</span>
                )}
              </button>
              <button
                className={"head-btn" + (starred ? " on" : "")}
                aria-pressed={starred}
                aria-label={starred ? "Unpin" : "Pin this conversation"}
                title={starred ? "Pinned. Click to unpin" : "Pin"}
                onClick={onStar}
              >
                <Pin size={20} />
              </button>
              <button
                className={"head-btn" + (side ? " active" : "")}
                aria-pressed={side}
                aria-label="Show members and files"
                title={side ? "Hide member list" : "Show member list"}
                onClick={() => setSide(!side)}
              >
                <Users size={20} />
              </button>
              {canDelete && (
                <button
                  className={"head-btn danger" + (confirm ? " confirm" : "")}
                  aria-label={
                    confirm ? "Confirm delete" : "Delete conversation"
                  }
                  title={
                    confirm
                      ? "Click again to delete this conversation and its files"
                      : "Delete conversation"
                  }
                  onClick={() => (confirm ? onDelete() : setConfirm(true))}
                  onBlur={() => setConfirm(false)}
                >
                  <Trash2 size={20} />
                </button>
              )}
            </div>
          </div>

          {inCall.length > 0 && !calling && (
            <div className="call-preview" role="status">
              <div className="in-call">
                {inCall.slice(0, 4).map((p) => (
                  <UserAvatar
                    key={p.id}
                    id={p.uid}
                    name={p.name}
                    v={p.avatar_v}
                    size={38}
                  />
                ))}
              </div>
              <div className="preview-text">
                <strong>
                  <span className="pulse" />
                  Call in progress
                </strong>
                <em>{inCall.map((p) => p.name).join(", ")}</em>
              </div>
              <div className="preview-actions">
                <button
                  className="join-btn video"
                  aria-label="Join with video"
                  onClick={() => onStartCall(true)}
                >
                  <Video size={18} />
                  Video
                </button>
                <button
                  className="join-btn"
                  aria-label="Join call"
                  onClick={() => onStartCall(false)}
                >
                  <Phone size={18} />
                  Join
                </button>
              </div>
            </div>
          )}
          {calling && <div id="call-slot" className="call-slot" />}
          {calling && (
            <Resizer
              axis="y"
              size={callH}
              onChange={setCallH}
              onReset={resetCallH}
              label="Resize the call"
            />
          )}
          <div className="chat-scroll" ref={scroller}>
            {!shownThread.length && (
              <p className="chat-empty">No messages match "{find}".</p>
            )}
            {shownThread.map((m, i) => {
              const sender = agentOf(m.sender_name),
                mine = m.sender_name === agent,
                prev = shownThread[i - 1],
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
                  onContextMenu={(e) =>
                    onMenu(e, [
                      {
                        label: "Copy text",
                        icon: <Copy size={14} />,
                        onClick: () => navigator.clipboard.writeText(m.body),
                      },
                      {
                        label: "View " + shown(m.sender_name) + " profile",
                        icon: <UserRound size={14} />,
                        onClick: () =>
                          onProfile(kindOf(m.sender_name), m.sender_name),
                      },
                      {
                        label: "Reply",
                        icon: <Reply size={14} />,
                        disabled: !canWrite,
                        onClick: () => onReply(m),
                      },
                      ...m.attachments.map((f) => ({
                        label: "Download " + f.filename,
                        icon: <Download size={14} />,
                        onClick: () => window.open(f.download_url),
                      })),
                    ])
                  }
                >
                  {grouped ? (
                    <span className="bubble-gap" />
                  ) : (
                    <button
                      className="who-btn"
                      aria-label={"Profile of " + shown(m.sender_name)}
                      onClick={() =>
                        onProfile(kindOf(m.sender_name), m.sender_name)
                      }
                    >
                      <AgentAvatar
                        name={m.sender_name}
                        photo={photoOf(sender)}
                        program={sender?.program}
                        model={sender?.model}
                        className="avatar"
                      />
                    </button>
                  )}
                  <div className="bubble-col">
                    {!grouped && (
                      <div className="bubble-meta">
                        <button
                          className="who-name"
                          onClick={() =>
                            onProfile(kindOf(m.sender_name), m.sender_name)
                          }
                        >
                          {shown(m.sender_name)}
                        </button>
                        {sender?.program && sender.program !== "human" && (
                          <em>{sender.program}</em>
                        )}
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
                          ? "Read by " +
                            readers.map((r) => shown(r.name)).join(", ")
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
              <div className="chat-box">
                <button
                  type="button"
                  className="box-btn"
                  title="Attach files, or write a longer message"
                  aria-label="Attach files"
                  onClick={() => onReply(last, text)}
                >
                  <Plus size={20} />
                </button>
                <textarea
                  id="body"
                  rows={1}
                  maxLength={100000}
                  value={text}
                  placeholder={`Message ${(replyTo.length ? replyTo : [agent]).map(shown).join(", ")}`}
                  onChange={(e) => {
                    setText(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height =
                      Math.min(e.target.scrollHeight, 220) + "px";
                  }}
                  onKeyDown={(e) => {
                    // Enter sends, Shift+Enter starts a new line, Ctrl+B and Ctrl+I format.
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      if (text.trim() && !sending) send();
                    }
                    if (
                      (e.ctrlKey || e.metaKey) &&
                      "bi".includes(e.key.toLowerCase())
                    ) {
                      e.preventDefault();
                      const mark = e.key.toLowerCase() === "b" ? "**" : "_",
                        el = e.target,
                        a = el.selectionStart,
                        z = el.selectionEnd;
                      setText(
                        text.slice(0, a) +
                          mark +
                          text.slice(a, z) +
                          mark +
                          text.slice(z),
                      );
                      requestAnimationFrame(() =>
                        el.setSelectionRange(a + mark.length, z + mark.length),
                      );
                    }
                  }}
                />
                <div className="box-emoji">
                  <button
                    type="button"
                    className="box-btn"
                    title="Emoji"
                    aria-label="Emoji"
                    onClick={() => setEmojis(!emojis)}
                  >
                    <Smile size={20} />
                  </button>
                  {emojis && (
                    <div className="emoji-grid">
                      {EMOJIS.map((e) => (
                        <button
                          type="button"
                          key={e}
                          onClick={() => {
                            setText(text + e);
                            setEmojis(false);
                            document.getElementById("body")?.focus();
                          }}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="box-send"
                  aria-label="Send reply"
                  title="Send (Enter)"
                  disabled={sending || !text.trim()}
                >
                  <Send size={18} />
                </button>
              </div>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
            </form>
          )}
        </div>
        {side && (
          <>
            <Resizer
              size={sideW}
              grow={-1}
              onChange={setSideW}
              onReset={resetSideW}
              label="Resize the member list"
            />
            <aside className="chat-side slim">
              <div className="side-top">
                <label className="side-search">
                  <Search size={15} />
                  <input
                    aria-label="Search this conversation"
                    placeholder="Search this conversation"
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                  />
                  {q && (
                    <span className="side-count">
                      {shownThread.length}/{thread.length}
                    </span>
                  )}
                </label>
              </div>
              <div className="side-section">Members — {everyone.length}</div>
              <Fluid className="side-list" item=".side-member">
                {visibleOwners.map(
                  ([owner, { person, agents: owned, photo }]) => (
                    <div className="side-group" key={owner}>
                      <div
                        className="side-member side-person"
                        onClick={() =>
                          onProfile(
                            person ? "person" : "agent",
                            person?.name || owner,
                          )
                        }
                        onContextMenu={(e) =>
                          onMenu(e, [
                            {
                              label: "View profile",
                              icon: <UserRound size={14} />,
                              onClick: () =>
                                onProfile(
                                  person ? "person" : "agent",
                                  person?.name || owner,
                                ),
                            },
                            {
                              label: "Copy name",
                              icon: <Copy size={14} />,
                              onClick: () =>
                                navigator.clipboard.writeText(owner),
                            },
                          ])
                        }
                      >
                        <AgentAvatar
                          className="avatar"
                          name={person?.name || owner}
                          photo={photo}
                          program={person ? "human" : undefined}
                        />
                        <div>
                          <strong>
                            {owner}
                            {person?.name === agent && (
                              <em className="chip">You</em>
                            )}
                          </strong>
                          <span>
                            {owned.length
                              ? `${owned.length} ${owned.length === 1 ? "agent" : "agents"}`
                              : "Person"}
                          </span>
                        </div>
                      </div>
                      {owned.length > 0 && (
                        <div className="side-tree">
                          {owned.map(({ name, a }) => (
                            <div
                              className="side-member side-agent"
                              key={name}
                              onClick={() => onProfile("agent", name)}
                              onContextMenu={(e) =>
                                onMenu(e, [
                                  {
                                    label: "View profile",
                                    icon: <UserRound size={14} />,
                                    onClick: () => onProfile("agent", name),
                                  },
                                  {
                                    label: "Copy name",
                                    icon: <Copy size={14} />,
                                    onClick: () =>
                                      navigator.clipboard.writeText(name),
                                  },
                                ])
                              }
                            >
                              <AgentAvatar
                                className="avatar"
                                name={name}
                                program={a?.program}
                                model={a?.model}
                              />
                              <div>
                                <strong>{name}</strong>
                                <span>
                                  {a ? `${a.program} · ${a.model}` : ""}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ),
                )}
              </Fluid>
              {visibleFiles.length > 0 && (
                <>
                  <div className="side-section">Files — {files.length}</div>
                  <div className="side-list">
                    {visibleFiles.map((f) => (
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
                            {bytes(f.size)} · {shown(f.from)}
                          </span>
                        </div>
                        <Download size={14} />
                      </a>
                    ))}
                  </div>
                </>
              )}
            </aside>
          </>
        )}
      </div>
    </>
  );
}
