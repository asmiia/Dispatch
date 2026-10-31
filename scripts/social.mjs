// Renders docs/social-preview.png (1280x640), the card GitHub shows when the repo link is shared.
// Upload it in the repository's Settings > General > Social preview. Usage: npm run social
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const b64 = (path) => readFileSync(resolve(path)).toString("base64");
const regular = b64("node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2");
const bold = b64("node_modules/geist/dist/fonts/geist-sans/Geist-Bold.woff2");
const shot = b64("docs/screenshots/inbox-dark.png");

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:G;src:url(data:font/woff2;base64,${regular});font-weight:400}
@font-face{font-family:G;src:url(data:font/woff2;base64,${bold});font-weight:700}
*{box-sizing:border-box;margin:0}
body{width:1280px;height:640px;background:#000;color:#ededed;font-family:G,system-ui,sans-serif;overflow:hidden;position:relative}
.glow{position:absolute;inset:0;background:radial-gradient(ellipse 70% 80% at 85% 50%,#ffffff14,transparent 70%)}
.left{position:absolute;left:72px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;gap:26px}
.brand{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:650;letter-spacing:-1px}
.mark{width:56px;height:56px;border-radius:14px;background:#f2f2f2;display:grid;place-items:center}
h1{font-size:60px;line-height:1.04;font-weight:700;letter-spacing:-2.4px}
p{font-size:25px;line-height:1.4;color:#a1a1a1;max-width:520px}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chips span{border:1px solid #2e2e2e;border-radius:999px;padding:8px 16px;font-size:19px;color:#d4d4d4}
.shot{position:absolute;left:690px;top:84px;width:760px;border-radius:14px;border:1px solid #2e2e2e;box-shadow:0 40px 100px #000c;transform:rotate(-2deg)}
</style><div class="glow"></div>
<div class="left">
  <div class="brand"><div class="mark"><svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M3 11 21 3l-8 18-2-8-8-2Z" fill="#111"/><path d="m11 13 10-10" stroke="#f2f2f2" stroke-width="1.6" stroke-linecap="round"/></svg></div>Dispatch</div>
  <h1>Slack for your<br>AI agents.</h1>
  <p>Shared inboxes, threads and files for your team and your agents.</p>
  <div class="chips"><span>MCP-native</span><span>Self-hosted</span><span>One process</span></div>
</div>
<img class="shot" src="data:image/png;base64,${shot}">`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync("docs", { recursive: true });
  await page.screenshot({ path: "docs/social-preview.png" });
  console.log("docs/social-preview.png written");
} finally {
  await browser.close();
}
