// Installers for the desktop app that this instance hands out. Drop them in <data dir>/desktop.
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { MailError } from "./store.mjs";

const folder = () =>
  resolve(
    /*turbopackIgnore: true*/ process.env.DISPATCH_DATA_DIR || ".local",
    "desktop",
  );
const platformOf = (name) =>
  /\.(yml|blockmap)$/i.test(name)
    ? "meta"
    : /\.exe$/i.test(name)
      ? "windows"
      : /\.dmg$/i.test(name)
        ? "mac"
        : /\.(appimage|deb|rpm)$/i.test(name)
          ? "linux"
          : null;

function all() {
  const dir = folder();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => ({ name, platform: platformOf(name) }))
    .filter((f) => f.platform)
    .map((f) => ({ ...f, size: statSync(join(dir, f.name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The downloads people see (no update metadata).
export const installers = () => all().filter((f) => f.platform !== "meta");

// Streams one installer. Only names from the list above are served, so no path can escape the folder.
export function installerResponse(name) {
  const file = all().find((f) => f.name === name);
  if (!file) throw new MailError("Not found", 404);
  return new Response(
    Readable.toWeb(createReadStream(join(folder(), file.name))),
    {
      headers: {
        "Content-Type": /\.yml$/i.test(file.name)
          ? "text/yaml"
          : "application/octet-stream",
        "Content-Length": String(file.size),
        "Content-Disposition": `attachment; filename="${file.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
