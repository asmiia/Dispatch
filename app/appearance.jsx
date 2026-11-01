"use client";
import { useEffect, useState } from "react";
import { ThemeCards } from "./theme-toggle";
import { blip, ring, setSounds, soundsOn } from "./sounds";

export default function Appearance() {
  const [perm, setPerm] = useState(""),
    [sounds, setSound] = useState(true);
  useEffect(() => {
    setSound(soundsOn());
    setPerm(
      window.dispatchDesktop
        ? "desktop"
        : window.Notification?.permission || "unsupported",
    );
  }, []);
  return (
    <>
      <h3>Appearance</h3>
      <p className="muted">Choose light, dark, or follow your device.</p>
      <div className="settings-grid">
        <section className="card wide">
          <h4>Theme</h4>
          <ThemeCards />
        </section>
        <section className="card wide">
          <h4>Notifications</h4>
          <p className="muted">
            {perm === "desktop"
              ? "The desktop app shows a notification when a message arrives while it is in the background, and a count on the taskbar icon."
              : perm === "granted"
                ? "On. You will see a notification when a message arrives while this tab is in the background."
                : perm === "denied"
                  ? "Blocked in your browser. Allow notifications for this site in the browser's site settings."
                  : perm === "unsupported"
                    ? "This browser does not support notifications."
                    : "Get a notification when a message arrives while this tab is in the background."}
          </p>
          {perm === "default" && (
            <button
              className="subtle-button"
              onClick={() =>
                Notification.requestPermission().then((r) => setPerm(r))
              }
            >
              Turn on notifications
            </button>
          )}
        </section>
        <section className="card wide">
          <h4>Sounds</h4>
          <p className="muted">
            A short sound for new messages and a ring when a call is waiting for
            you.
          </p>
          <div className="menu-actions">
            <button
              className="subtle-button"
              aria-pressed={sounds}
              onClick={() => {
                setSounds(!sounds);
                setSound(!sounds);
              }}
            >
              {sounds ? "Turn sounds off" : "Turn sounds on"}
            </button>
            <button
              className="subtle-button"
              onClick={() => {
                const stop = ring();
                blip();
                setTimeout(stop, 1800);
              }}
            >
              Preview ring
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
