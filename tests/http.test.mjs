import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test(
  "real Next server: browser auth, CSRF, MCP send/upload/download and persistent receipts",
  { timeout: 60000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch-http-")),
      token = randomBytes(32).toString("hex");
    const server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3081",
      ],
      {
        cwd: resolve("."),
        env: {
          ...process.env,
          DISPATCH_SETUP_KEY: token,
          DISPATCH_DATA_DIR: dir,
          // Tests must never read .env.local or touch real backups.
          DISPATCH_BACKUP_DIR: dir + "-backups",
          DISPATCH_BACKUP_PASSPHRASE: "",
          DISPATCH_BACKUP_INTERVAL_HOURS: "0",
        },
        stdio: "pipe",
        windowsHide: true,
      },
    );
    let logs = "";
    server.stdout.on("data", (data) => {
      logs += data;
    });
    server.stderr.on("data", (data) => {
      logs += data;
    });
    const origin = "http://127.0.0.1:3081";
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          const r = await fetch(origin);
          if (r.ok) {
            ready = true;
            break;
          }
        } catch {}
        if (server.exitCode !== null) throw new Error(logs);
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready, logs);
      assert.equal((await fetch(origin + "/api/projects")).status, 401);
      assert.equal(
        (await fetch(origin + "/api/projects?token=" + token)).status,
        401,
      );
      const req = (path, body, headers = {}) =>
        fetch(origin + path, {
          method: body ? "POST" : "GET",
          headers: { "Content-Type": "application/json", ...headers },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      assert.equal(
        (
          await req("/api/auth", {
            email: "owner@example.com",
            password: "wrong",
          })
        ).status,
        401,
      );
      assert.equal(
        (await req("/api/auth", { token }, { Origin: "https://evil.example" }))
          .status,
        403,
      );
      const signed = await req(
        "/api/auth/register",
        {
          email: "owner@example.com",
          name: "Owner",
          password: "secure HTTP test password",
          setup_key: token,
        },
        { Origin: origin },
      );
      assert.equal(signed.status, 200);
      const setCookie = signed.headers.get("set-cookie");
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Strict/i);
      const cookie = { Cookie: setCookie.split(";")[0] },
        bearer = { Authorization: "Bearer " + token };
      let mcpAuth = cookie;
      assert.equal((await req("/api/projects", null, bearer)).status, 401);
      assert.equal((await req("/api/projects", null, cookie)).status, 200);
      assert.equal(
        (
          await req(
            "/api/projects",
            { name: "bad" },
            { ...cookie, Origin: "https://evil.example" },
          )
        ).status,
        403,
      );
      const rpc = async (method, params = {}) => {
        const r = await req(
          "/mcp",
          { jsonrpc: "2.0", id: 1, method, params },
          mcpAuth,
        );
        assert.equal(r.status, 200);
        return r.json();
      };
      const tool = async (name, args) => {
        const r = await rpc("tools/call", { name, arguments: args });
        assert.ok(!r.result.isError, JSON.stringify(r));
        return JSON.parse(r.result.content[0].text);
      };
      assert.equal(
        (await rpc("initialize")).result.serverInfo.name,
        "agent-team",
      );
      assert.ok((await rpc("tools/list")).result.tools.length >= 8);
      const p = await tool("ensure_project", { human_key: "HTTP integration" });
      await tool("register_agent", {
        project_key: p.id,
        name: "CopperGrove",
        program: "test",
        model: "test",
      });
      const credential = await (
        await req(
          "/api/settings/key",
          { project_key: p.id, agent_name: "CopperGrove", name: "HTTP test" },
          cookie,
        )
      ).json();
      assert.ok(credential.token);
      mcpAuth = { Authorization: "Bearer " + credential.token };
      const data = Buffer.from("attachment bytes \u0000\u00ff");
      const file = await tool("upload_attachment", {
        project_key: p.id,
        filename: "preview.zip",
        data_base64: data.toString("base64"),
      });
      const message = await tool("send_message", {
        project_key: p.id,
        sender_name: "CopperGrove",
        to: ["CopperGrove"],
        subject: "Files visible in web UI",
        body_md: "**Uploaded.**",
        attachment_paths: [file.path],
      });
      const inbox = await (
        await req("/api/messages?project=" + p.id, null, cookie)
      ).json();
      assert.equal(inbox[0].attachments[0].id, file.id);
      assert.equal((await fetch(origin + file.download_url)).status, 401);
      const downloaded = await req(file.download_url, null, cookie);
      assert.equal(downloaded.status, 200);
      assert.match(
        downloaded.headers.get("content-disposition"),
        /^attachment;/,
      );
      assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), data);
      assert.equal(
        (
          await req(
            "/api/messages/" + message.id + "/read",
            { agent_name: "CopperGrove" },
            cookie,
          )
        ).status,
        200,
      );
      const read = await tool("get_message", { message_id: message.id });
      assert.ok(read.recipients[0].read_at);
      const bad = await rpc("tools/call", {
        name: "send_message",
        arguments: {
          project_key: p.id,
          sender_name: "CopperGrove",
          to: ["CopperGrove"],
          subject: "Path",
          body_md: "bad",
          attachment_paths: ["C:\\Windows\\win.ini"],
        },
      });
      assert.ok(bad.result?.isError, JSON.stringify(bad));
      const me = await (await req("/api/me", null, cookie)).json();
      const teamB = await (
        await req("/api/settings/teams", { name: "Private team" }, cookie)
      ).json();
      const privateProject = await (
        await req(
          "/api/projects",
          { name: "Private project", team_id: teamB.id },
          cookie,
        )
      ).json();
      const invite = await (
        await req(
          "/api/settings/invite",
          {
            team_id: me.teams[0].id,
            email: "viewer@example.com",
            role: "viewer",
          },
          cookie,
        )
      ).json();
      const joined = await req("/api/auth/register", {
        email: "viewer@example.com",
        name: "Viewer",
        password: "secure viewer password",
        invite_code: invite.code,
      });
      assert.equal(joined.status, 200);
      const viewerCookie = {
        Cookie: joined.headers.get("set-cookie").split(";")[0],
      };
      assert.equal(
        (
          await req(
            "/api/agents?project=" + privateProject.id,
            null,
            viewerCookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await req(
            "/api/messages",
            {
              project_key: p.id,
              sender_name: "CopperGrove",
              to: ["CopperGrove"],
              subject: "Forbidden",
              body_md: "no",
            },
            viewerCookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/api/settings/key",
            { project_key: p.id, agent_name: "CopperGrove", name: "Forbidden" },
            viewerCookie,
          )
        ).status,
        403,
      );
      const forbidden = await rpc("tools/call", {
        name: "fetch_inbox",
        arguments: {
          project_key: privateProject.id,
          agent_name: "CopperGrove",
        },
      });
      assert.ok(forbidden.result.isError);
      await req("/api/settings/key/revoke", { id: credential.id }, cookie);
      assert.equal(
        (
          await req(
            "/mcp",
            { jsonrpc: "2.0", id: 1, method: "tools/list" },
            mcpAuth,
          )
        ).status,
        401,
      );
      await req("/api/logout", {}, cookie);
      assert.equal((await req("/api/projects", null, cookie)).status, 401);
    } finally {
      server.kill();
      if (server.exitCode === null) await once(server, "exit");
      for (let i = 0; i < 20; i++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
  },
);
