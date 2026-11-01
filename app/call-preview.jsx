"use client";
import { useEffect, useState } from "react";
import { Bot, Phone, Video } from "lucide-react";
import AgentAvatar from "./agent-avatar";
import UserAvatar from "./user-avatar";
import { avatarTint, tintVars } from "./avatar-tint";
import { hueFor } from "./gradient";

// A call that is going on and that you are not in: the same tiles as the call itself, with a Join button.
export default function CallPreview({ people, agentOf, onJoin }) {
  const [tints, setTints] = useState({});
  useEffect(() => {
    for (const p of people) {
      if (!p.avatar_v || p.agent) continue;
      const key = p.uid + ":" + p.avatar_v;
      if (tints[key] !== undefined) continue;
      avatarTint(`/api/avatars/${p.uid}?v=${p.avatar_v}`).then((c) => setTints((t) => ({ ...t, [key]: c })));
    }
  }, [people]);
  return (
    <div className="call-preview big" role="status">
      <div className="cp-head">
        <span className="pulse" />
        <strong>Call in progress</strong>
        <em>{people.length} {people.length === 1 ? "person" : "people"}</em>
      </div>
      <div className="cp-tiles">
        {people.slice(0, 6).map((p) => (
          <div
            key={p.id}
            className="cp-tile"
            style={{ "--h": hueFor(p.name), ...tintVars(tints[p.uid + ":" + p.avatar_v]) }}
          >
            {p.agent ? (
              <span className="agent-face">
                <AgentAvatar className="avatar" name={p.name} program={agentOf?.(p.name)?.program} model={agentOf?.(p.name)?.model} />
              </span>
            ) : (
              <UserAvatar id={p.uid} name={p.name} v={p.avatar_v} size={72} />
            )}
            <span className="call-name">
              {p.agent && <Bot size={13} />}
              {p.name}
            </span>
          </div>
        ))}
      </div>
      <div className="cp-dock">
        <button className="join-btn video" aria-label="Join with video" onClick={() => onJoin(true)}>
          <Video size={18} /> Video
        </button>
        <button className="join-btn" aria-label="Join call" onClick={() => onJoin(false)}>
          <Phone size={18} /> Join
        </button>
      </div>
    </div>
  );
}
