import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
test(
  "official MCP client: sessions, tools, resources, prompts, SSE, subscription isolation, termination and revocation",
  { timeout: 60000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "team-mcp-client-")),
      token = randomBytes(32).toString("hex"),
      origin = "http://127.0.0.1:3083";
    const server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3083",
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
    let client, transport;
    try {
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
      const api = async (path, body, cookie) => {
        const r = await fetch(origin + "/api/" + path, {
          method: body ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.equal(
          r.status >= 200 && r.status < 300,
          true,
          await r.clone().text(),
        );
        return {
          value: await r.json(),
          cookie: r.headers.get("set-cookie")?.split(";")[0],
        };
      };
      const signed = await api("auth/register", {
          email: "owner@example.com",
          name: "Owner",
          password: "MCP test password secure",
          setup_key: token,
        }),
        cookie = signed.cookie;
      const { value: me } = await api("me", null, cookie),
        team = me.teams[0];
      const { value: project } = await api(
        "projects",
        { name: "SDK project", team_id: team.id },
        cookie,
      );
      for (const name of ["SilverPine", "CopperGrove", "BlueLake"])
        await api("agents", { project_key: project.id, name }, cookie);
      const { value: key } = await api(
        "settings/key",
        { project_key: project.id, agent_name: "SilverPine", name: "SDK test" },
        cookie,
      );
      const { value: otherKey } = await api(
        "settings/key",
        {
          project_key: project.id,
          agent_name: "BlueLake",
          name: "Other identity",
        },
        cookie,
      );
      client = new Client(
        { name: "sdk-integration", version: "1" },
        { capabilities: {} },
      );
      const updates = [];
      let notify;
      const notification = new Promise((resolve) => {
        notify = resolve;
      });
      client.setNotificationHandler(
        ResourceUpdatedNotificationSchema,
        (event) => {
          updates.push(event.params.uri);
          notify(event.params.uri);
        },
      );
      transport = new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer " + key.token } },
      });
      await client.connect(transport);
      assert.ok(transport.sessionId);
      const catalog = await client.listTools();
      assert.ok(catalog.tools.some((t) => t.name === "download_attachment"));
      assert.ok(catalog.tools.some((t) => t.name === "file_reservation_paths"));
      assert.ok(!catalog.tools.some((t) => t.name === "invite_member"));
      const resources = await client.listResources();
      assert.ok(resources.resources.some((r) => r.name === "SilverPine inbox"));
      assert.ok(
        (await client.listResourceTemplates()).resourceTemplates.length >= 6,
      );
      assert.equal((await client.listPrompts()).prompts.length, 3);
      const uri = `agent-team://projects/${project.id}/inbox/SilverPine`;
      await client.subscribeResource({ uri });
      await assert.rejects(() =>
        client.subscribeResource({
          uri: `agent-team://projects/${project.id}/inbox/BlueLake`,
        }),
      );
      const hijack = await fetch(origin + "/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + otherKey.token,
          "Content-Type": "application/json",
          "mcp-session-id": transport.sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(hijack.status, 404);
      await api(
        "messages",
        {
          project_key: project.id,
          sender_name: "CopperGrove",
          to: ["BlueLake"],
          subject: "Private to another agent",
          body_md: "Not for SilverPine",
        },
        cookie,
      );
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(updates.length, 0);
      await api(
        "messages",
        {
          project_key: project.id,
          sender_name: "CopperGrove",
          to: ["SilverPine"],
          subject: "Subscription test",
          body_md: "An actual event",
        },
        cookie,
      );
      const received = await Promise.race([
        notification,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("No SSE update received")), 8000),
        ),
      ]);
      assert.equal(received, uri);
      const inbox = await client.readResource({ uri });
      const parsed = JSON.parse(inbox.contents[0].text);
      assert.equal(parsed.messages.length, 1);
      const prompt = await client.getPrompt({
        name: "review_inbox",
        arguments: { project_key: project.id, agent_name: "SilverPine" },
      });
      assert.match(prompt.messages[0].content.text, /untrusted project data/);
      const reply = await client.callTool({
        name: "reply_message",
        arguments: {
          message_id: parsed.messages[0].id,
          body_md: "Received through the SDK.",
        },
      });
      assert.ok(!reply.isError);
      const held = await client.callTool({
        name: "file_reservation_paths",
        arguments: { project_key: project.id, paths: ["src/example.js"] },
      });
      assert.equal(JSON.parse(held.content[0].text).granted.length, 1);
      await client.unsubscribeResource({ uri });
      const count = updates.length;
      await api(
        "messages",
        {
          project_key: project.id,
          sender_name: "CopperGrove",
          to: ["SilverPine"],
          subject: "No subscription",
          body_md: "Should not notify this URI",
        },
        cookie,
      );
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(updates.length, count);
      const sessionId = transport.sessionId;
      await transport.terminateSession();
      const gone = await fetch(origin + "/mcp", {
        method: "GET",
        headers: {
          Authorization: "Bearer " + key.token,
          "mcp-session-id": sessionId,
          Accept: "text/event-stream",
        },
      });
      assert.equal(gone.status, 404);
      await client.close();
      client = null;
      const stdio = new Client(
        { name: "stdio-integration", version: "1" },
        { capabilities: {} },
      );
      try {
        const stdioTransport = new StdioClientTransport({
          command: process.execPath,
          args: ["scripts/mcp-stdio.mjs"],
          env: {
            ...process.env,
            DISPATCH_TOKEN: key.token,
            DISPATCH_MCP_URL: origin + "/mcp",
          },
          stderr: "pipe",
        });
        await stdio.connect(stdioTransport);
        assert.ok(
          (await stdio.listTools()).tools.some((t) => t.name === "get_thread"),
        );
        assert.ok(
          (await stdio.listResources()).resources.some(
            (r) => r.name === "SilverPine inbox",
          ),
        );
      } finally {
        await stdio.close();
      }
      const { value: personal } = await api(
        "settings/personal-key",
        { team_id: team.id, name: "User MCP management" },
        cookie,
      );
      client = new Client(
        { name: "user-sdk", version: "1" },
        { capabilities: {} },
      );
      transport = new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer " + personal.token } },
      });
      await client.connect(transport);
      assert.ok(
        (await client.listTools()).tools.some(
          (t) => t.name === "invite_member",
        ),
      );
      const invite = await client.callTool({
        name: "invite_member",
        arguments: {
          team_id: team.id,
          email: "new@example.com",
          role: "member",
        },
      });
      assert.ok(JSON.parse(invite.content[0].text).code);
      await api("settings/personal-key/revoke", { id: personal.id }, cookie);
      await assert.rejects(() => client.listTools());
    } finally {
      await client?.close().catch(() => {});
      server.kill();
      if (server.exitCode === null) await once(server, "exit");
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
