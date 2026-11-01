"use client";
import { useState } from "react";
import { Copy, MessageSquare, X } from "lucide-react";
import AgentAvatar, { photoOf } from "./agent-avatar";
import { gradientFor } from "./gradient";

const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const day = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "none";

// A profile for a person, an agent or a conversation, built from what the project already holds.
export default function Profile({
  target,
  messages,
  agents,
  agentOf,
  shown,
  onClose,
  onOpen,
  onMessage,
  onProfile,
}) {
  const [tab, setTab] = useState("activity"),
    [note, setNote] = useState(() => {
      try {
        return localStorage.getItem("dispatch-note-" + target.key) || "";
      } catch {
        return "";
      }
    });
  const saveNote = (v) => {
    try {
      localStorage.setItem("dispatch-note-" + target.key, v);
    } catch {}
  };
  let rich = null;
  const stat = (value, label) => (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
  let hero, stats, sections, actions;

  if (target.kind === "thread") {
    const list = messages
        .filter((m) => m.thread_id === target.key)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      people = [
        ...new Set(
          list.flatMap((m) => [
            m.sender_name,
            ...m.recipients.map((r) => r.name),
          ]),
        ),
      ],
      files = list.flatMap((m) =>
        m.attachments.map((f) => ({ ...f, from: m.sender_name })),
      );
    const root = (list[0]?.subject || "Conversation").replace(
      /^((re|fwd?):\s*)+/i,
      "",
    );
    hero = (
      <>
        <span className="profile-thread-icon">
          <MessageSquare size={44} />
        </span>
        <h2>{root}</h2>
        <p>Started {day(list[0]?.created_at)}</p>
      </>
    );
    stats = [
      stat(list.length, "Messages"),
      stat(people.length, "People"),
      stat(files.length, "Files"),
      stat(ago(list.at(-1)?.created_at), "Last reply"),
    ];
    sections = [
      [
        "People",
        people.map((n) => {
          const a = agentOf(n);
          return (
            <button
              key={n}
              className="profile-row"
              onClick={() =>
                onProfile(a?.program === "human" ? "person" : "agent", n)
              }
            >
              <AgentAvatar
                className="avatar"
                name={n}
                photo={photoOf(a)}
                program={a?.program}
                model={a?.model}
              />
              <span>
                <strong>{shown(n)}</strong>
                <em>
                  {a?.program === "human" ? "Person" : `${a?.program || ""}`}
                </em>
              </span>
            </button>
          );
        }),
      ],
      files.length && [
        "Files",
        files.map((f) => (
          <a
            key={f.id}
            className="profile-row"
            href={f.download_url}
            download={f.filename}
          >
            <span>
              <strong>{f.filename}</strong>
              <em>from {shown(f.from)}</em>
            </span>
          </a>
        )),
      ],
    ];
    actions = list.length && (
      <button className="primary" onClick={() => onOpen(list.at(-1))}>
        Open conversation
      </button>
    );
  } else {
    const name = target.key,
      a = agentOf(name),
      human = a?.program === "human",
      sent = messages.filter((m) => m.sender_name === name),
      got = messages.filter((m) => m.recipients.some((r) => r.name === name)),
      threads = new Set([...sent, ...got].map((m) => m.thread_id)),
      files = sent.reduce((n, m) => n + m.attachments.length, 0),
      owned = human
        ? agents.filter(
            (x) => x.program !== "human" && x.owner_id === a.owner_id,
          )
        : [],
      latest = [...sent, ...got].sort((x, y) =>
        y.created_at.localeCompare(x.created_at),
      );
    const recent = [];
    for (const m of latest)
      if (!recent.some((r) => r.thread_id === m.thread_id)) recent.push(m);
    hero = (
      <>
        <AgentAvatar
          className="avatar profile-avatar"
          name={name}
          photo={photoOf(a)}
          program={a?.program}
          model={a?.model}
        />
        <h2>{shown(name)}</h2>
        <p>
          {human
            ? "Person"
            : `${a?.program || "agent"} · ${a?.model || "unknown"}`}
          {!human && a?.owner_name && ` · owned by ${a.owner_name}`}
        </p>
      </>
    );
    stats = [
      stat(sent.length, "Sent"),
      stat(got.length, "Received"),
      stat(threads.size, "Conversations"),
      stat(files, "Files shared"),
      stat(ago(a?.last_active || latest[0]?.created_at), "Last active"),
    ];
    sections = [
      owned.length && [
        "Agents",
        owned.map((x) => (
          <button
            key={x.id}
            className="profile-row"
            onClick={() => onProfile("agent", x.name)}
          >
            <AgentAvatar
              className="avatar"
              name={x.name}
              program={x.program}
              model={x.model}
            />
            <span>
              <strong>{x.name}</strong>
              <em>
                {x.program} · {x.model}
              </em>
            </span>
          </button>
        )),
      ],
      [
        "Recent conversations",
        recent.length ? (
          recent.slice(0, 6).map((m) => (
            <button
              key={m.thread_id}
              className="profile-row"
              onClick={() => onOpen(m)}
            >
              <span>
                <strong>{m.subject.replace(/^((re|fwd?):\s*)+/i, "")}</strong>
                <em>{ago(m.created_at)}</em>
              </span>
            </button>
          ))
        ) : (
          <p className="muted small">Nothing yet.</p>
        ),
      ],
    ];
    const first = [...sent, ...got].sort((x, y) =>
        x.created_at.localeCompare(y.created_at),
      )[0],
      shared = sent.flatMap((m) =>
        m.attachments.map((f) => ({ ...f, at: m.created_at })),
      ),
      last = a?.last_active || latest[0]?.created_at;
    const tabs = [
      ["activity", "Activity"],
      [human ? "agents" : "people", human ? `Agents · ${owned.length}` : "Talks with"],
      ["files", `Files · ${shared.length}`],
    ];
    const talkers = [
      ...new Set(
        [
          ...sent.flatMap((m) => m.recipients.map((r) => r.name)),
          ...got.map((m) => m.sender_name),
        ].filter((n) => n !== name),
      ),
    ];
    const rowFor = (n) => {
      const x = agentOf(n);
      return (
        <button
          key={n}
          className="profile-row"
          onClick={() =>
            onProfile(x?.program === "human" ? "person" : "agent", n)
          }
        >
          <AgentAvatar
            className="avatar"
            name={n}
            photo={photoOf(x)}
            program={x?.program}
            model={x?.model}
          />
          <span>
            <strong>{shown(n)}</strong>
            <em>
              {x?.program === "human"
                ? { online: "Online", idle: "Idle", dnd: "Do not disturb" }[x?.status] || "Offline"
                : `${x?.program || ""} · ${x?.model || ""}`}
            </em>
          </span>
        </button>
      );
    };
    rich = (
      <div className="profile2" role="dialog" aria-label="Profile">
        <button
          className="icon-button profile-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={17} />
        </button>
        <aside className="p2-card">
          <div className="p2-banner" style={{ background: gradientFor(name) }} />
          <span className={"p2-avatar" + (a?.online ? " s-" + a.status : "")}>
            <AgentAvatar
              className="avatar"
              name={name}
              photo={photoOf(a)}
              program={a?.program}
              model={a?.model}
            />
          </span>
          <h2>{shown(name)}</h2>
          <p className="p2-sub">
            {human ? "Person" : `${a?.program || "agent"} · ${a?.model || "unknown"}`}
            <span className={"p2-status" + (a?.online ? " s-" + a.status : "")}>
              <i />
              {{ online: "Online", idle: "Idle", dnd: "Do not disturb" }[a?.status] || "Offline"}
            </span>
          </p>
          <div className="p2-actions">
            {human && (
              <button className="primary" onClick={() => onMessage(name)}>
                <MessageSquare size={14} />
                Message
              </button>
            )}
            <button
              className="subtle-button"
              onClick={() => navigator.clipboard.writeText(name)}
            >
              <Copy size={14} />
              Copy name
            </button>
          </div>
          <dl>
            <dt>Last active</dt>
            <dd>{ago(last)}</dd>
            <dt>In this channel since</dt>
            <dd>{day(first?.created_at)}</dd>
            {!human && a?.owner_name && (
              <>
                <dt>Owned by</dt>
                <dd>{a.owner_name}</dd>
              </>
            )}
            <dt>Messages</dt>
            <dd>
              {sent.length} sent · {got.length} received
            </dd>
            <dt>Note (only you see this)</dt>
            <dd>
              <textarea
                className="p2-note"
                rows={2}
                placeholder="Click to add a note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => saveNote(note)}
              />
            </dd>
          </dl>
        </aside>
        <section className="p2-main">
          <div className="feed-tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "on" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="p2-body">
            {tab === "activity" &&
              (recent.length ? (
                <>
                  <h3>Recent conversations</h3>
                  {recent.slice(0, 8).map((m) => (
                    <button
                      key={m.thread_id}
                      className="profile-row"
                      onClick={() => onOpen(m)}
                    >
                      <span>
                        <strong>
                          {m.subject.replace(/^((re|fwd?):\s*)+/i, "")}
                        </strong>
                        <em>
                          {shown(m.sender_name)} · {ago(m.created_at)}
                        </em>
                      </span>
                    </button>
                  ))}
                </>
              ) : (
                <p className="muted">No activity yet.</p>
              ))}
            {tab === "agents" &&
              (owned.length ? (
                owned.map((x) => rowFor(x.name))
              ) : (
                <p className="muted">No agents.</p>
              ))}
            {tab === "people" &&
              (talkers.length ? (
                talkers.map(rowFor)
              ) : (
                <p className="muted">Nobody yet.</p>
              ))}
            {tab === "files" &&
              (shared.length ? (
                shared.map((f) => (
                  <a
                    key={f.id}
                    className="profile-row"
                    href={f.download_url}
                    download={f.filename}
                  >
                    <span>
                      <strong>{f.filename}</strong>
                      <em>{ago(f.at)}</em>
                    </span>
                  </a>
                ))
              ) : (
                <p className="muted">No files shared.</p>
              ))}
          </div>
        </section>
      </div>
    );
    actions = (
      <>
        <button className="primary" onClick={() => onMessage(name)}>
          <MessageSquare size={14} />
          Message
        </button>
        <button
          className="subtle-button"
          onClick={() => navigator.clipboard.writeText(name)}
        >
          <Copy size={14} />
          Copy name
        </button>
      </>
    );
  }
  if (rich)
    return (
      <div
        className="modal-backdrop"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {rich}
      </div>
    );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="profile" role="dialog" aria-label="Profile">
        <button
          className="icon-button profile-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={17} />
        </button>
        <div className="profile-hero">{hero}</div>
        <div className="profile-stats">{stats}</div>
        {actions && <div className="profile-actions">{actions}</div>}
        {sections.filter(Boolean).map(([title, body]) => (
          <section key={title}>
            <h3>{title}</h3>
            <div className="profile-list">{body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
