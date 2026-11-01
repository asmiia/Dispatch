"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Hash,
  Inbox,
  MessageSquare,
  Moon,
  MonitorDown,
  Plus,
  Settings,
  Terminal,
  Users,
} from "lucide-react";

// The narrow icon column on the far left.
export function NavRail({ logo, unread, view, section, onInbox, onChats, onPeople, avatar, onProfile }) {
  const Btn = ({ icon: Icon, label, on, onClick, dot }) => (
    <button
      className={"rail-btn" + (on ? " on" : "")}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon size={19} />
      {dot > 0 && <span className="rail-dot" />}
    </button>
  );
  return (
    <nav className="nav-rail" aria-label="Main">
      <span className="rail-logo" title="Dispatch">
        {logo}
      </span>
      <Btn
        icon={Inbox}
        label={unread ? `Inbox, ${unread} unread` : "Inbox"}
        on={section === "inbox"}
        onClick={onInbox}
        dot={unread}
      />
      <Btn icon={MessageSquare} label="Chats" on={section === "chats"} onClick={onChats} />
      <Btn icon={Users} label="People" on={section === "people"} onClick={onPeople} />
      <span className="rail-grow" />
    </nav>
  );
}

function Entry({ e, onOpen }) {
  return (
    <button
      className={"space-row" + (e.selected ? " on" : "") + (e.unread ? " unread" : "")}
      onClick={() => onOpen(e)}
      onContextMenu={e.onContextMenu}
    >
      <span className="space-lead">{e.lead}</span>
      <span className="space-label">{e.label}</span>
      {e.unread && <span className="new-dot" />}
    </button>
  );
}

function Section({ title, items, onOpen, action, empty }) {
  const [shut, setShut] = useState(false);
  if (!items.length && !action && !empty) return null;
  return (
    <section className="space-section">
      <div className="space-title">
        <button onClick={() => setShut(!shut)} aria-expanded={!shut}>
          {title}
          <ChevronDown size={13} className={shut ? "shut" : ""} />
        </button>
        {action}
      </div>
      {!shut && items.map((e) => <Entry key={e.key} e={e} onOpen={onOpen} />)}
      {!shut && !items.length && empty && <p className="space-empty">{empty}</p>}
    </section>
  );
}

// The "Spaces" column: pinned conversations, channels, then recent chats.
export default function Spaces({
  title,
  teams,
  activeTeam,
  onTeam,
  onNewTeam,
  pinned,
  channels,
  recent,
  onOpen,
  onNewChannel,
  onNewMessage,
  canCreate,
  canWrite,
  onSettings,
  onTheme,
  callStrip,
}) {
  const [menu, setMenu] = useState(false),
    box = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => !box.current?.contains(e.target) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  return (
    <aside className="spaces">
      <header ref={box}>
        <button className="space-switch" onClick={() => setMenu(!menu)} aria-haspopup="menu">
          <strong>{title}</strong>
          <ChevronDown size={14} />
        </button>
        {menu && (
          <div className="space-menu" role="menu">
            {teams.map((t) => (
              <button
                key={t.id}
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onTeam(t.id);
                }}
              >
                {t.name}
                {t.id === activeTeam && <Check size={14} />}
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => {
                setMenu(false);
                onNewTeam();
              }}
            >
              <Plus size={14} /> Create or join a server
            </button>
          </div>
        )}
      </header>
      <div className="spaces-scroll">
        <Section title="Pinned" items={pinned} onOpen={onOpen} />
        <Section
          title="Recent"
          items={[...channels, ...recent]}
          onOpen={onOpen}
          empty="Channels, direct messages and group chats show up here."
          action={
            <span className="space-actions">
              {canCreate && (
                <button className="space-plus" aria-label="New channel" title="New channel" onClick={onNewChannel}>
                  <Hash size={14} />
                </button>
              )}
              <button
                className="space-plus"
                aria-label="New message"
                title="New message"
                disabled={!canWrite}
                onClick={onNewMessage}
              >
                <Plus size={15} />
              </button>
            </span>
          }
        />
      </div>
      {callStrip}
    </aside>
  );
}

export { Hash };

// Connect an agent and get the desktop app, kept at the foot of the left column.
export function QuickLinks({ onConnect, onDesktop, desktop }) {
  return (
    <div className="quick-links">
      <button onClick={onConnect}>
        <Terminal size={15} />
        Connect an agent
      </button>
      {!desktop && (
        <button onClick={onDesktop}>
          <MonitorDown size={15} />
          Get the desktop app
        </button>
      )}
    </div>
  );
}

// The signed-in person, along the bottom of both left columns.
export function MeCard({ me, onMe, onSettings, onTheme, compact, lead }) {
  return (
    <div className={"me-card" + (compact ? " compact" : "")}>
      <button className="me-id" onClick={onMe} title="Your profile">
        {lead ?? me.avatar}
        <span>
          <strong>{me.name}</strong>
          <em>{me.sub}</em>
        </span>
      </button>
      <button className="head-btn" aria-label="Appearance" title="Appearance" onClick={onTheme}>
        <Moon size={17} />
      </button>
      <button className="head-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
        <Settings size={17} />
      </button>
    </div>
  );
}
