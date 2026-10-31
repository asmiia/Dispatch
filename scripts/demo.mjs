// Records docs/demo.gif: an agent sends a message over MCP, it lands in the inbox, a person
// replies, and the agent reads it. Runs against a throwaway instance with demo data.
// Needs `npm run build` and Google Chrome. Usage: npm run demo [-- --frames <dir>]
import { chromium } from "@playwright/test";
import pngjs from "pngjs";
import gifenc from "gifenc";
const { PNG } = pngjs;
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "dispatch-demo-")),
  setup = randomBytes(32).toString("hex"),
  port = 3092,
  origin = `http://127.0.0.1:${port}`,
  password = "demo password 12345",
  framesDir = process.argv.includes("--frames") ? resolve(process.argv[process.argv.indexOf("--frames") + 1]) : null,
  size = { width: 1040, height: 600 };
if (framesDir) mkdirSync(framesDir, { recursive: true });

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
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

const frames = [];
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
      headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { r, json: await r.json() };
  };
  // An agent talking to Dispatch the way real agents do: MCP tool calls with an agent key.
  const mcp = async (token, name, args) => {
    const r = await fetch(origin + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + token },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const out = await r.json();
    if (out.error || out.result?.isError) throw new Error(JSON.stringify(out));
    return JSON.parse(out.result.content[0].text);
  };

  const reg = await call("auth/register", { email: "demo@example.com", name: "Demo Admin", password, setup_key: setup });
  const cookie = reg.r.headers.get("set-cookie").split(";")[0],
    session = cookie.split("=")[1];
  const project = (await call("projects", { name: "launch-prep" }, cookie)).json.id;
  for (const [name, program, model] of [
    ["NavyRaven", "claude-code", "opus"],
    ["IcyHorizon", "codex", "gpt-5"],
    ["CopperGrove", "gemini-cli", "gemini-pro"],
  ])
    await call("agents", { project_key: project, name, program, model }, cookie);
  const key = async (agent_name) =>
    (await call("settings/key", { project_key: project, agent_name, name: "demo", days: 1 }, cookie)).json.token;
  const navy = await key("NavyRaven");
  // Older traffic so the inbox is not empty.
  await call(
    "messages",
    { project_key: project, sender_name: "CopperGrove", to: ["IcyHorizon"], subject: "Docs are updated", body_md: "README and the MCP guide are up to date." },
    cookie,
  );

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: size });
  await context.addInitScript(() => localStorage.setItem("dispatch-theme", "dark"));
  await context.addCookies([{ name: "dispatch_session", value: session, url: origin }]);
  const page = await context.newPage();
  await page.goto(origin);
  await page.addStyleTag({
    content: `#demo-cap{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:92%;padding:10px 18px;border-radius:999px;background:#ededed;color:#111;font:600 14px var(--font-geist-sans),system-ui,sans-serif;box-shadow:0 10px 30px #000a;z-index:99999;white-space:nowrap}
      #demo-cap code{font:500 13px var(--font-geist-mono),monospace;background:#0000000f;padding:2px 6px;border-radius:5px}`,
  });
  const caption = (html) =>
    page.evaluate((h) => {
      let el = document.getElementById("demo-cap");
      if (!el) {
        el = document.createElement("div");
        el.id = "demo-cap";
        document.body.appendChild(el);
      }
      el.innerHTML = h;
    }, html);
  const toBottom = () => page.locator(".thread-scroll").evaluate((e) => e.scrollTo({ top: e.scrollHeight }));
  const snap = async (delay) => {
    const png = await page.screenshot();
    frames.push({ png, delay });
    if (framesDir) writeFileSync(join(framesDir, String(frames.length).padStart(2, "0") + ".png"), png);
  };

  // 1. The workspace, viewed as IcyHorizon.
  await page.locator(".agent-list").getByText("IcyHorizon").first().click();
  await page.getByText("Docs are updated").first().waitFor();
  await caption("Agents and people share one inbox");
  await page.waitForTimeout(400);
  await snap(2200);

  // 2. An agent sends a message over MCP; it appears (the UI refreshes on its own).
  await caption("NavyRaven sends a message over MCP: <code>send_message</code>");
  await snap(1400);
  const sent = await mcp(navy, "send_message", {
    project_key: project,
    sender_name: "NavyRaven",
    to: ["IcyHorizon"],
    subject: "Staging deploy is green. Ready to release?",
    body_md: "## Status\n\nThe staging deploy finished and all checks passed.\n\n- Migrations applied\n- Backups verified\n\nShall I tag the release?",
    importance: "high",
  });
  await page.getByText("Staging deploy is green").first().waitFor({ timeout: 20000 });
  await caption("It lands in the team inbox");
  await page.waitForTimeout(300);
  await snap(2200);

  // 3. Open it.
  await page.getByText("Staging deploy is green").first().click();
  await page.getByText("Shall I tag the release?").first().waitFor();
  await caption("People read the same conversation the agents do");
  await page.waitForTimeout(300);
  await snap(2600);

  // 4. Reply from the web UI, typed live.
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.locator("#body").waitFor();
  await caption("You reply from the web app");
  await snap(900);
  const reply = "Looks good. Tag it, and post the release notes in this thread.";
  for (let i = 0; i < reply.length; i += 7) {
    await page.locator("#body").pressSequentially(reply.slice(i, i + 7));
    await snap(i + 7 >= reply.length ? 1200 : 220);
  }
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("2 messages in this thread", { exact: true }).waitFor();
  await caption("Sent");
  await toBottom();
  await page.waitForTimeout(300);
  await snap(1500);

  // 5. The agent picks it up over MCP; read receipts update.
  await caption("NavyRaven reads it over MCP: <code>fetch_inbox</code>");
  await snap(1200);
  const inbox = await mcp(navy, "fetch_inbox", { project_key: project, agent_name: "NavyRaven" });
  const list = Array.isArray(inbox) ? inbox : Object.values(inbox).find(Array.isArray) || [];
  const incoming = list.find((m) => m.sender_name === "IcyHorizon");
  if (!incoming) throw new Error("Agent inbox did not contain the reply: " + JSON.stringify(inbox).slice(0, 300));
  await mcp(navy, "mark_message_read", { message_id: incoming.id, agent_name: "NavyRaven" });
  await page.getByText(/Read by NavyRaven/).first().waitFor({ timeout: 20000 });
  await caption("Read receipts update for everyone");
  await toBottom();
  await page.waitForTimeout(300);
  await snap(2400);

  await caption("Dispatch: self-hosted, one process, MCP-native");
  await snap(2800);
  void sent;

  // Encode. One palette for every frame keeps the file small.
  const decoded = frames.map((f) => PNG.sync.read(f.png));
  const { width, height } = decoded[0];
  const sample = Buffer.concat([0, Math.floor(decoded.length / 3), Math.floor((2 * decoded.length) / 3), decoded.length - 1].map((i) => decoded[i].data));
  const palette = quantize(sample, 256);
  const gif = GIFEncoder();
  decoded.forEach((png, i) => {
    gif.writeFrame(applyPalette(png.data, palette), width, height, { palette: i === 0 ? palette : undefined, delay: frames[i].delay, repeat: 0 });
  });
  gif.finish();
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/demo.gif", gif.bytes());
  console.log(`docs/demo.gif: ${frames.length} frames, ${(gif.bytes().length / 1048576).toFixed(1)} MiB`);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
  rmSync(dir, { recursive: true, force: true });
  rmSync(dir + "-b", { recursive: true, force: true });
}
