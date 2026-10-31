import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { base32, code, verify } from "../lib/totp.mjs";

test("TOTP matches the RFC 6238 vector and rejects wrong codes", () => {
  const secret = base32(Buffer.from("12345678901234567890"));
  assert.equal(code(secret, Math.floor(59 / 30), 8), "94287082");
  const now = Date.now();
  const step = Math.floor(now / 30000);
  assert.equal(verify(secret, code(secret, step), now), step);
  assert.equal(verify(secret, code(secret, step + 5), now), null);
  assert.equal(verify(secret, "abc123", now), null);
});

test("emailed links never use an attacker-controlled Host header", async () => {
  const { trustedOrigin } = await import("../lib/http.mjs");
  const saved = process.env.DISPATCH_ORIGIN;
  try {
    delete process.env.DISPATCH_ORIGIN;
    assert.equal(
      trustedOrigin(new Request("https://evil.example/api/auth/forgot")),
      null,
    );
    assert.equal(
      trustedOrigin(new Request("http://127.0.0.1:3080/")),
      "http://127.0.0.1:3080",
    );
    process.env.DISPATCH_ORIGIN = "https://dispatch.example.com";
    assert.equal(
      trustedOrigin(new Request("https://evil.example/")),
      "https://dispatch.example.com",
    );
  } finally {
    if (saved === undefined) delete process.env.DISPATCH_ORIGIN;
    else process.env.DISPATCH_ORIGIN = saved;
  }
});

