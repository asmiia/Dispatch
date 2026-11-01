"use client";
import { useState } from "react";
import { Check, Filter, MessageSquare, MoreHorizontal, Search, SlidersHorizontal } from "lucide-react";

export const TABS = [
  ["all", "All"],
  ["unread", "Unread"],
  ["mentions", "Mentions"],
  ["replies", "Replies"],
  ["files", "Files"],
  ["pinned", "Pinned"],
];
export const keep = {
  all: () => true,
  unread: (i) => i.unread,
  mentions: (i) => i.mention,
  replies: (i) => i.replied,
  files: (i) => i.files,
  pinned: (i) => i.pinned,
};

// Everything addressed to you, newest first, with what is still unread on top of the list.
export function InboxList({ items, tab, onTab }) {
  return (
    <aside className="spaces">
      <header>
        <strong className="space-switch">Inbox</strong>
      </header>
      <div className="spaces-scroll">
        <div className="space-title">
          <span>Filter</span>
        </div>
        {[["all", "All"], ...TABS.filter(([id]) => id !== "all")].map(([id, label]) => {
          const n = items.filter(keep[id]).length;
          return (
            <button
              key={id}
              className={"space-row" + (tab === id ? " on" : "")}
              onClick={() => onTab(id)}
            >
              <span className="space-label">{label}</span>
              {n > 0 && <span className="space-count">{n}</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default function InboxPage({ teamName, items, tab, onTab: setTab, onOpen, onRead, onReadAll, onMenu }) {
  const [unreadOnly, setUnreadOnly] = useState(false),
    [q, setQ] = useState(""),
    [open, setOpen] = useState(false),
    [from, setFrom] = useState("any"),
    [where, setWhere] = useState("any");
  const shown = items.filter(
    (i) =>
      keep[tab](i) &&
      (!unreadOnly || i.unread) &&
      (from === "any" || (from === "agents") === i.fromAgent) &&
      (where === "any" || (where === "channel") === i.channel) &&
      `${i.title} ${i.body} ${i.where}`.toLowerCase().includes(q.toLowerCase()),
  );
  const filtered = from !== "any" || where !== "any";
  const unread = shown.filter((i) => i.unread);
  return (
    <div className="inbox-page">
      <div className="inbox-wrap">
        <span className="inbox-org">{teamName}</span>
        <h1>Inbox</h1>
        <p className="muted">Your conversations, decisions, and updates in one place.</p>
        <div className="inbox-bar">
          <span className="inbox-which">{(TABS.find(([id]) => id === tab) || [0, "All"])[1]}</span>
          <label className="inbox-switch">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            <span className="track" />
            Unread only
          </label>
        </div>
        <div className="inbox-tools">
          <label className="inbox-find">
            <Search size={14} />
            <input
              placeholder="Search your inbox"
              aria-label="Search your inbox"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="inbox-filter">
            <button
              className={filtered ? "on" : ""}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <SlidersHorizontal size={14} />
              Filters{filtered ? " · on" : ""}
            </button>
            {open && (
              <div className="inbox-pop">
                <span>From</span>
                {[["any", "Anyone"], ["people", "People"], ["agents", "Agents"]].map(([v, l]) => (
                  <button key={v} className={from === v ? "on" : ""} onClick={() => setFrom(v)}>
                    {l}
                  </button>
                ))}
                <span>Where</span>
                {[["any", "Anywhere"], ["channel", "Channels"], ["direct", "Direct messages"]].map(([v, l]) => (
                  <button key={v} className={where === v ? "on" : ""} onClick={() => setWhere(v)}>
                    {l}
                  </button>
                ))}
                {filtered && (
                  <button
                    onClick={() => {
                      setFrom("any");
                      setWhere("any");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="inbox-head">
          <span>Updates</span>
          {unread.length > 0 && (
            <button className="inbox-readall" onClick={() => onReadAll(unread)}>
              Mark {unread.length} {unread.length === 1 ? "item" : "items"} as read
            </button>
          )}
        </div>
        <div className="inbox-list">
          {shown.map((i, n) => (
            <div key={i.key}>
              {(n === 0 || shown[n - 1].today !== i.today) && (
                <div className="inbox-group">{i.today ? "Today" : "Earlier"}</div>
              )}
            <div
              className={"inbox-row" + (i.unread ? " unread" : "")}
              onClick={() => onOpen(i)}
              onContextMenu={(e) => onMenu(e, i)}
            >
              <span className="inbox-dot" />
              <span className="inbox-icon">
                <MessageSquare size={15} />
              </span>
              <div className="inbox-text">
                <strong>{i.title}</strong>
                <p>{i.body}</p>
                <span>
                  {i.where} <i>·</i> {i.date}
                </span>
              </div>
              <div className="inbox-actions" onClick={(e) => e.stopPropagation()}>
                {i.unread && (
                  <button onClick={() => onRead(i)}>
                    <Check size={14} />
                    Mark as read
                  </button>
                )}
                <button aria-label="More" onClick={(e) => onMenu(e, i)}>
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </div>
            </div>
          ))}
          {!shown.length && (
            <div className="inbox-empty">
              <Filter size={22} />
              <strong>Nothing here</strong>
              <span>{unreadOnly ? "You are all caught up." : "New updates for you show up here."}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
