"use client";
import { useEffect, useRef, useState } from "react";
import {
  CornerUpLeft,
  Copy,
  Download,
  FileText,
  Hash,
  MessageSquare,
  Paperclip,
  Phone,
  Captions,
  Mic,
  Volume2,
  Pin,
  Search,
  Trash2,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import AgentAvatar, { photoOf } from "./agent-avatar";
import UserAvatar from "./user-avatar";
import Markdown from "./markdown";
import MembersPanel from "./members-panel";
import Resizer, { useSize } from "./resizer";
import { ChatMessage } from "@/components/ui/chat-message";
import { quickVoice, setQuickVoice } from "./tts";
import { InputMessage } from "@/components/ui/input-message";
import { Tooltip } from "@/components/ui/tooltip";

const bytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
const clock = (iso) =>
  new Date(iso).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });
const day = (iso) =>
  new Date(iso).toLocaleDateString("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
const isImage = (name) => /\.(png|jpe?g|gif|webp|avif)$/i.test(name);
const root = (subject) => subject.replace(/^((re|fwd?):\s*)+/i, "") || subject;
const plain = (md) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const isVideo = (name) => /\.(mp4|m4v|webm|mov)$/i.test(name);
const isAudio = (name) => /\.(mp3|wav|ogg|m4a)$/i.test(name);

// Pictures, video and audio play right in the message with a download button on them; other files are cards.
function Attachments({ files }) {
  return (
    <div className="attachment-grid">
      {files.map((f) => {
        const dl = (
          <a
            className="dl-btn"
            href={f.download_url}
            download={f.filename}
            aria-label={"Download " + f.filename}
            title={"Download " + f.filename}
          >
            <Download size={15} />
          </a>
        );
        if (isImage(f.filename))
          return (
            <div className="media-wrap" key={f.id}>
              <a href={`${f.download_url}?inline=1`} target="_blank" rel="noreferrer">
                <img src={`${f.download_url}?inline=1`} alt={f.filename} loading="lazy" />
              </a>
              {dl}
            </div>
          );
        if (isVideo(f.filename))
          return (
            <div className="media-wrap" key={f.id}>
              <video controls preload="metadata" src={`${f.download_url}?inline=1`} />
              {dl}
            </div>
          );
        if (isAudio(f.filename))
          return (
            <div className="media-wrap audio" key={f.id}>
              <audio controls preload="metadata" src={`${f.download_url}?inline=1`} />
              {dl}
            </div>
          );
        return (
          <a className="file-card" key={f.id} href={f.download_url} download={f.filename}>
            <span className="file-icon">
              <FileText size={19} />
            </span>
            <div>
              <strong>{f.filename}</strong>
              <span>{bytes(f.size)} · Download</span>
            </div>
            <Download size={16} />
          </a>
        );
      })}
    </div>
  );
}

// The message box: Fluid's input with attachments, used for the feed and for a thread's replies.
function Box({ placeholder, onSend, history, label, people = [] }) {
  const [text, setText] = useState(""),
    [files, setFiles] = useState([]),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const typing = /(^|\s)@([^\s@]*)$/.exec(text),
    picks = typing
      ? people
          .filter((p) => p.label.toLowerCase().includes(typing[2].toLowerCase()))
          .slice(0, 6)
      : [];
  const mention = (p) =>
    setText(text.replace(/(^|\s)@([^\s@]*)$/, (_, lead) => `${lead}@${p.label} `));
  async function send(value, attached) {
    if (sending || (!value.trim() && !attached.length)) return;
    setSending(true);
    setError("");
    try {
      // Mentions are bold in the message, and whoever you mentioned gets it.
      const named = people
        .filter((p) => value.includes("@" + p.label))
        .sort((a, b) => b.label.length - a.label.length);
      let body = value.trim();
      for (const p of named)
        body = body.split("@" + p.label).join("**@" + p.label + "**");
      await onSend({
        text: body,
        files: attached,
        mentions: named.map((p) => p.name),
      });
      setText("");
      setFiles([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="feed-input">
      {picks.length > 0 && (
        <div className="mention-list" role="listbox">
          {picks.map((p) => (
            <button key={p.name} role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => mention(p)}>
              {p.agent ? <em>agent</em> : null}
              {p.label}
            </button>
          ))}
        </div>
      )}
      <InputMessage
        value={text}
        onValueChange={setText}
        files={files}
        onFilesChange={setFiles}
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json,application/zip"
        maxFiles={6}
        history={history}
        placeholder={placeholder}
        sendLabel="Send message"
        textareaProps={label ? { id: label } : undefined}
        disabled={sending}
        minRows={1}
        maxRows={8}
        onSend={send}
        leftSlot={({ openFilePicker }) => (
          <button
            type="button"
            className="msg-act attach"
            aria-label="Attach files"
            onClick={() => openFilePicker()}
          >
            <Paperclip size={18} />
          </button>
        )}
        rightSlot={() => (
          <button
            type="button"
            className="msg-act attach"
            aria-label="Mention someone"
            onClick={() => setText((t) => t + (t && !/\s$/.test(t) ? " @" : "@"))}
          >
            @
          </button>
        )}
      />
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

// One message: avatar, name, tag and time above a bubble. In a channel, replies fold into a summary.
function Row({ m, c, replies = [], onOpen }) {
  // Older picture-only messages carry an "Attached ..." line; it adds nothing next to the picture.
  if (m.attachments.length && /^Attached [^\n]+$/.test(m.body.trim()))
    m = { ...m, body: "" };
  const mine = m.sender_name === c.me,
    sender = c.agentOf(m.sender_name),
    kind = sender?.program === "human" ? "person" : "agent",
    readers = m.recipients.filter((r) => r.read_at),
    pinned = c.pinnedThreads.has(m.thread_id);
  const menu = (e) =>
    c.onMenu(e, [
      ...(onOpen
        ? [
            {
              label: "Open thread",
              icon: <MessageSquare size={14} />,
              onClick: () => onOpen(m.thread_id),
            },
          ]
        : []),
      {
        label: "Copy text",
        icon: <Copy size={14} />,
        onClick: () => navigator.clipboard.writeText(m.body),
      },
      {
        label: "View " + c.shown(m.sender_name) + " profile",
        icon: <UserRound size={14} />,
        onClick: () => c.onProfile(kind, m.sender_name),
      },
      {
        label: pinned ? "Unpin" : "Pin conversation",
        icon: <Pin size={14} />,
        onClick: () => c.onPin(m.thread_id),
      },
      ...m.attachments.map((f) => ({
        label: "Download " + f.filename,
        icon: <Download size={14} />,
        onClick: () => window.open(f.download_url),
      })),
      ...(c.canDelete
        ? [
            "-",
            {
              label: "Delete this conversation",
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () => c.onDeleteThread(m.thread_id),
            },
          ]
        : []),
    ]);
  return (
    <div className={"msg-row" + (mine ? " mine" : "")} onContextMenu={menu}>
      {!mine && (
        <button
          className="who-btn"
          aria-label={"Profile of " + c.shown(m.sender_name)}
          onClick={() => c.onProfile(kind, m.sender_name)}
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
      <div className="msg-col">
        <div className="msg-meta">
          {!mine && (
            <button className="who-name" onClick={() => c.onProfile(kind, m.sender_name)}>
              {c.shown(m.sender_name)}
            </button>
          )}
          {!mine && sender?.program && sender.program !== "human" && (
            <em className="tag">{sender.program}</em>
          )}
          <time>{clock(m.created_at)}</time>
          {pinned && <Pin size={11} className="pin" />}
        </div>
        <ChatMessage
          from={mine ? "user" : "assistant"}
          className="msg-body"
          time={
            readers.length ? "Read by " + readers.map((r) => c.shown(r.name)).join(", ") : undefined
          }
          actions={
            <>
              {onOpen && (
                <button
                  className="msg-act"
                  aria-label="Open thread"
                  onClick={() => onOpen(m.thread_id)}
                >
                  <MessageSquare size={14} />
                </button>
              )}
              <button
                className={"msg-act" + (pinned ? " on" : "")}
                aria-label={pinned ? "Unpin conversation" : "Pin conversation"}
                title={pinned ? "Unpin conversation" : "Pin conversation"}
                onClick={() => c.onPin(m.thread_id)}
              >
                <Pin size={14} />
              </button>
              <button
                className="msg-act"
                aria-label="Copy text"
                onClick={() => navigator.clipboard.writeText(m.body)}
              >
                <Copy size={14} />
              </button>
            </>
          }
        >
          {m.body.trim() ? (
            <div className="prose-wrap">
              <Markdown>{m.body}</Markdown>
            </div>
          ) : null}
          {onOpen && replies.length > 0 && (
            <div className="reply-sum">
              {replies.slice(-2).map((r) => (
                <div key={r.id} className="reply-line">
                  <strong>{c.shown(r.sender_name)}</strong>
                  <span>{plain(r.body).slice(0, 80)}</span>
                  <time>{clock(r.created_at)}</time>
                </div>
              ))}
              <button className="reply-open" onClick={() => onOpen(m.thread_id)}>
                <MessageSquare size={13} />
                Open thread · {replies.length} {replies.length === 1 ? "reply" : "replies"}
              </button>
            </div>
          )}
        </ChatMessage>
        {m.attachments.length > 0 && <Attachments files={m.attachments} />}
      </div>
    </div>
  );
}

// A channel, a direct message or a group chat: one running feed with the message box underneath.
export default function Feed({
  scope, // { kind: "channel" | "dm" | "thread", title, subtitle, key }
  messages, // oldest first
  me,
  agents,
  agentOf,
  shown,
  canWrite,
  canDelete,
  pinnedThreads,
  onPin,
  onSend,
  onProfile,
  onMenu,
  onDeleteThread,
  callActive,
  onStartCall,
  onLeaveCall,
  api,
  firstMessageId,
  disabledReason,
  history,
  searchTick,
}) {
  const scroller = useRef(null),
    panel = useRef(null),
    search = useRef(null),
    [side, setSide] = useState(true),
    [tab, setTab] = useState("messages"),
    [open, setOpen] = useState(null), // thread open in the side panel
    [sideW, setSideW, resetSideW] = useSize("side", 260, 200, 480),
    [threadW, setThreadW, resetThreadW] = useSize("thread", 340, 260, 560),
    [callH, setCallH, resetCallH] = useSize("callh", 440, 220, 800),
    [find, setFind] = useState(""),
    [inCall, setInCall] = useState([]),
    [tx, setTx] = useState(false), // transcript panel
    [txLines, setTxLines] = useState([]),
    [capOn, setCapOn] = useState(false),
    [heard, setHeard] = useState(""),
    [capErr, setCapErr] = useState(""),
    [capStatus, setCapStatus] = useState(""),
    [chimeIn, setChimeIn] = useState(false),
    [fast, setFast] = useState(() => quickVoice());

  useEffect(() => {
    const on = (e) => {
      setCapOn(!!e.detail.on);
      if (e.detail.status !== undefined) setCapStatus(e.detail.status);
      if (e.detail.error) setCapErr(e.detail.error);
      else if (e.detail.heard !== undefined || !e.detail.on) setCapErr("");
      if (!e.detail.on) setHeard("");
      else if (e.detail.heard !== undefined)
        setHeard(e.detail.final ? "" : e.detail.heard);
    };
    window.addEventListener("dispatch:captions", on);
    return () => window.removeEventListener("dispatch:captions", on);
  }, []);
  useEffect(() => {
    if (!tx || !firstMessageId || !api) return;
    let live = true,
      after = 0;
    setTxLines([]);
    const poll = () =>
      api(`calls/transcript?message_id=${firstMessageId}&after=${after}`)
        .then((r) => {
          if (!live) return;
          after = r.next_seq;
          setChimeIn(!!r.chime_in);
          if (r.lines.length)
            setTxLines((l) => [...l, ...r.lines].slice(-200));
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [tx, firstMessageId, scope.key]);
  useEffect(() => {
    if (!searchTick) return;
    setSide(true);
    setTimeout(() => search.current?.focus(), 50);
  }, [searchTick]);
  useEffect(() => {
    setFind("");
    setOpen(null);
    setTab("messages");
  }, [scope.kind, scope.key]);

  // Who is in this feed's call right now (until you join it yourself).
  useEffect(() => {
    if (callActive || !firstMessageId || !api) return;
    let live = true;
    const look = () =>
      api("calls/status?message_id=" + firstMessageId)
        .then((r) => live && setInCall(r.people))
        .catch(() => {});
    look();
    const t = setInterval(look, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [callActive, firstMessageId]);

  const q = find.trim().toLowerCase(),
    has = (...t) => t.some((x) => String(x || "").toLowerCase().includes(q)),
    hit = (m) =>
      has(m.body, m.subject, shown(m.sender_name), ...m.attachments.map((f) => f.filename)),
    threaded = scope.kind === "channel",
    byThread = new Map();
  for (const m of messages) {
    const list = byThread.get(m.thread_id) || [];
    list.push(m);
    byThread.set(m.thread_id, list);
  }
  const matching = q ? messages.filter(hit) : messages,
    // A channel lists each conversation once, as its first message with the replies folded under it.
    visible = threaded
      ? [...byThread.values()]
          .filter((list) => !q || list.some(hit))
          .map((list) => list[0])
          .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      : matching,
    people = scope.kind === "channel"
      ? agents.map((x) => x.name)
      : [
          ...new Set(
            messages.flatMap((m) => [m.sender_name, ...m.recipients.map((r) => r.name)]),
          ),
        ],
    allFiles = messages.flatMap((m) =>
      m.attachments.map((f) => ({ ...f, from: m.sender_name })),
    ),
    openList = open ? byThread.get(open) || [] : [];

  // Stay at the bottom while new messages arrive, unless you scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (near || el.dataset.fresh !== "1") {
      el.scrollTop = el.scrollHeight;
      el.dataset.fresh = "1";
    }
  }, [visible.length, scope.key, tab]);
  useEffect(() => {
    if (scroller.current) scroller.current.dataset.fresh = "";
  }, [scope.kind, scope.key]);
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = panel.current.scrollHeight;
  }, [openList.length, open]);

  const who = agents
    .filter((a) => a.name !== me)
    .map((a) => ({ name: a.name, label: shown(a.name), agent: a.program !== "human" }));
  const ctx = {
    me,
    agentOf,
    shown,
    onProfile,
    onMenu,
    canDelete,
    pinnedThreads,
    onPin,
    onDeleteThread,
  };

  return (
    <div className="feed-layout flex h-full min-w-0 flex-1">
      <div className="feed-main flex min-w-0 flex-1 flex-col" style={{ "--call-h": callH + "px" }}>
        <header className="feed-head">
          <div className="feed-title">
            <div className="feed-line">
              {scope.kind === "channel" ? (
                <Hash size={18} className="head-icon" />
              ) : scope.lead ? (
                scope.lead
              ) : (
                <Users size={18} className="head-icon" />
              )}
              <h1 title={scope.title}>{scope.title}</h1>
              {scope.subtitle && <span className="feed-topic">{scope.subtitle}</span>}
            </div>
          </div>
          <div className="head-actions">
            <Tooltip
              content={callActive ? "Leave call" : inCall.length ? "Join the voice call" : "Start a voice call"}
              side="bottom"
            >
              <button
                className={
                  "head-btn" +
                  (callActive ? " active" : "") +
                  (inCall.length && !callActive ? " live" : "")
                }
                aria-pressed={callActive}
                aria-label={callActive ? "Leave call" : "Join the voice call"}
                disabled={!firstMessageId}
                onClick={() => (callActive ? onLeaveCall() : onStartCall(false))}
              >
                <Phone size={19} />
                {inCall.length > 0 && !callActive && (
                  <span className="live-dot">{inCall.length}</span>
                )}
              </button>
            </Tooltip>
            <Tooltip content={tx ? "Hide transcript" : "Call transcript"} side="bottom">
              <button
                className={"head-btn" + (tx ? " active" : "")}
                aria-pressed={tx}
                aria-label="Call transcript"
                onClick={() => setTx(!tx)}
              >
                <Captions size={19} />
              </button>
            </Tooltip>
            <Tooltip content={side ? "Hide members" : "Show members"} side="bottom">
              <button
                className={"head-btn count" + (side ? " active" : "")}
                aria-pressed={side}
                aria-label="Show members and files"
                onClick={() => setSide(!side)}
              >
                <Users size={18} />
                <span>{people.length}</span>
              </button>
            </Tooltip>
          </div>
        </header>

        {inCall.length > 0 && !callActive && (
          <div className="call-preview" role="status">
            <div className="in-call">
              {inCall.slice(0, 4).map((p) =>
                p.agent ? (
                  <AgentAvatar
                    key={p.id}
                    className="avatar"
                    name={p.name}
                    program={agentOf(p.name)?.program}
                    model={agentOf(p.name)?.model}
                  />
                ) : (
                  <UserAvatar key={p.id} id={p.uid} name={p.name} v={p.avatar_v} size={38} />
                ),
              )}
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
              <button className="join-btn" aria-label="Join call" onClick={() => onStartCall(false)}>
                <Phone size={18} />
                Join
              </button>
            </div>
          </div>
        )}
        {callActive && <div id="call-slot" className="call-slot" />}
        {callActive && (
          <Resizer
            axis="y"
            size={callH}
            onChange={setCallH}
            onReset={resetCallH}
            label="Resize the call"
          />
        )}

        {tab === "files" ? (
          <div className="feed-scroll" ref={scroller}>
            {allFiles.length ? (
              <div className="files-tab">
                {allFiles.map((f) => (
                  <div key={f.id} className="files-item">
                    <Attachments files={[f]} />
                    <span>
                      {shown(f.from)} · {bytes(f.size)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="chat-empty">No files shared here yet.</p>
            )}
          </div>
        ) : (
          <div className="feed-scroll" ref={scroller}>
            {!visible.length && q && <p className="chat-empty">No messages match “{find}”.</p>}
            {visible.map((m, i) => {
              const prev = visible[i - 1],
                newDay = !prev || day(prev.created_at) !== day(m.created_at),
                replies = threaded ? (byThread.get(m.thread_id) || []).slice(1) : [];
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="day-rule">
                      <span>{day(m.created_at)}</span>
                    </div>
                  )}
                  <Row m={m} c={ctx} replies={replies} onOpen={threaded ? setOpen : null} />
                </div>
              );
            })}
          </div>
        )}

        {canWrite ? (
          <Box
            placeholder={scope.kind === "channel" ? `Message #${scope.title}` : `Message ${scope.title}`}
            history={history}
            label="body"
            people={who}
            onSend={(x) => onSend({ ...x, reply: null })}
          />
        ) : (
          <div className="feed-input muted small">{disabledReason || "You can read this conversation."}</div>
        )}
      </div>

      {tx && (
        <aside className="thread-panel transcript-panel" style={{ width: threadW }}>
          <header>
            <strong>Transcript</strong>
            <span className="muted small">What is said in the call</span>
            <button className="head-btn" aria-label="Close transcript" onClick={() => setTx(false)}>
              <X size={17} />
            </button>
          </header>
          <div className="tx-mic">
            <button
              className={"tx-toggle" + (capOn ? " on" : "")}
              disabled={!callActive}
              onClick={() => window.dispatchEvent(new CustomEvent("dispatch:captions-toggle"))}
            >
              <Mic size={14} />
              {capOn ? "Sharing your voice" : "Share my voice"}
            </button>
            <span className="muted small">
              {!callActive
                ? "Join the call to share your voice."
                : capOn
                  ? "Your speech is turned into text for the call and its agents."
                  : "Off. Nobody gets your words as text."}
            </span>
            {capOn && (
              <div className="tx-heard">
                <i /> {capStatus || heard || "Listening…"}
              </div>
            )}
            {capOn && capErr && <div className="tx-error">{capErr}</div>}
          </div>
          <div className="tx-chime">
            <label>
              <input
                type="checkbox"
                checked={chimeIn}
                onChange={(e) => {
                  setChimeIn(e.target.checked);
                  api("calls/chime", { message_id: firstMessageId, on: e.target.checked }).catch(() =>
                    setChimeIn(!e.target.checked),
                  );
                }}
              />
              <span className="track" />
              Agents can speak up on their own
            </label>
            <span className="muted small">
              {chimeIn
                ? "Agents in the call may join in when they have something useful to add."
                : "Agents only answer when someone talks to them."}
            </span>
          </div>
          <div className="tx-chime">
            <label>
              <input
                type="checkbox"
                checked={fast}
                onChange={(e) => {
                  setFast(e.target.checked);
                  setQuickVoice(e.target.checked);
                }}
              />
              <span className="track" />
              Quick voice for agents
            </label>
            <span className="muted small">
              {fast
                ? "Agents speak at once with your browser's own voice."
                : "A more natural voice that takes a moment to make each sentence."}
            </span>
          </div>
          <div className="thread-scroll tx-lines">
            {txLines.filter((l) => l.kind === "say").map((l) => (
              <div key={l.seq} className={"tx-line" + (l.agent ? " agent" : "")}>
                <strong>{l.name}</strong>
                <time>{clock(l.at)}</time>
                <p>{l.text}</p>
              </div>
            ))}
            {!txLines.some((l) => l.kind === "say") && (
              <p className="muted small tx-empty">Nothing has been said yet.</p>
            )}
          </div>
        </aside>
      )}
      {open && openList.length > 0 && (
        <>
          <Resizer size={threadW} grow={-1} onChange={setThreadW} onReset={resetThreadW} label="Resize the thread" />
          <aside className="thread-panel" style={{ width: threadW }}>
            <header>
              <strong>Thread</strong>
              <span className="muted small">{root(openList[0].subject)}</span>
              <button className="head-btn" aria-label="Close thread" onClick={() => setOpen(null)}>
                <X size={17} />
              </button>
            </header>
            <div className="thread-scroll" ref={panel}>
              {openList.map((m) => (
                <Row key={m.id} m={m} c={ctx} />
              ))}
            </div>
            {canWrite && (
              <Box
                placeholder="Reply in thread…"
                history={history}
                people={who}
                onSend={(x) =>
                  onSend({ ...x, reply: { thread_id: open, subject: root(openList[0].subject) } })
                }
              />
            )}
          </aside>
        </>
      )}
      {side && (
        <>
          <Resizer size={sideW} grow={-1} onChange={setSideW} onReset={resetSideW} label="Resize the member list" />
          <MembersPanel
            people={people}
            files={[]}
            me={me}
            agentOf={agentOf}
            shown={shown}
            onProfile={onProfile}
            onMenu={onMenu}
            width={sideW}
            find={find}
            onFind={setFind}
            searchRef={search}
            count={`${matching.length}/${messages.length}`}
          />
        </>
      )}
    </div>
  );
}
