"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 90
    ? "just now"
    : s < 5400
      ? `${Math.round(s / 60)} min ago`
      : s < 129600
        ? `${Math.round(s / 3600)} h ago`
        : new Date(iso).toLocaleDateString();
};
const filters = [
  ["all", "All"],
  ["failed", "Failed"],
  ["ok", "Successful"],
];

// Sign-in attempts as a table you can filter, with the headline numbers on top.
export default function Activity({ api }) {
  const [data, setData] = useState(null),
    [filter, setFilter] = useState("all"),
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
  const s = data.stats,
    cards = [
      ["Sign-ins today", s.logins_24h],
      ["Failed today", s.failed_24h, s.failed_24h > 0],
      ["Messages today", s.messages_24h],
      ["Two-factor users", `${s.mfa_users}/${s.users}`],
    ],
    rows = data.logins.filter(
      (l) => filter === "all" || (filter === "ok" ? l.ok : !l.ok),
    );
  return (
    <>
      <div className="page-head">
        <h3>Activity</h3>
        <p className="muted">
          Who has been signing in, and whether it worked. Kept for 90 days.
        </p>
      </div>
      <div className="stat-grid compact">
        {cards.map(([label, value, warn]) => (
          <div className={"stat" + (warn ? " warn" : "")} key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="members-head">
        <h4 className="plain-h4">Sign-ins</h4>
        <div
          className="theme-switch"
          role="radiogroup"
          aria-label="Filter sign-ins"
        >
          {filters.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="member-table activity-table">
        <div className="member-row member-head">
          <span>Account</span>
          <span>Method</span>
          <span>Result</span>
          <span>When</span>
        </div>
        {rows.length === 0 && <p className="muted pad">Nothing to show.</p>}
        {rows.map((l) => (
          <div className="member-row" key={l.id}>
            <div className="member-who">
              <span className={"dot big " + (l.ok ? "ok" : "bad")} />
              <div>
                <strong>{l.email || "Unknown account"}</strong>
                {l.ip && <span>{l.ip}</span>}
              </div>
            </div>
            <div>
              <span className="chip role">{l.method}</span>
            </div>
            <div className={"result " + (l.ok ? "ok" : "bad")}>
              {l.ok ? "Signed in" : l.reason || "Failed"}
            </div>
            <div
              className="last-seen"
              title={new Date(l.created_at).toLocaleString()}
            >
              <strong>{ago(l.created_at)}</strong>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
