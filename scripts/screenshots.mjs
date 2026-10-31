// Regenerates docs/screenshots/*.png from a throwaway server with demo data.
// Needs `npm run build` first and Google Chrome installed. Usage: npm run screenshots
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { seed } from "./demo-seed.mjs";

const dir = mkdtempSync(join(tmpdir(), "dispatch-shots-")),
  setup = randomBytes(32).toString("hex"),
  port = 3090,
  origin = `http://127.0.0.1:${port}`,
  out = resolve("docs/screenshots"),
  password = "demo password 12345";
mkdirSync(out, { recursive: true });

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
      DISPATCH_BACKUP_DIR: dir + "-backups",
      DISPATCH_BACKUP_PASSPHRASE: "demo-only",
      DISPATCH_BACKUP_INTERVAL_HOURS: "24",
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
  const { call, people } = await seed({ origin, setupKey: setup, password });
  const cookie = people.maya.cookie,
    session = cookie.split("=")[1];
  await call("settings/backups/run", {}, cookie);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const open = async (theme, signedIn) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1.5,
    });
    await context.addInitScript(
      (t) => localStorage.setItem("dispatch-theme", t),
      theme,
    );
    if (signedIn)
      await context.addCookies([
        { name: "dispatch_session", value: session, url: origin },
      ]);
    const page = await context.newPage();
    await page.goto(origin);
    return { context, page };
  };
  const shot = (page, name) =>
    page.screenshot({ path: join(out, name + ".png") });
  const thread = async (page) => {
    await page
      .getByText("Checkout broke after yesterday's deploy")
      .first()
      .click();
    await page.getByText("Billing spec matches").first().waitFor();
    await page.locator(".bubble img").first().waitFor();
    await page.waitForTimeout(700);
  };

  for (const theme of ["dark", "light"]) {
    const login = await open(theme, false);
    await login.page.getByRole("button", { name: /Open Dispatch/ }).waitFor();
    await shot(login.page, `login-${theme}`);
    await login.context.close();

    const app = await open(theme, true);
    await thread(app.page);
    await shot(app.page, `inbox-${theme}`);
    await app.context.close();
  }

  // Settings pages (modal over the workspace).
  const settings = async (theme, tab, prepare) => {
    const { context, page } = await open(theme, true);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .locator(".settings-layout nav")
      .getByRole("button", { name: tab, exact: true })
      .click();
    if (prepare) await prepare(page);
    await page.waitForTimeout(600);
    await shot(
      page,
      `settings-${tab.toLowerCase().replace(/[^a-z]+/g, "-")}-${theme}`,
    );
    await context.close();
  };
  await settings("dark", "Members & invites", (page) =>
    page.getByText("James Lee").first().waitFor(),
  );
  await settings("dark", "Your account");
  await settings("dark", "Security", async (page) => {
    await page.getByLabel("Confirm your password to begin").fill(password);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    await page.getByRole("img", { name: /QR code/ }).waitFor();
  });
  await settings("light", "Activity", (page) =>
    page.getByText("Sign-ins", { exact: true }).first().waitFor(),
  );
  await settings("dark", "Overview");
  await settings("dark", "Backups", async (page) => {
    await page.getByRole("button", { name: "Back up now" }).waitFor();
    // The real temp path contains the local username; show a neutral one instead.
    await page.evaluate(() =>
      document.querySelectorAll("code").forEach((c) => {
        if (c.textContent.includes("dispatch-shots"))
          c.textContent = "/var/backups/dispatch";
      }),
    );
  });

  // Connecting an agent.
  {
    const { context, page } = await open("dark", true);
    await page.getByRole("button", { name: "Connect an agent" }).click();
    await page.getByRole("button", { name: /Create agent and key/ }).click();
    await page.getByRole("button", { name: "Copy" }).waitFor();
    // Never show a real key in a screenshot.
    await page.evaluate(() =>
      document.querySelectorAll(".connect-code pre").forEach((p) => {
        p.textContent = p.textContent
          .replace(/at_[\w-]+/g, "at_YOUR_AGENT_KEY")
          .replace(
            /http:\/\/127\.0\.0\.1:\d+/g,
            "https://dispatch.example.com",
          );
      }),
    );
    await page.waitForTimeout(300);
    await shot(page, "connect-agent-dark");
    await context.close();
  }
  console.log("Screenshots written to " + out);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(dir, { recursive: true, force: true });
  rmSync(dir + "-backups", { recursive: true, force: true });
}
