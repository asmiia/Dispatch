"use client";
import { Copy, Download, FileText, Phone, Search, UserRound } from "lucide-react";
import AgentAvatar, { photoOf } from "./agent-avatar";
import Fluid from "./fluid";

const bytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

// The member list on the right: people, with the agents they own underneath, then the files shared here.
export default function MembersPanel({
  people,
  files,
  me,
  agentOf,
  shown,
  onProfile,
  onMenu,
  onRing,
  width,
  find,
  onFind,
  searchRef,
  count,
}) {
  const owners = [
    ...people
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
  ];
  return (
    <aside className="chat-side slim" style={width ? { width } : undefined}>
      {onFind && (
        <div className="side-find">
        <label className="head-search side-search">
          <Search size={14} />
          <input
            ref={searchRef}
            aria-label="Search this conversation"
            placeholder="Search messages"
            value={find}
            onChange={(e) => onFind(e.target.value)}
          />
          {find && <span className="side-count">{count}</span>}
        </label>
        </div>
      )}
      <div className="side-section">Members — {people.length}</div>
      <Fluid className="side-list" item=".side-member">
        {owners.map(([owner, { person, agents: owned, photo }]) => (
          <div className="side-group" key={owner}>
            <div
              className="side-member side-person"
              onClick={() =>
                onProfile(person ? "person" : "agent", person?.name || owner)
              }
              onContextMenu={(e) =>
                onMenu(e, [
                  ...(onRing && person && person.name !== me
                    ? [{ label: "Ring", icon: <Phone size={14} />, onClick: () => onRing({ uid: person.a.owner_id }) }]
                    : []),
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
                    onClick: () => navigator.clipboard.writeText(owner),
                  },
                ])
              }
            >
              <span className={"face" + (person?.a?.online ? " s-" + person.a.status : "")}>
                <AgentAvatar
                className="avatar"
                name={person?.name || owner}
                photo={photo}
                program={person ? "human" : undefined}
              />
              </span>
              <div>
                <strong>
                  {owner}
                  
                </strong>
                <span>
                  {owned.length
                    ? `${owned.length} ${owned.length === 1 ? "agent" : "agents"}`
                    : "Person"}
                  {person ? " · " + ({ online: "Online", idle: "Idle", dnd: "Do not disturb" }[person.a?.status] || "Offline") : ""}
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
                        ...(onRing
                          ? [{ label: "Ring", icon: <Phone size={14} />, onClick: () => onRing({ agent: name }) }]
                          : []),
                        {
                          label: "View profile",
                          icon: <UserRound size={14} />,
                          onClick: () => onProfile("agent", name),
                        },
                        {
                          label: "Copy name",
                          icon: <Copy size={14} />,
                          onClick: () => navigator.clipboard.writeText(name),
                        },
                      ])
                    }
                  >
                    <span className={"face" + (a?.online ? " s-" + a.status : "")}>
                      <AgentAvatar
                      className="avatar"
                      name={name}
                      program={a?.program}
                      model={a?.model}
                    />
                    </span>
                    <div>
                      <strong>{name}</strong>
                      <span>
                        {a ? `${a.program} · ${a.model}` : ""}
                        {a && !a.online ? " · Offline" : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Fluid>
      {files.length > 0 && (
        <>
          <div className="side-section">Files — {files.length}</div>
          <div className="side-list">
            {files.map((f) => (
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
  );
}
