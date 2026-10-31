"use client";
import { ThemeCards } from "./theme-toggle";

export default function Appearance() {
  return (
    <>
      <h3>Appearance</h3>
      <p className="muted">Choose light, dark, or follow your device.</p>
      <div className="settings-grid">
        <section className="card wide">
          <h4>Theme</h4>
          <ThemeCards />
        </section>
      </div>
    </>
  );
}
