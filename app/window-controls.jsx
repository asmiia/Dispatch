"use client";
import { useEffect, useState } from "react";

// Minimise, maximise and close, drawn by the page so they match the window bar. Only in the desktop app on
// Windows and Linux; macOS keeps its own buttons.
export default function WindowControls() {
  const [ok, setOk] = useState(false),
    [max, setMax] = useState(false);
  useEffect(() => {
    const d = window.dispatchDesktop;
    if (!d?.win || d.platform === "darwin") return;
    setOk(true);
    d.win.maximized().then(setMax);
    d.win.onState(setMax);
  }, []);
  if (!ok) return null;
  const act = (a) => window.dispatchDesktop.win.act(a);
  return (
    <div className="win-controls">
      <button aria-label="Minimise" onClick={() => act("minimize")}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
      </button>
      <button aria-label={max ? "Restore" : "Maximise"} onClick={() => act("maximize")}>
        {max ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="2.5" y="0.5" width="7" height="7" rx="1" />
            <path d="M0.5 2.5v6a1 1 0 0 0 1 1h6" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
          </svg>
        )}
      </button>
      <button className="close" aria-label="Close" onClick={() => act("close")}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
      </button>
    </div>
  );
}
