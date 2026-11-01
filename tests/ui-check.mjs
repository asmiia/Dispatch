// Checks the workspace behaviours that are easy to break: the team you switch to sticks, the app's own
// context menu replaces the browser's, profiles open, and the conversation search filters messages.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "../scripts/demo-seed.mjs";

const dir = mkdtempSync(join(tmpdir(), "dispatch-ui-")),
  setup = randomBytes(32).toString("hex"),
  port = 3106,
  origin = `http://127.0.0.1:${port}`;
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
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const { people, call, project } = await seed({
    origin,
    setupKey: setup,
    password: "demo password 12345",
  });
  const sam = people.sam.cookie;
  await call("settings/teams", { name: "Second team" }, sam);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await ctx.addCookies([
    { name: "dispatch_session", value: sam.split("=")[1], url: origin },
  ]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page
    .getByText("Docs search shows old pages after the move")
    .first()
    .click();
  await page.locator(".bubble").first().waitFor();

  // 1. Profile from a name in the chat.
  await page.locator(".who-name").first().click();
  await page.locator(".profile-stats").waitFor();
  assert.ok(
    (await page.locator(".profile").innerText()).includes("Conversations"),
  );
  await page.screenshot({ path: "ui-profile.png" });
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator(".profile-close").click();

  // 2. Search filters this conversation.
  const before = await page.locator(".bubble").count();
  await page.getByPlaceholder("Search this conversation").fill("rounding");
  await page.waitForFunction(
    (n) => document.querySelectorAll(".bubble").length < n,
    before,
  );
  await page.getByPlaceholder("Search this conversation").fill("");

  // 3. Right-click anywhere gets the app's menu and the browser's is cancelled.
  const prevented = await page.evaluate(() => {
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 600,
      clientY: 400,
    });
    document.querySelector(".chat-scroll").dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(prevented, true);
  await page.locator(".ctx-menu").waitFor();
  await page.keyboard.press("Escape");
  const inInput = await page.evaluate(() => {
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    document.querySelector("#body").dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(inInput, true);
  await page.locator(".ctx-menu").getByText("Paste").waitFor();
  await page.keyboard.press("Escape");

  // 4. A message in a conversation you are not looking at pops up as a toast.
  await call(
    "messages",
    {
      project_key: project,
      sender_name: "IcyHorizon",
      to: [people.sam.identity],
      subject: "Fresh topic",
      body_md: "toast me",
    },
    people.lena.cookie,
  );
  await page
    .locator(".toast", { hasText: "Fresh topic" })
    .waitFor({ timeout: 15000 });

  // 5. The team you switch to in Settings sticks after closing it.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".team-switch .team-current").click();
  await page.locator(".team-menu").getByText("Second team").click();
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator(".project-list button").count(),
    0,
    "the new team has no projects yet",
  );
  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByLabel("Channel name").fill("fresh");
  await page
    .locator(".modal")
    .getByRole("button", { name: /Create channel/ })
    .click();
  await page.locator(".project-list button", { hasText: "fresh" }).waitFor();
  const projects = await page.evaluate(async () =>
    (await (await fetch("/api/projects")).json()).map((p) => [
      p.name,
      p.team_id,
    ]),
  );
  const teams = await page.evaluate(async () =>
    (await (await fetch("/api/me")).json()).teams.map((t) => [t.name, t.id]),
  );
  const second = teams.find(([n]) => n === "Second team")[1];
  assert.equal(projects.find(([n]) => n === "fresh")[1], second);
  // 7. The desktop app is offered from the sidebar and downloaded from this server.
  mkdirSync(join(dir, "desktop"), { recursive: true });
  writeFileSync(
    join(dir, "desktop", "Dispatch Setup 1.0.0.exe"),
    Buffer.alloc(2048, 7),
  );
  await page.getByRole("button", { name: "Get the desktop app" }).click();
  const dl = page.locator(".dl-list a").first();
  await dl.waitFor();
  const got = await page.evaluate(
    async (href) => {
      const r = await fetch(href);
      return [r.status, (await r.arrayBuffer()).byteLength];
    },
    await dl.getAttribute("href"),
  );
  assert.deepEqual(got, [200, 2048]);
  assert.match(
    await page
      .getByRole("link", { name: "Open in the desktop app" })
      .getAttribute("href"),
    /^dispatch:\/\/connect\?server=/,
  );
  const traversal = await page.evaluate(
    async () => (await fetch("/api/desktop/download?name=../../.env")).status,
  );
  assert.equal(traversal, 404);
  // The desktop app's updater reads its feed without signing in; nothing outside the folder is served.
  writeFileSync(join(dir, "desktop", "alpha.yml"), "version: 1.0.0\n");
  const feed = await fetch(origin + "/api/desktop-updates/alpha.yml");
  assert.equal(feed.status, 200);
  assert.match(await feed.text(), /version: 1\.0\.0/);
  assert.equal(
    (await fetch(origin + "/api/desktop-updates/..%2F..%2F.env")).status,
    404,
  );
  await page.locator(".modal-backdrop .icon-button").first().click();

  // 6. Panels resize by dragging, and the size is remembered.
  const width = () =>
    page
      .locator(".message-list")
      .evaluate((e) => e.getBoundingClientRect().width);
  const w0 = await width(),
    box = await page.locator(".resizer.x").nth(1).boundingBox();
  await page.mouse.move(box.x + box.width / 2, 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, 300, { steps: 8 });
  await page.mouse.up();
  const w1 = await width();
  assert.ok(w1 > w0 + 80, `list grew from ${w0} to ${w1}`);
  await page.reload();
  await page.locator(".message-list").waitFor();
  assert.ok(Math.abs((await width()) - w1) < 3, "the size is remembered");

  assert.deepEqual(errors, []);
  console.log(
    "UI checks passed: profile, conversation search, custom context menus, team switch, resizing, toasts, desktop app download",
  );
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(dir, { recursive: true, force: true });
}