test(
  "real server: health, 2FA, recovery codes, password reset, sign-in log, event replay, OAuth guards",
  { timeout: 90000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch-accounts-")),
      setup = randomBytes(32).toString("hex"),
      port = 3085,
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
        cwd: resolve("."),
        env: {
          ...process.env,
          DISPATCH_SETUP_KEY: setup,
          DISPATCH_DATA_DIR: dir,
          // Tests must never read .env.local or touch real backups.
          DISPATCH_BACKUP_DIR: dir + "-backups",
          DISPATCH_BACKUP_PASSPHRASE: "",
          DISPATCH_BACKUP_INTERVAL_HOURS: "24",
          DISPATCH_GITHUB_CLIENT_ID: "test-client",
          DISPATCH_GITHUB_CLIENT_SECRET: "test-secret",
          // Emails are written to this file instead of being sent.
          DISPATCH_MAIL_FILE: dir + "-mail.jsonl",
          DISPATCH_LOG_LEVEL: "error",
        },
        stdio: "pipe",
        windowsHide: true,
      },
    );
    let logs = "";
    server.stdout.on("data", (d) => (logs += d));
    server.stderr.on("data", (d) => (logs += d));
    try {
      let ready = false;
      for (let i = 0; i < 100 && !ready; i++) {
        try {
          ready = (await fetch(origin + "/health")).ok;
        } catch {}
        if (server.exitCode !== null) throw new Error(logs);
        if (!ready) await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready, logs);

      const health = await (await fetch(origin + "/health")).json();
      // Unknown pages send people home; real endpoints are untouched.
      const lost = await fetch(origin + "/no/such/page", {
        redirect: "manual",
      });
      assert.equal(lost.status, 307);
      assert.equal(new URL(lost.headers.get("location"), origin).pathname, "/");
      assert.equal(
        (await fetch(origin + "/health", { redirect: "manual" })).status,
        200,
      );
      assert.equal(health.status, "ok");

      const req = (path, body, headers = {}) =>
        fetch(origin + path, {
          method: body ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            ...headers,
          },
          redirect: "manual",
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      const status = await (await req("/api/auth/status")).json();
      assert.deepEqual(status.oauth, ["github"]);
      assert.equal(status.email, true);

      const password = "correct horse battery 1";
      const reg = await req("/api/auth/register", {
        email: "admin@example.com",
        name: "Admin",
        password,
        setup_key: setup,
      });
      assert.equal(reg.status, 200);
      const cookie = { Cookie: reg.headers.get("set-cookie").split(";")[0] };

      // Sessions: list devices, sign one out, sign out all the others.
      const login2 = await req("/api/auth", {
        email: "admin@example.com",
        password,
      });
      const cookie2 = {
        Cookie: login2.headers.get("set-cookie").split(";")[0],
      };
      const devices = await (
        await req("/api/settings/sessions", null, cookie)
      ).json();
      assert.equal(devices.length, 2);
      assert.equal(devices.filter((d) => d.current).length, 1);
      assert.equal(
        (
          await req(
            "/api/settings/sessions/revoke",
            { id: "0000000000000000" },
            cookie,
          )
        ).status,
        404,
      );
      const other = devices.find((d) => !d.current);
      assert.equal(
        (await req("/api/settings/sessions/revoke", { id: other.id }, cookie))
          .status,
        200,
      );
      assert.equal((await req("/api/me", null, cookie2)).status, 401);
      const login3 = await req("/api/auth", {
        email: "admin@example.com",
        password,
      });
      const cookie3 = {
        Cookie: login3.headers.get("set-cookie").split(";")[0],
      };
      const cut = await (
        await req("/api/settings/sessions/revoke-others", {}, cookie)
      ).json();
      assert.equal(cut.revoked, 1);
      assert.equal((await req("/api/me", null, cookie3)).status, 401);
      assert.equal((await req("/api/me", null, cookie)).status, 200);

      // Failed sign-ins are rejected and show up in the admin activity view.
      assert.equal(
        (
          await req("/api/auth", {
            email: "admin@example.com",
            password: "nope nope nope",
          })
        ).status,
        401,
      );
      const activity = await (
        await req("/api/settings/activity", null, cookie)
      ).json();
      assert.ok(activity.stats.failed_24h >= 1);
      assert.ok(activity.logins.some((l) => !l.ok && l.method === "password"));
      assert.ok(!JSON.stringify(activity).includes("nope nope"));

      // Backups: admins can see status and run one; the snapshot verifies; nobody else can.
      const before = await (
        await req("/api/settings/backups", null, cookie)
      ).json();
      assert.equal(before.backups.length, 0);
      assert.equal(before.enabled, true);
      const ran = await req("/api/settings/backups/run", {}, cookie);
      assert.equal(ran.status, 200);
      const after = await (
        await req("/api/settings/backups", null, cookie)
      ).json();
      assert.equal(after.backups.length, 1);
      assert.equal(after.backups[0].stamp, (await ran.json()).stamp);
      assert.equal((await req("/api/settings/backups")).status, 401);

      // Enable two-factor.
      // Enrolling requires the current password, so a stolen session can't add its own authenticator.
      assert.equal(
        (await req("/api/settings/mfa/start", {}, cookie)).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/api/settings/mfa/start",
            { password: "wrong wrong wrong" },
            cookie,
          )
        ).status,
        403,
      );
      const start = await (
        await req("/api/settings/mfa/start", { password }, cookie)
      ).json();
      assert.match(start.secret, /^[A-Z2-7]{32}$/);
      assert.ok(start.qr.length > 20);
      const step = () => Math.floor(Date.now() / 30000);
      assert.equal(
        (await req("/api/settings/mfa/confirm", { code: "000000" }, cookie))
          .status,
        403,
      );
      const confirm = await (
        await req(
          "/api/settings/mfa/confirm",
          { code: code(start.secret, step()) },
          cookie,
        )
      ).json();
      assert.equal(confirm.recovery_codes.length, 8);

      // Password sign-in now stops at a challenge and sets no cookie.
      const gate = await req("/api/auth", {
        email: "admin@example.com",
        password,
      });
      const challenge = await gate.json();
      assert.equal(challenge.mfa_required, true);
      assert.equal(gate.headers.get("set-cookie"), null);
      assert.equal(
        (
          await req("/api/auth/mfa", {
            challenge: challenge.challenge,
            code: "123456",
          })
        ).status,
        401,
      );
      // The code used to enable 2FA cannot be replayed; the next time step works.
      const replay = await req("/api/auth/mfa", {
        challenge: challenge.challenge,
        code: code(start.secret, step()),
      });
      assert.equal(replay.status, 401);
      const good = await req("/api/auth/mfa", {
        challenge: challenge.challenge,
        code: code(start.secret, step() + 1),
      });
      assert.equal(good.status, 200);
      const mfaCookie = {
        Cookie: good.headers.get("set-cookie").split(";")[0],
      };
      assert.equal((await req("/api/me", null, mfaCookie)).status, 200);

      // A recovery code works once.
      const recovery = confirm.recovery_codes[0];
      const second = await (
        await req("/api/auth", { email: "admin@example.com", password })
      ).json();
      assert.equal(
        (
          await req("/api/auth/mfa", {
            challenge: second.challenge,
            code: recovery,
          })
        ).status,
        200,
      );
      const third = await (
        await req("/api/auth", { email: "admin@example.com", password })
      ).json();
      assert.equal(
        (
          await req("/api/auth/mfa", {
            challenge: third.challenge,
            code: recovery,
          })
        ).status,
        401,
      );
      assert.equal(
        (await req("/api/settings/security", null, cookie)).status,
        200,
      );
      assert.equal(
        (await (await req("/api/settings/security", null, cookie)).json())
          .recovery_left,
        7,
      );

      // Invite a second user and reset their password with an admin-issued link.
      const team = (await (await req("/api/me", null, cookie)).json()).teams[0]
        .id;
      const invite = await (
        await req(
          "/api/settings/invite",
          { team_id: team, email: "dev@example.com", role: "member" },
          cookie,
        )
      ).json();
      assert.equal(invite.emailed, true);
      const mails = () =>
        existsSync(dir + "-mail.jsonl")
          ? readFileSync(dir + "-mail.jsonl", "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((l) => JSON.parse(l))
          : [];
      const inviteMail = mails().at(-1);
      assert.equal(inviteMail.to, "dev@example.com");
      assert.ok(
        inviteMail.text.includes("/?invite=" + encodeURIComponent(invite.code)),
      );
      const joined = await req("/api/auth/register", {
        email: "dev@example.com",
        name: "Dev",
        password: "first password here 1",
        invite_code: invite.code,
      });
      assert.equal(joined.status, 200);
      // Members see change events but not administrative ones; admins see both.
      const memberCookie = {
        Cookie: joined.headers.get("set-cookie").split(";")[0],
      };
      const memberFeed = await (
        await req("/api/events?after=0", null, memberCookie)
      ).json();
      assert.ok(
        memberFeed.events.every(
          (e) =>
            !/^(key|personal_key|invitation|team|instance|user|account|mfa|password|oauth)\./.test(
              e.action,
            ),
        ),
        JSON.stringify(memberFeed.events.map((e) => e.action)),
      );
      // Members can export their own data but not the team's, and cannot delete conversations.
      assert.equal(
        (await req("/api/settings/export/account", null, memberCookie)).status,
        200,
      );
      assert.equal(
        (
          await req(
            `/api/settings/export/team?team=${team}`,
            null,
            memberCookie,
          )
        ).status,
        403,
      );
      const projectId = (
        await (await req("/api/projects", { name: "demo" }, cookie)).json()
      ).id;
      for (const name of ["Navy", "Ice"])
        await req(
          "/api/agents",
          { project_key: projectId, name, program: "x", model: "y" },
          cookie,
        );
      const sent = await (
        await req(
          "/api/messages",
          {
            project_key: projectId,
            sender_name: "Navy",
            to: ["Ice"],
            subject: "hello",
            body_md: "body",
          },
          cookie,
        )
      ).json();
      assert.equal(
        (await req("/api/messages/delete", { ids: [sent.id] }, memberCookie))
          .status,
        403,
      );
      const gz = Buffer.from(
        await (
          await req(`/api/settings/export/team?team=${team}`, null, cookie)
        ).arrayBuffer(),
      );
      assert.deepEqual([...gz.subarray(0, 2)], [0x1f, 0x8b]);
      assert.equal(
        (await req("/api/messages/delete", { ids: [sent.id] }, cookie)).status,
        200,
      );
      assert.equal(
        (await req("/api/messages/delete", { ids: [sent.id] }, cookie)).status,
        404,
      );
      assert.equal(
        (
          await req(
            "/api/projects/delete",
            { project_key: projectId, confirm: "demo" },
            cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await req("/api/settings/backups", null, memberCookie)).status,
        403,
      );
      assert.equal(
        (await req("/api/settings/backups/run", {}, memberCookie)).status,
        403,
      );
      assert.equal(
        (await req("/api/settings/activity", null, memberCookie)).status,
        403,
      );
      const adminFeed = await (
        await req("/api/events?after=0", null, cookie)
      ).json();
      assert.ok(
        adminFeed.events.some((e) => e.action === "invitation.created"),
      );
      const users = (await (await req("/api/settings", null, cookie)).json())
        .users;
      const dev = users.find((u) => u.email === "dev@example.com");
      const reset = await (
        await req("/api/settings/user/reset", { user_id: dev.id }, cookie)
      ).json();
      assert.equal(
        (await req("/api/auth/reset", { code: reset.code, password: "short" }))
          .status,
        400,
      );
      assert.equal(
        (
          await req("/api/auth/reset", {
            code: reset.code,
            password: "second password here 2",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await req("/api/auth/reset", {
            code: reset.code,
            password: "third password here 3",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/api/auth", {
            email: "dev@example.com",
            password: "first password here 1",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await req("/api/auth", {
            email: "dev@example.com",
            password: "second password here 2",
          })
        ).status,
        200,
      );
      // Forgot-password never reveals whether an account exists.
      const forgot = await req("/api/auth/forgot", {
        email: "nobody@example.com",
      });
      assert.equal(forgot.status, 200);
      const mailsBefore = mails().length;
      // Reset by emailed link: the response is the same either way, and only real accounts get mail.
      assert.equal(
        (await req("/api/auth/forgot", { email: "dev@example.com" })).status,
        200,
      );
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(mails().length, mailsBefore + 1);
      const resetMail = mails().at(-1);
      assert.equal(resetMail.to, "dev@example.com");
      const emailed = decodeURIComponent(
        resetMail.text.match(/\/\?reset=([^\s]+)/)[1],
      );
      assert.equal(
        (
          await req("/api/auth/reset", {
            code: emailed,
            password: "emailed reset password 4",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await req("/api/auth", {
            email: "dev@example.com",
            password: "emailed reset password 4",
          })
        ).status,
        200,
      );

      // Account deletion needs the password and the typed email, and removes the account.
      const devCookie = {
        Cookie: (
          await req("/api/auth", {
            email: "dev@example.com",
            password: "emailed reset password 4",
          })
        ).headers
          .get("set-cookie")
          .split(";")[0],
      };
      assert.equal(
        (
          await req(
            "/api/settings/account/delete",
            { password: "wrong", confirm: "dev@example.com" },
            devCookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/api/settings/account/delete",
            { password: "emailed reset password 4", confirm: "nope" },
            devCookie,
          )
        ).status,
        400,
      );
      const gone = await req(
        "/api/settings/account/delete",
        { password: "emailed reset password 4", confirm: "dev@example.com" },
        devCookie,
      );
      assert.equal(gone.status, 200);
      assert.match(gone.headers.get("set-cookie"), /Max-Age=0/);
      assert.equal(
        (
          await req("/api/auth", {
            email: "dev@example.com",
            password: "emailed reset password 4",
          })
        ).status,
        401,
      );

      // Change feed: ordered, resumable, and empty once caught up.
      const feed = await (
        await req("/api/events?after=0", null, cookie)
      ).json();
      assert.ok(feed.events.length >= 2);
      assert.ok(
        feed.events.every((e, i, a) => i === 0 || e.seq > a[i - 1].seq),
      );
      assert.ok(feed.events.some((e) => e.action === "instance.initialized"));
      const caught = await (
        await req(`/api/events?after=${feed.latest_seq}`, null, cookie)
      ).json();
      assert.equal(caught.events.length, 0);
      assert.equal((await req("/api/events?after=0")).status, 401);

      // OAuth: start redirects to the provider with a state cookie; a forged callback is refused.
      const begin = await req("/api/auth/oauth/github/start");
      assert.equal(begin.status, 302);
      const where = new URL(begin.headers.get("location"));
      assert.equal(where.hostname, "github.com");
      assert.equal(where.searchParams.get("client_id"), "test-client");
      const state = where.searchParams.get("state");
      assert.match(begin.headers.get("set-cookie"), /SameSite=Lax/);
      const forged = await req(
        `/api/auth/oauth/github/callback?code=x&state=${state}`,
      );
      assert.equal(forged.status, 302);
      assert.match(forged.headers.get("location"), /auth_error=/);
      assert.equal((await req("/api/auth/oauth/google/start")).status, 404);

      // MCP agents can catch up too.
      const mcpAuth = cookie;
      const rpc = await (
        await req(
          "/mcp",
          { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
          mcpAuth,
        )
      ).text();
      assert.ok(rpc.includes("events_since"));
    } finally {
      server.kill();
      await new Promise((r) => setTimeout(r, 300));
      rmSync(dir, { recursive: true, force: true });
      rmSync(dir + "-backups", { recursive: true, force: true });
      rmSync(dir + "-mail.jsonl", { force: true });
    }
  },
);
