"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const on = (v) => (
  <span className={"chip " + (v ? "ok" : "")}>{v ? "On" : "Off"}</span>
);

// What this instance is configured with. These values come from environment variables, so they are read-only here.
export default function InstanceSettings({ api }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("settings/instance")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  if (!data && !error) return <Loader2 className="spin" size={20} />;
  const groups = data && [
    [
      "General",
      [
        ["Version", "v" + data.version],
        ["Public address", data.origin || "Not set"],
        ["Node.js", data.node],
        ["Log level", data.log_level],
      ],
    ],
    [
      "Sign-in",
      [
        ["Email delivery", on(data.mail)],
        [
          "Single sign-on",
          data.oauth.length ? data.oauth.join(", ") : "No providers",
        ],
        ["Secure cookies", on(data.secure_cookies)],
        ["Behind a proxy", on(data.trust_proxy)],
      ],
    ],
    [
      "Limits and retention",
      [
        ["File size limit", Math.round(data.upload_limit / 1048576) + " MB"],
        ["Audit log kept", data.audit_retention_days + " days"],
      ],
    ],
    [
      "Updates",
      [
        ["Automatic updates", on(data.auto_update)],
        ["Update command", on(data.update_command)],
      ],
    ],
  ];
  return (
    <>
      <h3>Settings</h3>
      <p className="muted">
        How this instance is set up. Change these in your{" "}
        <code>.env.local</code> or container environment, then restart.
      </p>
      {data && (
        <div className="settings-grid">
          {groups.map(([title, rows]) => (
            <section className="card" key={title}>
              <h4>{title}</h4>
              <dl className="kv">
                {rows.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
