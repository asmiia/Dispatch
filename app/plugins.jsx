"use client";
import { Puzzle } from "lucide-react";

// Plugins: a place for add-ons later. For now it only says so.
export function PluginsList() {
  return (
    <aside className="spaces">
      <header>
        <strong className="space-switch">Plugins</strong>
      </header>
      <div className="spaces-scroll">
        <div className="space-title">
          <span>Installed</span>
        </div>
        <p className="muted" style={{ padding: "6px 14px", fontSize: 13 }}>Nothing installed yet.</p>
      </div>
    </aside>
  );
}

export function PluginsPage({ teamName }) {
  return (
    <div className="inbox-page">
      <div className="inbox-wrap">
        <span className="inbox-org">{teamName}</span>
        <h1>Plugins</h1>
        <p className="muted">Add-ons that give your team more to do in Dispatch.</p>
        <div className="plugins-empty">
          <Puzzle size={28} />
          <strong>No plugins yet</strong>
          <span>They will show up here once they are available.</span>
        </div>
      </div>
    </div>
  );
}
