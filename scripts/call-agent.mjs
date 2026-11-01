// An agent that talks in a Dispatch call. It joins the channel's call, follows the transcript, asks a small model
// for a short spoken reply and says it. People turn on captions in the call so their speech reaches it.
//
//   DISPATCH_URL=https://dispatch.example.com \
//   DISPATCH_AGENT_KEY=at_... \
//   ANTHROPIC_API_KEY=sk-ant-... \
//   node scripts/call-agent.mjs
//
// Optional: CALL_MODEL (default claude-haiku-5-5, cheap and quick), CALL_PERSONA (extra instructions),
// DISPATCH_PROJECT (project id or name; defaults to the agent's own project).
const base = (process.env.DISPATCH_URL || "").replace(/\/$/, ""),
  key = process.env.DISPATCH_AGENT_KEY,
  model = process.env.CALL_MODEL || "claude-haiku-5-5",
  persona = process.env.CALL_PERSONA || "";
// Answers come from the Anthropic API (ANTHROPIC_API_KEY), or from the Claude Code you are signed in to
// (CALL_BACKEND=claude, which needs no API key and uses its small model).
const viaCli = process.env.CALL_BACKEND === "claude";
if (!base || !key || (!viaCli && !process.env.ANTHROPIC_API_KEY)) {
  console.error("Set DISPATCH_URL, DISPATCH_AGENT_KEY and either ANTHROPIC_API_KEY or CALL_BACKEND=claude.");
  process.exit(1);
}

let session = null,
  id = 0;
async function post(body, withSession = true) {
  return fetch(base + "/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer " + key,
      ...(withSession && session ? { "Mcp-Session-Id": session } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function open() {
  const res = await post(
    {
      jsonrpc: "2.0",
      id: ++id,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "dispatch-call-agent", version: "1" } },
    },
    false,
  );
  session = res.headers.get("mcp-session-id");
  await res.text();
  await post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
}
async function tool(name, args, again = true) {
  if (!session) await open();
  const text = await (await post({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } })).text();
  const line = text.includes("data:") ? text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5) : text;
  const msg = JSON.parse(line);
  if (msg.error && again && /session/i.test(JSON.stringify(msg.error))) {
    session = null;
    return tool(name, args, false);
  }
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  const out = msg.result.content?.[0]?.text;
  if (msg.result.isError) throw new Error(out);
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

const projects = await tool("list_projects", {});
const list = Array.isArray(projects) ? projects : projects.projects;
const project = (list.find((p) => p.id === process.env.DISPATCH_PROJECT || p.name === process.env.DISPATCH_PROJECT) || list[0]).id;
const self = (await tool("register_agent", { project_key: project })).name;
console.log(`${self} joining ${base}`);

const system = `You are ${self}, an AI teammate taking part in a voice call. You get what people say as captions, one line per sentence, with the speaker's name.
Reply the way you would speak: one or two short sentences, no lists, no markdown, no emoji.
Only reply when someone speaks to you (by name, or a question clearly meant for you) or asks the group something you can help with. If the line is people talking to each other, answer exactly: [silence]
${persona}`.trim();

const history = [];
async function think(lines) {
  for (const l of lines) history.push({ role: "user", content: `${l.name}: ${l.text}` });
  // The model needs alternating turns, so fold the history into one user message.
  const convo = history.slice(-16).map((m) => m.content).join("\n");
  if (viaCli) {
    const { spawnSync } = await import("node:child_process");
    const run = spawnSync(
      "claude",
      ["-p", "--model", "haiku", "--no-session-persistence", "--system-prompt", system, convo],
      { encoding: "utf8", cwd: (await import("node:os")).tmpdir(), shell: process.platform === "win32" },
    );
    if (run.status !== 0) throw new Error((run.stdout || run.stderr || "claude failed").trim().slice(0, 200));
    return run.stdout.trim();
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 160, system, messages: [{ role: "user", content: convo }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data).slice(0, 200));
  return (data.content?.[0]?.text || "").trim();
}

let seq = 0,
  joined = false;
for (;;) {
  try {
    if (!joined) {
      await tool("call_join", { project_key: project });
      joined = true;
      console.log("in the call");
    }
    const r = await tool("call_listen", { project_key: project, after_seq: seq, wait_seconds: 20 });
    seq = r.next_seq;
    let lines = r.lines.filter((l) => l.kind === "say" && !l.agent);
    if (!lines.length) continue;
    // Give the person a moment to finish the thought before answering.
    const more = await tool("call_listen", { project_key: project, after_seq: seq, wait_seconds: 2 });
    seq = more.next_seq;
    lines = lines.concat(more.lines.filter((l) => l.kind === "say" && !l.agent));
    const reply = await think(lines);
    console.log(lines.map((l) => `${l.name}: ${l.text}`).join(" | "), "->", reply);
    if (reply && !/^\[silence\]/i.test(reply)) {
      history.push({ role: "user", content: `${self}: ${reply}` });
      await tool("call_say", { project_key: project, text: reply });
    }
  } catch (e) {
    console.error("error:", e.message);
    joined = /Join the call first/.test(e.message) ? false : joined;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
