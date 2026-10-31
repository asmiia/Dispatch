"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Ticket } from "lucide-react";

const initial = (name) => (name || "?").trim()[0]?.toUpperCase() || "?";

// The team you are looking at, with a menu to switch, create or join. Always shown, bottom-left of Settings.
export default function TeamSwitcher({ teams, team, run, onSwitch }) {
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState("menu"),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    box = useRef(null);
  const current = teams.find((t) => t.id === team) || teams[0];

  useEffect(() => {
    if (!open) return;
    const away = (e) => !box.current?.contains(e.target) && setOpen(false),
      key = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  function toggle() {
    setOpen((v) => !v);
    setMode("menu");
  }
  async function create(e) {
    e.preventDefault();
    const made = await run("teams", { name });
    if (made?.id) {
      setName("");
      setOpen(false);
      onSwitch(made.id);
    }
  }
  async function join(e) {
    e.preventDefault();
    const done = await run("join", { code: code.trim() });
    if (done) {
      setCode("");
      setOpen(false);
    }
  }
  if (!current) return null;
  return (
    <div className="team-switch" ref={box}>
      {open && (
        <div className="team-menu" role="menu" aria-label="Teams">
          {mode === "menu" && (
            <>
              <span className="menu-label">Your teams</span>
              {teams.map((t) => (
                <button
                  key={t.id}
                  role="menuitemradio"
                  aria-checked={t.id === team}
                  className="team-item"
                  onClick={() => {
                    setOpen(false);
                    if (t.id !== team) onSwitch(t.id);
                  }}
                >
                  <span className="team-badge">{initial(t.name)}</span>
                  <span className="team-text">
                    <strong>{t.name}</strong>
                    <em>{t.role}</em>
                  </span>
                  {t.id === team && <Check size={14} />}
                </button>
              ))}
              <hr />
              <button
                role="menuitem"
                className="team-item action"
                onClick={() => setMode("create")}
              >
                <Plus size={15} />
                Create a team
              </button>
              <button
                role="menuitem"
                className="team-item action"
                onClick={() => setMode("join")}
              >
                <Ticket size={15} />
                Join with an invitation code
              </button>
            </>
          )}
          {mode === "create" && (
            <form onSubmit={create}>
              <span className="menu-label">Create a team</span>
              <input
                autoFocus
                required
                aria-label="Team name"
                placeholder="Team name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="menu-actions">
                <button className="primary">Create</button>
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() => setMode("menu")}
                >
                  Back
                </button>
              </div>
            </form>
          )}
          {mode === "join" && (
            <form onSubmit={join}>
              <span className="menu-label">Join a team</span>
              <input
                autoFocus
                required
                aria-label="Invitation code"
                placeholder="Paste your invitation code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <div className="menu-actions">
                <button className="primary">Join</button>
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() => setMode("menu")}
                >
                  Back
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      <button
        className="team-current"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="team-badge">{initial(current.name)}</span>
        <span className="team-text">
          <strong>{current.name}</strong>
          <em>{current.role}</em>
        </span>
        <ChevronsUpDown size={15} />
      </button>
    </div>
  );
}
