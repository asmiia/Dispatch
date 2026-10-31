import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "mail-browser-")),
  token = randomBytes(32).toString("hex");
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3082",
  ],
  {
    env: {
      ...process.env,
      DISPATCH_SETUP_KEY: token,
      DISPATCH_DATA_DIR: directory,
      // Tests must never read .env.local or touch real backups.
      DISPATCH_BACKUP_DIR: directory + "-backups",
      DISPATCH_BACKUP_PASSPHRASE: "",
      DISPATCH_BACKUP_INTERVAL_HOURS: "0",
    },
    stdio: "pipe",
    windowsHide: true,
  },
);
let logs = "";
server.stdout.on("data", (d) => {
  logs += d;
});
server.stderr.on("data", (d) => {
  logs += d;
});
let browser;
try {
  const origin = "http://127.0.0.1:3082";
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByLabel("Your name").fill("Owner");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("secure browser test password");
  await page.getByLabel("Setup key").fill(token);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("Example Project");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Register agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Agent name").fill("CopperGrove");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Register agent", exact: true })
    .click();
  await page.getByRole("button", { name: "Compose message" }).click();
  await page
    .locator(".recipients")
    .getByRole("button", { name: "CopperGrove" })
    .click();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("Preview files are ready");
  await page
    .locator("#body")
    .fill(
      "## Everything in one place\n\nThe project update is ready. The preview bundle is attached below.\n\n- Project decisions and next steps\n- Shared files and conversation history\n- Team access and agent credentials\n\n**Validation:** the preview checks passed. Team review is still pending.\n\nThis is an isolated browser-test conversation, not imported production mail.",
    );
  await page.locator("input[type=file]").setInputFiles({
    name: "preview-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Verified browser attachment download."),
  });
  await page.locator(".upload-chips").getByText("preview-notes.txt").waitFor();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.locator(".thread-heading h1").waitFor();
  const file = page.locator(".file-card");
  await file.waitFor();
  assert.equal(await file.locator("strong").textContent(), "preview-notes.txt");
  const downloadEvent = page.waitForEvent("download");
  await file.click();
  const download = await downloadEvent;
  assert.equal(
    readFileSync(await download.path()).toString(),
    "Verified browser attachment download.",
  );
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/mail-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.locator("#body").fill("Downloaded and verified.");
  // Self-addressed notes keep the current agent as the reply recipient.
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("2 messages in this thread", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Coordination", exact: true }).click();
  await page.getByRole("button", { name: "leases", exact: true }).click();
  await page.getByText("No active builds.", { exact: true }).waitFor();
  await page.getByLabel("Build name", { exact: true }).fill("browser-build");
  await page
    .getByRole("button", { name: "Acquire lease", exact: true })
    .click();
  await page.getByText("browser-build", { exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/coordination-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await page.getByText("No active builds.", { exact: true }).waitFor();
  const messageId = await page.evaluate(async () => {
    const projects = await (await fetch("/api/projects")).json();
    const messages = await (
      await fetch(
        "/api/messages?project=" +
          encodeURIComponent(projects[0].id) +
          "&agent=CopperGrove",
      )
    ).json();
    return messages[0].id;
  });
  await page.getByRole("button", { name: "threads", exact: true }).click();
  await page.getByLabel("Message ID", { exact: true }).fill(messageId);
  await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await page.getByText(/^Acknowledged/).waitFor();
  await page
    .getByRole("button", { name: "Read thread digest", exact: true })
    .click();
  await page
    .locator(".coordination")
    .getByText("Downloaded and verified.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "projects", exact: true }).click();
  await page
    .getByLabel("Project group name", { exact: true })
    .fill("Browser group");
  await page
    .getByRole("button", { name: "Create and link group", exact: true })
    .click();
  await page.getByText("Browser group", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Members & invites", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Invite teammate", exact: true })
    .click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("teammate@example.com");
  const roleSelect = page.getByRole("combobox", { name: "Role", exact: true });
  await roleSelect.click();
  await page
    .getByRole("option", { name: "Viewer — read only", exact: true })
    .waitFor();
  await page.screenshot({
    path: "artifacts/dropdown-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("option", { name: "Viewer — read only", exact: true })
    .click();
  assert.match(await roleSelect.innerText(), /Viewer/);
  await roleSelect.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  const invite = await page.getByLabel("Invite code").inputValue();
  assert.ok(invite.length > 30);
  assert.match(await page.getByLabel("Invite link").inputValue(), /\?invite=/);
  await page
    .getByRole("button", { name: "Agent credentials", exact: true })
    .click();
  await page
    .getByLabel("Key label", { exact: true })
    .fill("Desktop test agent");
  await page
    .getByRole("button", { name: "Create agent key", exact: true })
    .click();
  await page.locator(".secret-result code").waitFor();
  const key = await page.locator(".secret-result code").textContent();
  assert.ok(key.startsWith("at_"));
  await page
    .getByLabel("Token label", { exact: true })
    .fill("Management client test");
  await page
    .getByRole("button", { name: "Create personal MCP token", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector(".secret-result code")
      ?.textContent?.startsWith("at_user_"),
  );
  await page
    .getByRole("button", { name: "Instance admin", exact: true })
    .click();
  await page.getByText("owner@example.com", { exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/settings-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.setViewportSize({ width: 420, height: 860 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: "artifacts/mail-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "Browser passed: sign-in, project/agent creation, compose, file upload, visible download, cookie-authenticated byte check, replies, mobile layout, no page errors.",
  );
} finally {
  await browser?.close();
  server.kill();
  if (server.exitCode === null) await once(server, "exit");
  rmSync(directory, { recursive: true, force: true });
}
