"use client";
import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2, MonitorDown } from "lucide-react";

const size = (n) =>
  n < 1048576 ? `${Math.round(n / 1024)} KB` : `${Math.round(n / 1048576)} MB`;
const names = { windows: "Windows", mac: "macOS", linux: "Linux" };
const label = (f) =>
  /setup/i.test(f.name)
    ? "Installer"
    : /portable|\d\.exe$/i.test(f.name) && f.platform === "windows"
      ? "Portable (no install)"
      : /\.deb$/i.test(f.name)
        ? "Debian package"
        : /appimage/i.test(f.name)
          ? "AppImage"
          : "Download";

// Download the desktop app from this server, then open this server in it with one click.
export default function DesktopApp({ api }) {
  const [files, setFiles] = useState(null),
    [mine, setMine] = useState("");
  useEffect(() => {
    api("desktop")
      .then((r) => setFiles(r.files))
      .catch(() => setFiles([]));
    const p = navigator.userAgent;
    setMine(
      /Windows/i.test(p)
        ? "windows"
        : /Mac/i.test(p)
          ? "mac"
          : /Linux/i.test(p)
            ? "linux"
            : "",
    );
  }, []);
  if (!files) return <Loader2 className="spin" size={20} />;
  const origin = window.location.origin,
    // Only the newest build of each kind.
    newest = [...files]
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
      .filter((f, i, all) => all.findIndex((g) => g.platform === f.platform && label(g) === label(f)) === i),
    sorted = newest.sort((a, b) => (b.platform === mine) - (a.platform === mine));
  return (
    <div className="desktop-app">
      <p className="muted">
        The desktop app is this same workspace in its own window, with a screen
        picker that can share system audio, an unread count on the taskbar icon,
        background notifications and launch at login.
      </p>
      <div className="step-card">
        <span className="step-num">1</span>
        <div className="step-body">
          <strong>Install it</strong>
          {sorted.length ? (
            <div className="os-grid">
              {sorted.map((f) => (
                <a
                  key={f.name}
                  className="os-card"
                  href={`/api/desktop/download?name=${encodeURIComponent(f.name)}`}
                >
                  <MonitorDown size={20} />
                  <span className="os-text">
                    <strong>{names[f.platform]}</strong>
                    <em>
                      {label(f)} · {size(f.size)}
                    </em>
                  </span>
                  <Download size={16} />
                </a>
              ))}
            </div>
          ) : (
            <p className="muted small">
              This server has no installers yet. Put them in the{" "}
              <code>desktop</code> folder of its data directory, or get them
              from the project's releases.
            </p>
          )}
        </div>
      </div>
      <div className="step-card">
        <span className="step-num">2</span>
        <div className="step-body">
          <strong>Connect it to this server</strong>
          <p className="muted small">
            Once it is installed, this button opens the app and points it at{" "}
            <code>{origin}</code> for you. No address to type.
          </p>
          <a
            className="subtle-button"
            href={`dispatch://connect?server=${encodeURIComponent(origin)}`}
          >
            <ExternalLink size={14} />
            Open in the desktop app
          </a>
        </div>
      </div>
      <p className="muted small">
        The installers are not code-signed, so Windows and macOS warn the first
        time you run them.
      </p>
    </div>
  );
}
