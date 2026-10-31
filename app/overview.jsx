"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import AgentAvatar from "./agent-avatar";

const bytes = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${(n / 1073741824).toFixed(2)} GB`;
const uptime = (s) =>
  s < 3600
    ? `${Math.max(1, Math.round(s / 60))} min`
    : s < 172800
      ? `${Math.round(s / 3600)} h`
      : `${Math.round(s / 86400)} days`;
const short = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

// A small bar chart; `second` overlays a second series (for example failed sign-ins).
function Chart({
  title,
  days,
  values,
  second,
  color = "var(--t-ededed)",
  note,
}) {
  const w = 600,
    h = 120,
    gap = 3,
    bar = (w - gap * (days.length - 1)) / days.length,
    max = Math.max(1, ...values, ...(second || []));
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <section className="chart-card">
      <header>
        <strong>{title}</strong>
        <span>{note || `${total.toLocaleString()} in 30 days`}</span>
      </header>
      <svg
        viewBox={`0 0 ${w} ${h + 18}`}
        role="img"
        aria-label={title}
        preserveAspectRatio="none"
      >
        {days.map((d, i) => {
          const x = i * (bar + gap),
            a = (values[i] / max) * h,
            b = second ? (second[i] / max) * h : 0;
          return (
            <g key={d}>
              <title>{`${short(d)}: ${values[i]}${second ? `, ${second[i]} failed` : ""}`}</title>
              <rect
                x={x}
                y={0}
                width={bar}
                height={h}
                fill="var(--c-1a1a1a)"
                rx="2"
              />
              <rect
                x={x}
                y={h - a}
                width={bar}
                height={Math.max(a, values[i] ? 2 : 0)}
                fill={color}
                rx="2"
              />
              {second && b > 0 && (
                <rect
                  x={x}
                  y={h - b}
                  width={bar}
                  height={Math.max(b, 2)}
                  fill="#e5484d"
                  rx="2"
                />
              )}
            </g>
          );
        })}
        <text x="0" y={h + 14} className="chart-axis">
          {short(days[0])}
        </text>
        <text x={w} y={h + 14} textAnchor="end" className="chart-axis">
          {short(days[days.length - 1])}
        </text>
      </svg>
    </section>
  );
}

function Rows({ title, rows, empty }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="rank-card">
      <strong>{title}</strong>
      {rows.length === 0 && <p className="muted">{empty}</p>}
      {rows.map((r) => (
        <div className="rank-row" key={r.key}>
          <div className="rank-label">
            {r.icon}
            <span title={r.title}>{r.label}</span>
            <em>{r.note}</em>
          </div>
          <div className="rank-bar">
            <i style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
          </div>
          <b>{r.display ?? r.value}</b>
        </div>
      ))}
    </section>
  );
}

// Instance overview for administrators: totals, 30-day trends, who is busiest, and storage.
export default function Overview({ api }) {
  const [a, setA] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("settings/analytics")
      .then(setA)
      .catch((e) => setError(e.message));
  }, []);
  if (error)
    return (
      <div className="error" role="alert">
        {error}
      </div>
    );
  if (!a) return <Loader2 className="spin" size={20} />;
  const t = a.totals,
    cards = [
      ["Users", t.users, `${t.active_users_30d} active in 30 days`],
      ["Teams", t.teams, `${t.projects} project${t.projects === 1 ? "" : "s"}`],
      ["Agents", t.agents, ""],
      [
        "Messages",
        t.messages.toLocaleString(),
        `${t.messages_24h} today · ${t.messages_7d} this week`,
      ],
      ["Files", t.files, bytes(t.file_bytes)],
      ["Two-factor", `${t.mfa_users}/${t.users}`, "users with it on"],
    ];
  return (
    <>
      <h3>Overview</h3>
      <div className="stat-grid">
        {cards.map(([label, value, sub]) => (
          <div className="stat" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
            {sub && <em>{sub}</em>}
          </div>
        ))}
        <div className={"stat" + (t.failed_24h ? " warn" : "")}>
          <strong>{t.failed_24h}</strong>
          <span>Failed sign-ins today</span>
        </div>
      </div>

      <div className="chart-grid">
        <Chart
          title="Messages per day"
          days={a.days}
          values={a.series.messages}
        />
        <Chart
          title="Sign-ins per day"
          days={a.days}
          values={a.series.signins}
          second={a.series.failed}
          note="red = failed"
        />
        <Chart
          title="New users per day"
          days={a.days}
          values={a.series.new_users}
        />
      </div>

      <div className="rank-grid">
        <Rows
          title="Busiest projects (30 days)"
          empty="No messages yet."
          rows={a.top_projects.map((p) => ({
            key: p.name + p.team,
            label: p.name,
            note: p.team,
            value: p.n,
            display: p.n.toLocaleString(),
          }))}
        />
        <Rows
          title="Most active agents (30 days)"
          empty="No agent has sent a message yet."
          rows={a.top_agents.map((g) => ({
            key: g.name + g.project,
            label: g.name,
            note: g.project,
            title: [g.program, g.model].join(" · "),
            icon: (
              <AgentAvatar
                className="avatar tiny"
                name={g.name}
                program={g.program}
                model={g.model}
              />
            ),
            value: g.n,
            display: g.n.toLocaleString(),
          }))}
        />
        <Rows
          title="Agents by program"
          empty="No agents yet."
          rows={a.by_program.map((p) => ({
            key: p.program,
            label: p.program,
            icon: (
              <AgentAvatar
                className="avatar tiny"
                name={p.program}
                program={p.program}
              />
            ),
            value: p.n,
          }))}
        />
        <Rows
          title="Storage by team"
          empty="No teams."
          rows={a.storage.map((s) => ({
            key: s.name,
            label: s.name,
            note: `${s.files} file${s.files === 1 ? "" : "s"} · quota ${bytes(s.quota_bytes)}`,
            value: s.bytes,
            display: `${bytes(s.bytes)} (${Math.round((s.bytes / s.quota_bytes) * 100)}%)`,
          }))}
        />
      </div>

      <h4>System</h4>
      <div className="system-grid">
        {[
          ["Version", a.system.version],
          ["Node", a.system.node],
          ["Platform", a.system.platform],
          ["Uptime", uptime(a.system.uptime_seconds)],
          ["Memory", bytes(a.system.memory_bytes)],
          ["Database", bytes(a.system.database_bytes)],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
    </>
  );
}
