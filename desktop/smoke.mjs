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
  const win = await app.firstWindow();
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
  await win
    .getByText("Docs search shows old pages after the move")
    .first()
    .waitFor({ timeout: 20000 });
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
  await win
    .getByText("Docs search shows old pages after the move")
    .first()
    .click();
  await win.locator(".bubble").first().waitFor();
  await win.getByRole("button", { name: "Join the voice call" }).click();
  await win.locator(".call-tile").first().waitFor({ timeout: 15000 });
  await win.getByRole("button", { name: "Share your screen" }).click();
  let picker;
  for (let i = 0; i < 40 && !picker; i++) {
    picker = app
      .windows()
      .find((w) => w !== win && w.url().includes("picker.html"));
    if (!picker) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(picker, "the screen picker opened");
  await picker.locator(".card").first().waitFor({ timeout: 10000 });
  await picker.getByRole("button", { name: "Entire screen" }).click();
  await picker.locator(".card").first().click();
  await picker.getByRole("button", { name: "SD" }).click();
  await picker.locator("#go").click();
  await win.locator(".screen-tile video").waitFor({ timeout: 15000 });
  console.log(
    "desktop: screen picker works and the shared screen shows in the call",
  );
  await win.locator(".call-btn.leave").click();
  // The "Open in the desktop app" link: a second launch with a dispatch:// address hands it to the running app,
  // which asks first (stubbed here) and then connects to that server.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  const link = `dispatch://connect?server=${encodeURIComponent(origin.replace("127.0.0.1", "localhost"))}`;
  spawn(executablePath, [main, `--user-data-dir=${data}`, link], {
    env: { ...process.env, DISPATCH_URL: origin },
    stdio: "ignore",
  });
  await win.waitForURL(/localhost:/, { timeout: 20000 });
  console.log("desktop: a dispatch:// link connects the app to that server");
  await app.close();

  // 3. With no server it asks for one.
  const data2 = mkdtempSync(join(tmpdir(), "dispatch-desk-data-"));
  const env = { ...process.env };
  delete env.DISPATCH_URL;
  app2 = await electron.launch({
    executablePath,
    args: [main, `--user-data-dir=${data2}`],
    env,
  });
  const first = await app2.firstWindow();
  await first.getByText("Connect to Dispatch").waitFor({ timeout: 15000 });
  await first.locator("#address").fill("127.0.0.1:1");
  await first.getByRole("button", { name: "Continue" }).click();
  await first
    .getByText("No Dispatch server answered")
    .waitFor({ timeout: 15000 });
  await first.locator("#address").fill(origin);
  await first.getByRole("button", { name: "Continue" }).click();
  await first.waitForURL(origin + "/**", { timeout: 15000 });
  console.log("desktop: first run asks for the server and checks it");
} finally {
  await app?.close().catch(() => {});
  await app2?.close().catch(() => {});
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(dir, { recursive: true, force: true });
}
