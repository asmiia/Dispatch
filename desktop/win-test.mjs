// Launches the desktop app against a throwaway server: it loads the workspace, exposes the desktop bridge,
// shows its own screen picker for sharing, and asks for the server address when it has none.
import { _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { seed } from "../scripts/demo-seed.mjs";

const dir = mkdtempSync(join(tmpdir(), "dispatch-desk-")),
  setup = randomBytes(32).toString("hex"),
  port = 3107,
  origin = `http://127.0.0.1:${port}`,
  main = resolve("desktop/main.js"),
  // The desktop app has its own dependencies; use the Electron installed there.
  executablePath = createRequire(resolve("desktop/package.json"))("electron");
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      DISPATCH_SETUP_KEY: setup,
      DISPATCH_DATA_DIR: dir,
      DISPATCH_BACKUP_DIR: dir + "-b",
      DISPATCH_BACKUP_INTERVAL_HOURS: "0",
      DISPATCH_BACKUP_PASSPHRASE: "",
      DISPATCH_LOG_LEVEL: "error",
    },
    stdio: "ignore",
    windowsHide: true,
  },
);
let app, app2;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const { people } = await seed({
    origin,
    setupKey: setup,
    password: "demo password 12345",
  });

  // 1. With a server configured it loads the workspace and exposes the bridge.
  const data = mkdtempSync(join(tmpdir(), "dispatch-desk-data-"));
  app = await electron.launch({
    executablePath,
    args: [main, `--user-data-dir=${data}`],
    env: { ...process.env, DISPATCH_URL: origin }, 
  });
  const win = await app.firstWindow(); win.on("console",m=>m.type()==="error"&&console.log("PAGE",m.text().slice(0,200))); win.on("pageerror",e=>console.log("PAGEERR",e.message));
  await app.evaluate(
    async ({ session }, [url, value]) => {
      await session.defaultSession.cookies.set({
        url,
        name: "dispatch_session",
        value,
      });
    },
    [origin, people.sam.cookie.split("=")[1]],
  );
  await win.reload();
  await win.locator(".feed-scroll").waitFor({timeout:20000});
  assert.equal(
    await win.evaluate(() => window.dispatchDesktop?.isDesktop),
    true,
  );
  assert.equal(
    await win.evaluate(() => typeof require),
    "undefined",
    "no Node in the page",
  );
  console.log(
    "desktop: workspace loads, bridge exposed, page has no Node access",
  );

  // 2. Screen sharing opens our picker and the chosen screen reaches the call.
  await win.locator(".feed-scroll").waitFor({timeout:20000});
  
  await win.getByRole("button", { name: "Join the voice call" }).click();
  await win.locator(".call-tile").first().waitFor({ timeout: 15000 });
  await win.evaluate(()=>{const o=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getDisplayMedia=async(c)=>{console.error("GDM call",JSON.stringify(c));try{const s=await o(c);const t=s.getVideoTracks()[0];console.error("GDM ok",t.label,JSON.stringify(t.getSettings()));t.addEventListener("ended",()=>console.error("TRACK ENDED"));return s}catch(e){console.error("GDM fail",e.name,e.message);throw e}}});
  await win.locator("#call-slot").getByRole("button", { name: "Share your screen" }).click();
  let picker;
  for (let i = 0; i < 40 && !picker; i++) {
    picker = app
      .windows()
      .find((w) => w !== win && w.url().includes("picker.html"));
    if (!picker) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(picker, "the screen picker opened");
  await picker.locator(".card").first().waitFor({ timeout: 10000 });
  if (process.env.TAB) await picker.getByRole("button",{name:process.env.TAB}).click(); console.log("cards:",await picker.locator(".card").allInnerTexts());await picker.locator(".card", {hasText: process.env.CARD}).first().click(); if (process.env.NOAUDIO) await picker.locator("#audio").uncheck();
  await picker.locator("#go").click();
  await win.locator(".screen-tile video").waitFor({ timeout: 15000 }); console.log("SHARED OK");
  console.log(
    "desktop: screen picker works and the shared screen shows in the call",
  );
} finally { await app?.close(); server.kill(); }
