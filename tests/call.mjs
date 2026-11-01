import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "../scripts/demo-seed.mjs";
const dir = mkdtempSync(join(tmpdir(), "dispatch-call-")),
  setup = randomBytes(32).toString("hex"),
  port = 3105,
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
      DISPATCH_ICE_SERVERS: "[]",
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
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const open = async (who) => {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await ctx.grantPermissions(["microphone"], { origin });
    await ctx.addInitScript(() => {
      // Count the ring's oscillators so the test can tell that it rang.
      window.__osc = 0;
      const make = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        window.__osc++;
        return make.call(this);
      };
      const Orig = window.RTCPeerConnection;
      window.__pcs = [];
      window.RTCPeerConnection = function (...a) {
        const p = new Orig(...a);
        window.__pcs.push(p);
        return p;
      };
      window.RTCPeerConnection.prototype = Orig.prototype;
    });
    await ctx.addCookies([
      {
        name: "dispatch_session",
        value: people[who].cookie.split("=")[1],
        url: origin,
      },
    ]);
    const page = await ctx.newPage();
    await page.goto(origin);
    await page
      .getByText("Docs search shows old pages after the move")
      .first()
      .click();
    await page.locator(".bubble").first().waitFor();
    return page;
  };
  const a = await open("sam"),
    b = await open("lena");
  // Lena starts the call. Sam, who is not in it, gets a banner, a toast and a ring.
  await b.getByRole("button", { name: "Join the voice call" }).click();
  await b.locator(".call-tile").first().waitFor();
  await a.locator(".call-preview").waitFor({ timeout: 12000 });
  await a.locator(".toast.kind-call").waitFor({ timeout: 12000 });
  await a.waitForFunction(() => window.__osc > 0, null, { timeout: 8000 });
  console.log("incoming call: banner, toast and ring");
  await a
    .locator(".call-preview")
    .getByRole("button", { name: "Join call" })
    .click();
  for (const p of [a, b])
    await p.waitForFunction(
      () => document.querySelectorAll(".call-tile").length === 2,
      null,
      { timeout: 15000 },
    );
  const states = async (p) =>
    p.evaluate(() => window.__pcs.map((x) => x.connectionState));
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    await a.waitForTimeout(500);
    const sa = await states(a),
      sb = await states(b);
    ok =
      sa.length > 0 &&
      sa.every((s) => s === "connected") &&
      sb.length > 0 &&
      sb.every((s) => s === "connected");
  }
  console.log(
    "tiles ok, peer connections connected:",
    ok,
    JSON.stringify([await states(a), await states(b)]),
  );
  // Going to another conversation must not end the call: a strip in the sidebar controls it.
  await a.getByText("Nightly status").first().click();
  await a.locator(".call-mini").waitFor({ timeout: 8000 });
  await a.waitForTimeout(1500);
  assert.ok(
    (await states(a)).every((x) => x === "connected"),
    "still connected after leaving the conversation",
  );
  assert.equal(
    await b.locator(".call-tile").count(),
    2,
    "the other person still sees both of us",
  );
  await a.locator(".call-mini").getByRole("button", { name: "Return" }).click();
  await a.locator(".call .call-tile").first().waitFor({ timeout: 8000 });
  console.log("the call survives switching conversations");
  // Raise a hand, send a reaction, share a screen: each shows up on the other side.
  await a.getByRole("button", { name: "Raise hand" }).click();
  await b.locator(".call-badges .hand").waitFor({ timeout: 8000 });
  await a.getByRole("button", { name: "Send a reaction" }).click();
  await a.locator(".call-picker button").first().click();
  await b.locator(".call-emoji").waitFor({ timeout: 8000 });
  await a.getByRole("button", { name: "Share your screen" }).click();
  await a.locator(".screen-tile").waitFor({ timeout: 10000 });
  await b.locator(".screen-tile video").waitFor({ timeout: 15000 });
  await b.waitForFunction(
    () => {
      const v = document.querySelector(".screen-tile video");
      return v && v.videoWidth > 0;
    },
    null,
    { timeout: 15000 },
  );
  console.log("hand, reaction and screen share reach the other side");
  // A new message must not interrupt the share.
  await call(
    "messages",
    {
      project_key: project,
      sender_name: people.lena.identity,
      to: ["NavyRaven"],
      subject: "Re: Docs search shows old pages after the move",
      body_md: "message during the share",
      thread_id: (
        await call("messages?project=" + project, null, people.lena.cookie)
      ).json[0].thread_id,
    },
    people.lena.cookie,
  );
  await a
    .getByText("message during the share")
    .first()
    .waitFor({ timeout: 10000 });
  await a.waitForTimeout(2500);
  for (const p of [a, b])
    assert.ok(
      await p.evaluate(() => {
        const v = document.querySelector(".screen-tile video");
        return !!v && v.videoWidth > 0 && !v.paused;
      }),
      "the shared screen is still playing after a message",
    );
  console.log("sending a message does not interrupt the screen share");
  await a.getByRole("button", { name: "Stop sharing" }).click();
  await b.waitForFunction(() => !document.querySelector(".screen-tile"), null, {
    timeout: 10000,
  });
  console.log("stopping the share removes it");
  // Camera on: the other person sees video in that tile instead of the avatar.
  await a.getByRole("button", { name: "Turn on camera" }).click();
  await b.waitForFunction(
    () => {
      const v = document.querySelector(".call-tile:not(.screen-tile) video");
      return v && v.videoWidth > 0;
    },
    null,
    { timeout: 15000 },
  );
  console.log("camera video reaches the other side");
  await a.screenshot({ path: "call-check.png" });
  await a.getByRole("button", { name: "Turn off camera" }).click();
  console.log("status:", await a.locator(".call-time").innerText());
  await b.getByRole("button", { name: "Leave call" }).first().click();
  await a.waitForFunction(
    () => document.querySelectorAll(".call-tile").length === 1,
    null,
    { timeout: 8000 },
  );
  console.log("leave ok");
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(dir, { recursive: true, force: true });
}
