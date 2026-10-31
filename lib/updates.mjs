import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log.mjs";
import { MailError } from "./store.mjs";

const REPO = process.env.DISPATCH_UPDATE_REPO || "asmiia/Dispatch";
const HOUR = 3600000;
const current = () =>
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    .version;
const state = {
  checking: false,
  checked: 0,
  latest: null,
  error: "",
  applied: null,
};

// "0.3.0-alpha" -> [0,3,0]; a plain numeric compare is enough for our tags.
const parts = (v) =>
  String(v)
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((n) => Number(n) || 0);
const newer = (a, b) => {
  const x = parts(a),
    y = parts(b);
  for (let i = 0; i < 3; i++)
    if ((x[i] || 0) !== (y[i] || 0)) return x[i] > y[i];
  return false;
};

// Asks GitHub for the newest release (or tag). Cached for 10 minutes.
export async function checkUpdate(force = false) {
  if (state.checking) return status();
  if (!force && Date.now() - state.checked < 600000 && state.checked)
    return status();
  // The first look goes out in the background so the page opens at once.
  const run = fetchLatest();
  if (force) await run;
  return status();
}

async function fetchLatest() {
  state.checking = true;
  state.checked = Date.now();
  try {
    const headers = { "User-Agent": "dispatch-update-check" };
    let r = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers,
        signal: AbortSignal.timeout(10000),
      },
    );
    let tag, url, notes;
    if (r.ok) {
      const j = await r.json();
      [tag, url, notes] = [j.tag_name, j.html_url, j.body];
    } else {
      r = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=1`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error("GitHub answered " + r.status);
      const j = (await r.json())[0];
      if (j)
        [tag, url] = [
          j.name,
          `https://github.com/${REPO}/releases/tag/${j.name}`,
        ];
    }
    state.latest = tag
      ? { tag, url, notes: (notes || "").slice(0, 4000) }
      : null;
    state.error = "";
  } catch (e) {
    state.error = e.message;
  }
  state.checking = false;
}

const changelog = () => {
  try {
    return readFileSync(
      join(/*turbopackIgnore: true*/ process.cwd(), "CHANGELOG.md"),
      "utf8",
    ).slice(0, 60000);
  } catch {
    return "";
  }
};

export function status() {
  const version = current();
  return {
    version,
    latest: state.latest,
    available: !!state.latest && newer(state.latest.tag, version),
    checking: state.checking,
    checked_at: state.checked ? new Date(state.checked).toISOString() : null,
    error: state.error,
    can_apply: !!process.env.DISPATCH_UPDATE_COMMAND,
    auto: process.env.DISPATCH_AUTO_UPDATE === "true",
    applied: state.applied,
    changelog: changelog(),
  };
}

// Runs the command the operator configured (docker compose pull, a git pull and restart, ...).
// It is detached so it can restart this process. The command comes from the environment, never from a request.
export function applyUpdate() {
  const command = process.env.DISPATCH_UPDATE_COMMAND;
  if (!command)
    throw new MailError(
      "Set DISPATCH_UPDATE_COMMAND to let Dispatch update itself.",
      400,
    );
  if (state.applied && Date.now() - Date.parse(state.applied) < 5 * 60000)
    throw new MailError("An update was started a moment ago.", 409);
  state.applied = new Date().toISOString();
  log("warn", "update.start", { command_set: true });
  spawn(command, {
    shell: true,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  return status();
}

// With DISPATCH_AUTO_UPDATE=true, checks every hour and applies a newer release.
export function startAutoUpdate() {
  if (process.env.DISPATCH_AUTO_UPDATE !== "true") return;
  const tick = async () => {
    const s = await checkUpdate(true);
    if (s.available && s.can_apply) {
      try {
        applyUpdate();
      } catch (e) {
        log("error", "update.failed", { error: e.message });
      }
    }
  };
  setTimeout(tick, 60000).unref();
  setInterval(tick, HOUR).unref();
}
