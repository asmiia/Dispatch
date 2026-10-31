// Regenerates docs/screenshots/*.png from a throwaway server with demo data.
// Needs `npm run build` first and Google Chrome installed. Usage: npm run screenshots
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

  const call = async (path, body, cookie) => {
    const r = await fetch(origin + "/api/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { r, json: await r.json() };
  };

  // Demo data: one team, one project, three agents, a short thread with an attachment.
  const reg = await call("auth/register", {
    email: "demo@example.com",
    name: "Demo Admin",
    password,
    setup_key: setup,
  });
  const cookie = reg.r.headers.get("set-cookie").split(";")[0];
  const session = cookie.split("=")[1];
  await call("auth", {
    email: "demo@example.com",
    password: "not the password",
  }); // one failed sign-in for the Activity page
  const project = (await call("projects", { name: "launch-prep" }, cookie)).json
    .id;
  for (const [name, program, model] of [
    ["NavyRaven", "claude-code", "opus"],
    ["IcyHorizon", "codex", "gpt-5"],
    ["CopperGrove", "gemini-cli", "gemini-pro"],
  ])
    await call(
      "agents",
      { project_key: project, name, program, model },
      cookie,
    );
  const file = (
    await call(
      "files",
      {
        project_key: project,
        filename: "deploy-report.txt",
        data_base64: Buffer.from("All 14 checks passed.\n").toString("base64"),
      },
      cookie,
    )
  ).json;
  const first = (
    await call(
      "messages",
      {
        project_key: project,
        sender_name: "NavyRaven",
        to: ["IcyHorizon", "CopperGrove"],
        subject: "Release checklist for v0.1.0-alpha",
        body_md:
          "## Status\n\nThe build is green and the staging deploy finished.\n\n- [x] Migrations applied\n- [x] Backups verified\n- [ ] Security review sign-off\n\nReport attached. Reply here if anything looks off.",
        importance: "high",
        attachment_paths: [file.id],
      },
      cookie,
    )
  ).json;
  await call(
    "messages",
    {
      project_key: project,
      sender_name: "IcyHorizon",
      to: ["NavyRaven"],
      subject: "Re: Release checklist for v0.1.0-alpha",
      body_md:
        "Reviewed the report. I'll finish the **security review** tonight and post the notes in this thread.",
      thread_id: first.thread_id,
    },
    cookie,
  );
  await call(
    "messages",
    {
      project_key: project,
      sender_name: "CopperGrove",
      to: ["NavyRaven", "IcyHorizon"],
      subject: "Docs are updated",
      body_md:
        "README and the MCP guide now describe `events_since`, backups and sign-in options.",
    },
    cookie,
  );
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

  for (const theme of ["dark", "light"]) {
    const login = await open(theme, false);
    await login.page.getByRole("button", { name: /Open Dispatch/ }).waitFor();
    await shot(login.page, `login-${theme}`);
    await login.context.close();

    const app = await open(theme, true);
    await app.page
      .getByText("Release checklist for v0.1.0-alpha")
      .first()
      .click();
    await app.page.getByText("Security review sign-off").first().waitFor();
    await shot(app.page, `inbox-${theme}`);
    await app.context.close();
  }

  // Settings pages (modal over the workspace).
  const settings = async (theme, tab, prepare) => {
    const { context, page } = await open(theme, true);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: tab, exact: true }).click();
    if (prepare) await prepare(page);
    await page.waitForTimeout(500);
    await shot(
      page,
      `settings-${tab.toLowerCase().replace(/\s+/g, "-")}-${theme}`,
    );
    await context.close();
  };
  await settings("dark", "Security", async (page) => {
    await page.getByLabel("Confirm your password to begin").fill(password);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    await page.getByRole("img", { name: /QR code/ }).waitFor();
  });
  await settings("light", "Activity", (page) =>
    page.getByText("Recent sign-ins").waitFor(),
  );
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
  console.log("Screenshots written to " + out);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(dir, { recursive: true, force: true });
  rmSync(dir + "-backups", { recursive: true, force: true });
}
