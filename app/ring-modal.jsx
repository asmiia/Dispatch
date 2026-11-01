"use client";
import { Phone, PhoneOff } from "lucide-react";
import UserAvatar from "./user-avatar";

// Shown while a call is ringing for you: join it or decline.
export default function RingModal({ call, onJoin, onDecline }) {
  if (!call) return null;
  const who = call.people.filter((p) => !p.agent);
  return (
    <div className="modal-backdrop ring-backdrop" role="alertdialog" aria-label="Incoming call">
      <div className="modal ring-modal">
        <div className="ring-faces">
          {who.slice(0, 3).map((p) => (
            <UserAvatar key={p.id} id={p.uid} name={p.name} v={p.avatar_v} size={72} />
          ))}
        </div>
        <span className="ring-kind">{call.ringing?.length ? "Calling you" : "Incoming call"}</span>
        <strong>{call.names}</strong>
        <small>{call.subject}</small>
        <div className="ring-actions">
          <button className="ring-decline" onClick={onDecline} aria-label="Decline">
            <PhoneOff size={18} /> Decline
          </button>
          <button className="ring-join" onClick={onJoin} aria-label="Join the call">
            <Phone size={18} /> Join
          </button>
        </div>
      </div>
    </div>
  );
}
