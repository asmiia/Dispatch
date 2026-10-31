"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

const KEY = "dispatch-theme";
const options = [
  ["system", Monitor, "System"],
  ["light", Sun, "Light"],
  ["dark", Moon, "Dark"],
];

const read = () => {
  try {
    return localStorage.getItem(KEY) || "system";
  } catch {
    return "system";
  }
};
function apply(pref) {
  const light =
    pref === "light" ||
    (pref === "system" &&
      window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
}

// Keeps the page in sync with the saved choice, and with the OS while set to "system".
function useTheme() {
  const [pref, setPref] = useState("system");
  useEffect(() => {
    setPref(read());
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => read() === "system" && apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const choose = (next) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    setPref(next);
    apply(next);
  };
  return [pref, choose];
}

export function ThemeSwitch() {
  const [pref, choose] = useTheme();
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {options.map(([id, Icon, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={pref === id}
          className={pref === id ? "active" : ""}
          onClick={() => choose(id)}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}

// Compact button that cycles system, light, dark.
export function ThemeButton() {
  const [pref, choose] = useTheme();
  const at = options.findIndex(([id]) => id === pref),
    next = options[(at + 1) % options.length],
    [, Icon, label] = options[at < 0 ? 0 : at];
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Theme: ${label}. Switch to ${next[2]}`}
      title={`Theme: ${label}`}
      onClick={() => choose(next[0])}
    >
      <Icon size={16} />
    </button>
  );
}

// Big preview tiles for the Appearance page.
export function ThemeCards() {
  const [pref, choose] = useTheme();
  return (
    <div className="theme-cards" role="radiogroup" aria-label="Theme">
      {options.map(([id, Icon, label]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={pref === id}
          className={"theme-card" + (pref === id ? " active" : "")}
          onClick={() => choose(id)}
        >
          <span className={"theme-preview " + id}>
            <i />
            <i />
            <i />
          </span>
          <span className="theme-card-label">
            <Icon size={14} />
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
