"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const stat = [
  ["users", "Users"],
  ["teams", "Teams"],
  ["projects", "Projects"],
  ["messages", "Messages"],
  ["messages_24h", "Messages · 24h"],
  ["logins_24h", "Sign-ins · 24h"],
  ["failed_24h", "Failed sign-ins · 24h"],
  ["mfa_users", "Using 2FA"],
];

// Instance overview and sign-in history, for instance administrators only.
export default function Activity({ api }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("settings/activity")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!data) return <Loader2 className="spin" size={20} />;
  return (
    <>
      <h3>Activity</h3>
      <div className="stat-grid">
        {stat.map(([key, label]) => (
          <div
            key={key}
            className={"stat" + (key === "failed_24h" && data.stats[key] ? " warn" : "")}
          >
            <strong>{data.stats[key]}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <h4>Recent sign-ins</h4>
      <div className="settings-rows">
        {data.logins.length === 0 && <p className="muted">Nothing yet.</p>}
        {data.logins.map((l) => (
          <div className="settings-row" key={l.id}>
            <div>
              <strong>
                <span className={"dot " + (l.ok ? "ok" : "bad")} />
                {l.email || "Unknown account"}
              </strong>
              <span>
                {l.method}
                {l.reason ? ` · ${l.reason}` : ""}
                {l.ip ? ` · ${l.ip}` : ""} · {new Date(l.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
