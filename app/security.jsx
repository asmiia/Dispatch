"use client";
import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Laptop,
  Loader2,
  LogOut,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

function Qr({ rows }) {
  const n = rows.length;
  return (
    <svg
      className="mfa-qr"
      viewBox={`-2 -2 ${n + 4} ${n + 4}`}
      role="img"
      aria-label="QR code for your authenticator app"
      shapeRendering="crispEdges"
    >
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#fff" />
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "1" ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="1"
              height="1"
              fill="#000"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

const device = (ua) => {
  if (!ua) return "Unknown device";
  const browser = /Electron\//.test(ua)
    ? "Dispatch desktop app"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
};
const ago = (iso) => {
  if (!iso) return "unknown";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 90
    ? "just now"
    : s < 5400
      ? `${Math.round(s / 60)} min ago`
      : s < 129600
        ? `${Math.round(s / 3600)} h ago`
        : new Date(iso).toLocaleDateString();
};

// Devices signed in to this account, with the option to sign any of them out.
function Sessions({ api }) {
  const [rows, setRows] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("settings/sessions")
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function act(path, body) {
    setBusy(true);
    setError("");
    try {
      const r = await api(path, body);
      if (r.signed_out) return window.location.reload();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!rows)
    return error ? (
      <div className="error" role="alert">
        {error}
      </div>
    ) : (
      <Loader2 className="spin" size={20} />
    );
  return (
    <>
      <h4>Active sessions</h4>
      <div className="settings-rows">
        {rows.map((r) => (
          <div className="settings-row" key={r.id}>
            <div>
              <strong>
                <Laptop
                  size={13}
                  style={{ marginRight: 8, verticalAlign: -2 }}
                />
                {device(r.ua)}
                {r.current ? " · This device" : ""}
              </strong>
              <span>
                Active {ago(r.last_seen || r.created_at)} · signed in{" "}
                {ago(r.created_at)}
                {r.ip ? ` · ${r.ip}` : ""}
              </span>
            </div>
            {!r.current && (
              <button
                className="subtle-button"
                disabled={busy}
                onClick={() => act("settings/sessions/revoke", { id: r.id })}
              >
                <LogOut size={13} />
                Sign out
              </button>
            )}
          </div>
        ))}
      </div>
      {rows.length > 1 && (
        <button
          className="subtle-button"
          disabled={busy}
          onClick={() => act("settings/sessions/revoke-others", {})}
        >
          Sign out all other sessions
        </button>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

// Two-factor authentication: enable with an authenticator app, keep recovery codes, disable.
export default function Security({ api }) {
  const [status, setStatus] = useState(null),
    [setup, setSetup] = useState(null),
    [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [recovery, setRecovery] = useState(null),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    api("settings/security")
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setCode("");
      setPassword("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!status) return <Loader2 className="spin" size={20} />;
  return (
    <>
      <h3>Security</h3>
      <div className="settings-card">
        <div className="settings-card-head">
          <span
            className={"settings-card-icon" + (status.enabled ? " on" : "")}
          >
            {status.enabled ? (
              <ShieldCheck size={18} />
            ) : (
              <Smartphone size={18} />
            )}
          </span>
          <div>
            <strong>Two-factor authentication</strong>
            <span>
              {status.enabled
                ? `On · ${status.recovery_left} recovery codes left`
                : "Protect your account with an authenticator app."}
            </span>
          </div>
        </div>

        {!status.enabled && !setup && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () =>
                setSetup(await api("settings/mfa/start", { password })),
              );
            }}
          >
            <label htmlFor="mfa-start-password">
              Confirm your password to begin
            </label>
            <input
              id="mfa-start-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="primary" disabled={busy}>
              Set up authenticator
            </button>
          </form>
        )}

        {!status.enabled && setup && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const r = await api("settings/mfa/confirm", { code });
                setRecovery(r.recovery_codes);
                setSetup(null);
              });
            }}
          >
            <p className="muted">
              Scan this with Google Authenticator, 1Password, Authy or similar,
              then enter the 6-digit code it shows.
            </p>
            <Qr rows={setup.qr} />
            <p className="muted">
              Can't scan? Enter this key manually: <code>{setup.secret}</code>
            </p>
            <label htmlFor="mfa-code">6-digit code</label>
            <input
              id="mfa-code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="primary" disabled={busy}>
              Turn on
            </button>
            <button
              type="button"
              className="subtle-button"
              onClick={() => setSetup(null)}
            >
              Cancel
            </button>
          </form>
        )}

        {recovery && (
          <div className="secret-result">
            <strong>Save your recovery codes</strong>
            <p className="muted">
              Each code works once if you lose your phone. They won't be shown
              again.
            </p>
            <code className="recovery-codes">{recovery.join("\n")}</code>
            <button
              className="subtle-button"
              onClick={async () => {
                await navigator.clipboard.writeText(recovery.join("\n"));
                setCopied(true);
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}{" "}
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="subtle-button" onClick={() => setRecovery(null)}>
              I've saved them
            </button>
          </div>
        )}

        {status.enabled && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(() => api("settings/mfa/disable", { password, code }));
            }}
          >
            <h4>Turn off</h4>
            <label htmlFor="mfa-off-password">Password</label>
            <input
              id="mfa-off-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <label htmlFor="mfa-off-code">Authenticator or recovery code</label>
            <input
              id="mfa-off-code"
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="subtle-button" disabled={busy}>
              Turn off two-factor
            </button>
          </form>
        )}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <Sessions api={api} />
    </>
  );
}
