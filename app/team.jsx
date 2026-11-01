"use client";
import { useState } from "react";
import {
  Download,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileText,
  FileVideo,
  MessageSquare,
  Search,
  UserRound,
} from "lucide-react";
import AgentAvatar, { photoOf } from "./agent-avatar";

const split = (agents, q) => {
  const has = (a) =>
    `${a.name} ${a.owner_name || ""} ${a.program} ${a.model}`
      .toLowerCase()
      .includes(q.toLowerCase());
  const list = agents.filter(has);
  return {
    people: list.filter((a) => a.program === "human"),
    bots: list.filter((a) => a.program !== "human"),
  };
};
const byOnline = (list) => ({
  online: list.filter((a) => a.online),
  offline: list.filter((a) => !a.online),
});

const kind = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (/^(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(ext)) return ["image", null, "Image"];
  if (/^(mp4|mov|webm|mkv|avi)$/.test(ext)) return ["video", FileVideo, "Video"];
  if (/^(mp3|wav|ogg|m4a|flac)$/.test(ext)) return ["audio", FileAudio, "Audio"];
  if (/^(zip|rar|7z|tar|gz|tgz)$/.test(ext)) return ["archive", FileArchive, "Archive"];
  if (/^(js|jsx|ts|tsx|py|c|h|cpp|rs|go|java|json|css|html|sh|yml|yaml|toml)$/.test(ext))
    return ["code", FileCode, ext.toUpperCase()];
  if (/^(pdf|doc|docx|txt|md|csv|rtf|xls|xlsx|ppt|pptx)$/.test(ext))
    return ["doc", FileText, ext.toUpperCase()];
  return ["other", FileIcon, ext ? ext.toUpperCase() : "File"];
};
const sizeOf = (n) =>
  n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
const when = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })
    : "";

// A file as a file: a preview or a type icon, the name, and who shared it.
function FileCard({ f, shown }) {
  const [type, Icon, label] = kind(f.filename);
  return (
    <a className="file-tile" href={f.download_url} download={f.filename} title={f.filename}>
      <span className={"file-thumb t-" + type}>
        {type === "image" ? (
          <img src={`${f.download_url}?inline=1`} alt="" loading="lazy" />
        ) : (
          <>
            <Icon size={34} strokeWidth={1.5} />
            <em>{label}</em>
          </>
        )}
      </span>
      <span className="file-info">
        <strong>{f.filename}</strong>
        <span>
          {shown(f.from)} · {sizeOf(f.size)}
          {f.at ? " · " + when(f.at) : ""}
        </span>
      </span>
      <Download size={15} className="file-dl" />
    </a>
  );
}

function Face({ a, className }) {
  return (
    <span className={"face" + (a.status && a.status !== "offline" ? " s-" + a.status : "")}>
      <AgentAvatar
        name={a.name}
        photo={photoOf(a)}
        program={a.program}
        model={a.model}
        className={className}
      />
    </span>
  );
}

// The left column while the People icon is selected: everyone in the channel, online first.
export function TeamList({ agents, me, shown, q, onQ, onOpen }) {
  const { people, bots } = split(agents, q),
    { online, offline } = byOnline([...people, ...bots]);
  const row = (a) => (
    <button key={a.id} className={"space-row" + (a.online ? "" : " away")} onClick={() => onOpen(a)}>
      <span className="space-lead">
        <Face a={a} className="avatar nav-av" />
      </span>
      <span className="space-label">{shown(a.name)}</span>
    </button>
  );
  return (
    <aside className="spaces">
      <header>
        <strong className="space-switch">Team</strong>
      </header>
      <label className="head-search team-search">
        <Search size={14} />
        <input
          placeholder="Search people"
          aria-label="Search people"
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
      </label>
      <div className="spaces-scroll">
        {online.length > 0 && (
          <div className="space-title">
            <span>Online · {online.length}</span>
          </div>
        )}
        {online.map(row)}
        {offline.length > 0 && (
          <div className="space-title">
            <span>Offline · {offline.length}</span>
          </div>
        )}
        {offline.map(row)}
      </div>
    </aside>
  );
}

// The main area for the People icon: people and agents, online ones first.
export function TeamPage({ agents, me, shown, q, onProfile, onMessage, canWrite, teamName, files = [], onConnect, onInvite, canManage }) {
  const [tab, setTab] = useState("people"),
    { people, bots } = split(agents, q),
    list = tab === "people" ? people : bots,
    { online, offline } = byOnline(list);
  const card = (a) => (
    <div className={"team-card" + (a.online ? "" : " away")} key={a.id}>
      <Face a={a} className="avatar" />
      <div className="team-meta">
        <strong>
          {shown(a.name)}
        </strong>
        <span>
          {a.program === "human"
            ? { online: "Online", idle: "Idle", dnd: "Do not disturb", offline: "Offline" }[a.status || "offline"]
            : `${a.program} · ${a.model}${a.owner_name ? " · " + a.owner_name : ""}`}
        </span>
      </div>
      <div className="team-actions">
        <button
          className="subtle-button"
          onClick={() => onProfile(a.program === "human" ? "person" : "agent", a.name)}
        >
          <UserRound size={14} />
          Profile
        </button>
        {a.program === "human" && a.name !== me && canWrite && (
          <button className="subtle-button" onClick={() => onMessage(a.name)}>
            <MessageSquare size={14} />
            Message
          </button>
        )}
      </div>
    </div>
  );
  return (
    <div className="team-page">
      <header className="feed-head">
        <div className="feed-title">
          <div className="feed-line">
            <h1>Team</h1>
          </div>
          <div className="feed-tabs" role="tablist">
            {[
              ["people", `People · ${people.length}`],
              ["agents", `Agents · ${bots.length}`],
              ["files", `Files · ${files.length}`],
            ].map(([id, label]) => (
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
        </div>
        <div className="head-actions team-head-actions">
          {canManage && (
            <button className="subtle-button" onClick={onInvite}>
              Invite people
            </button>
          )}
          <button className="primary small-primary" onClick={onConnect}>
            Connect an agent
          </button>
        </div>
      </header>
      {tab === "files" ? (
        <div className="team-body">
          <h2>Files</h2>
          <p className="muted">Everything shared in this channel.</p>
          <div className="file-grid">
            {files.map((f) => (
              <FileCard key={f.id} f={f} shown={shown} />
            ))}
            {!files.length && <p className="muted">No files yet.</p>}
          </div>
        </div>
      ) : (
        <div className="team-body">
          <h2>{tab === "people" ? "People" : "Agents"}</h2>
          <p className="muted">
            {tab === "people"
              ? "Everyone who can read and write in this channel."
              : "Agents connected here. Mention one in a channel with @ to give it work."}
          </p>
          {online.length > 0 && (
            <>
              <h3 className="team-group">
                <i className="dot on" /> Online <span>{online.length}</span>
              </h3>
              <div className="team-grid">{online.map(card)}</div>
            </>
          )}
          {offline.length > 0 && (
            <>
              <h3 className="team-group">
                <i className="dot" /> Offline <span>{offline.length}</span>
              </h3>
              <div className="team-grid">{offline.map(card)}</div>
            </>
          )}
          {!list.length && (
            <p className="muted">
              {tab === "agents"
                ? "No agents yet. Use Connect an agent to add one."
                : "Nobody matches."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
