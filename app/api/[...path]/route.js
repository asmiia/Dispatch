import { guide } from "@/lib/agent-guide.mjs";
import { callTool } from "../../../lib/mcp.mjs";
import { MailError, MAX_FILE } from "../../../lib/store.mjs";
import { security, ScopedMail } from "../../../lib/security.mjs";
import {
  guard,
  jsonBody,
  login,
  logout,
  errorResponse,
  checkOrigin,
  validToken,
  trustedOrigin,
  clientIp,
  secureCookie,
} from "../../../lib/http.mjs";
import {
  accounts,
  enabledProviders,
  providers,
} from "../../../lib/accounts.mjs";
import { mailEnabled } from "../../../lib/mailer.mjs";
import {
  deleteMessagesAs,
  deleteProjectAs,
  deleteTeamAs,
  exportAccount,
  exportTeam,
} from "../../../lib/deletion.mjs";
import * as calls from "../../../lib/calls.mjs";
import { installers, installerResponse } from "../../../lib/desktop-files.mjs";
import { checkUpdate, applyUpdate, status } from "../../../lib/updates.mjs";
import { backupStatus, runBackup } from "../../../lib/backup-scheduler.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request, { params }) {
  try {
    const { path } = await params;
    const sec = security(),
      url = new URL(request.url);
    const acc = accounts(sec);
    // The guide that teaches an agent how to work in Dispatch: public, it holds nothing private.
    if (path.join("/") === "agent-guide")
      return new Response(guide(url.searchParams.get("format") || "skill"), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    if (path.join("/") === "version")
      return Response.json({ build: process.env.NEXT_PUBLIC_BUILD || "" });
    if (path.join("/") === "auth/status")
      return Response.json({
        needs_setup: sec.needsSetup(),
        oauth: enabledProviders(),
        email: mailEnabled(),
      });
    if (path[0] === "auth" && path[1] === "oauth" && path.length === 4)
      return await oauthRoute(request, sec, acc, path[2], path[3], url);
    // The desktop app updates itself from here. These are the same installers anyone signed in can download.
    if (path[0] === "desktop-updates" && path.length === 2)
      return installerResponse(path[1]);
    const actor = guard(request),
      db = new ScopedMail(sec, actor);
    if (path.join("/") === "desktop") {
      sec.human(actor);
      return Response.json({ files: installers() });
    }
    if (path.join("/") === "desktop/download") {
      sec.human(actor);
      return installerResponse(url.searchParams.get("name") || "");
    }
    if (path.join("/") === "calls/active") {
      // Calls going on in conversations this person can read, so the app can ring and show a banner.
      // Every open app asks this every few seconds, so it also says who is online.
      const me = sec.human(actor);
      const presence = (globalThis.__dispatchPresence ??= new Map()),
        mood = url.searchParams.get("status");
      // Invisible people check in too, but are not listed as online.
      if (mood === "invisible") presence.delete(me.id);
      else
        presence.set(me.id, {
          t: Date.now(),
          status: ["idle", "dnd"].includes(mood) ? mood : "online",
        });
      const out = [];
      for (const room of calls.active()) {
        try {
          const first = db.db
            .prepare(
              "SELECT id FROM messages WHERE thread_id=? ORDER BY created_at LIMIT 1",
            )
            .get(room.thread_id);
          const thread = db.thread(first.id);
          out.push({
            ...room,
            message_id: thread[0].id,
            subject: thread[0].subject.replace(/^((re|fwd?):\s*)+/i, ""),
          });
        } catch {}
      }
      return Response.json({ calls: out });
    }
    if (path.join("/") === "calls/status") {
      sec.human(actor);
      const thread = db.thread(url.searchParams.get("message_id") || "");
      return Response.json(calls.status(thread[0].thread_id));
    }
    if (path.join("/") === "calls/transcript") {
      sec.human(actor);
      const thread = db.thread(url.searchParams.get("message_id") || "");
      return Response.json(
        calls.transcript(
          thread[0].thread_id,
          Number(url.searchParams.get("after")) || 0,
        ),
      );
    }
    if (path.join("/") === "calls/poll") {
      const user = sec.human(actor),
        peer = url.searchParams.get("peer") || "";
      sec.rate("callpoll:" + peer, 900);
      return Response.json(
        calls.poll(url.searchParams.get("thread_id") || "", user, peer),
      );
    }
    if (path.join("/") === "stream") {
      // Server-sent events: only a counter is sent, the page then refetches what it is allowed to see.
      const latest = () =>
        sec.db.prepare("SELECT COALESCE(MAX(rowid),0) n FROM audit").get().n;
      let timer,
        last = latest(),
        beat = 0;
      const body = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode("retry: 3000\n\n"));
          timer = setInterval(() => {
            try {
              const n = latest();
              if (n !== last) {
                last = n;
                controller.enqueue(enc.encode(`data: ${n}\n\n`));
              } else if (++beat % 15 === 0)
                controller.enqueue(enc.encode(": keepalive\n\n"));
            } catch {
              clearInterval(timer);
            }
          }, 1000);
          request.signal.addEventListener("abort", () => {
            clearInterval(timer);
            try {
              controller.close();
            } catch {}
          });
        },
        cancel() {
          clearInterval(timer);
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      });
    }
    if (path.join("/") === "me") {
      const user = sec.human(actor);
      return Response.json({
        id: user.id,
        name: user.name,
        email: user.email,
        site_admin: !!user.site_admin,
        avatar_v: user.avatar_v || null,
        teams: sec.teams(actor),
      });
    }
    if (path.join("/") === "settings")
      return Response.json(sec.settings(actor, url.searchParams.get("team")));
    if (path.join("/") === "settings/security")
      return Response.json(acc.mfaStatus(actor));
    if (path.join("/") === "settings/activity")
      return Response.json(acc.activity(actor));
    if (path.join("/") === "starred")
      return Response.json(acc.starred(db, url.searchParams.get("project")));
    if (path[0] === "avatars" && path.length === 2) {
      const a = acc.avatar(actor, path[1]);
      if (request.headers.get("if-none-match") === `"${a.version}"`)
        return new Response(null, { status: 304 });
      return new Response(a.bytes, {
        headers: {
          "Content-Type": a.mime,
          "Cache-Control": "private, max-age=86400",
          ETag: `"${a.version}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (path.join("/") === "settings/analytics")
      return Response.json(acc.analytics(actor));
    if (path.join("/") === "settings/sessions")
      return Response.json(acc.sessions(actor));
    if (path.join("/") === "settings/export/account") {
      sec.rate("export:" + actor.id, 10, 3600000);
      return new Response(JSON.stringify(exportAccount(sec, actor), null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="dispatch-account.json"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (path.join("/") === "settings/export/team") {
      sec.rate("export:" + actor.id, 10, 3600000);
      const team = url.searchParams.get("team");
      return new Response(exportTeam(sec, actor, team), {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition":
            'attachment; filename="dispatch-team-export.tar.gz"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (path.join("/") === "settings/instance") {
      acc.siteAdmin(actor);
      return Response.json({
        version: status().version,
        node: process.version,
        origin: process.env.DISPATCH_ORIGIN || null,
        mail: mailEnabled(),
        oauth: enabledProviders(),
        upload_limit: MAX_FILE,
        audit_retention_days:
          process.env.DISPATCH_AUDIT_RETENTION_DAYS || "365",
        trust_proxy: process.env.DISPATCH_TRUST_PROXY === "true",
        secure_cookies: process.env.DISPATCH_COOKIE_SECURE === "true",
        log_level: process.env.DISPATCH_LOG_LEVEL || "info",
        auto_update: process.env.DISPATCH_AUTO_UPDATE === "true",
        update_command: !!process.env.DISPATCH_UPDATE_COMMAND,
      });
    }
    if (path.join("/") === "settings/update") {
      acc.siteAdmin(actor);
      return Response.json(await checkUpdate(url.searchParams.has("force")));
    }
    if (path.join("/") === "settings/backups") {
      acc.siteAdmin(actor);
      return Response.json(await backupStatus());
    }
    if (path.join("/") === "events")
      return Response.json(
        acc.eventsSince(
          db,
          url.searchParams.get("after"),
          url.searchParams.get("limit"),
        ),
      );
    if (path[0] === "projects" && path.length === 1)
      return Response.json(db.projects());
    if (path[0] === "agents" && path.length === 1)
      return Response.json(db.agents(url.searchParams.get("project")));
    if (path[0] === "messages" && path.length === 1)
      return Response.json(
        db.inbox(
          url.searchParams.get("project"),
          url.searchParams.get("agent"),
          url.searchParams.get("q") || "",
        ),
      );
    if (path[0] === "messages" && path.length === 2)
      return Response.json(db.thread(path[1]));
    if (path[0] === "files" && path.length === 2) {
      const { file, bytes } = db.download(path[1]);
      const ext = /\.(png|jpe?g|gif|webp|avif|mp4|m4v|webm|mov|mp3|wav|ogg|m4a)$/i
          .exec(file.filename)?.[1]
          ?.toLowerCase(),
        types = {
          jpg: "image/jpeg", png: "image/png", jpeg: "image/jpeg", gif: "image/gif",
          webp: "image/webp", avif: "image/avif", mp4: "video/mp4", m4v: "video/mp4",
          webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav",
          ogg: "audio/ogg", m4a: "audio/mp4",
        },
        inlineType =
          url.searchParams.get("inline") === "1" && ext ? types[ext] : null;
      // Players ask for a slice of the file when you scrub.
      const range = inlineType && /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
      if (range) {
        const start = range[1] === "" ? Math.max(0, bytes.length - Number(range[2])) : Number(range[1]),
          end = range[1] === "" || range[2] === "" ? bytes.length - 1 : Math.min(Number(range[2]), bytes.length - 1);
        if (start <= end && start < bytes.length)
          return new Response(bytes.subarray(start, end + 1), {
            status: 206,
            headers: {
              "Content-Type": inlineType,
              "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
              "Content-Length": String(end - start + 1),
              "Accept-Ranges": "bytes",
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, no-store",
            },
          });
      }
      return new Response(bytes, {
        headers: {
          ...(inlineType
            ? {
                "Content-Type": inlineType,
                "Content-Security-Policy":
                  "default-src 'none'; img-src 'self'; sandbox",
              }
            : { "Content-Type": "application/octet-stream" }),
          "Content-Disposition": `${inlineType ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
          "Content-Length": String(bytes.length),
          ...(inlineType ? { "Accept-Ranges": "bytes" } : {}),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }
    throw new MailError("Not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request, { params }) {
  try {
    checkOrigin(request);
    const { path } = await params,
      route = path.join("/"),
      sec = security();
    const acc = accounts(sec),
      meta = { ip: clientIp(request), ua: request.headers.get("user-agent") };
    if (route === "auth" || route === "auth/register") {
      const input = await jsonBody(request, 8192);
      if (route === "auth/register") {
        const user = await sec.register(input, validToken(input.setup_key));
        acc.record({
          ...meta,
          user_id: user.id,
          email: user.email,
          ok: true,
          method: "register",
        });
        return Response.json(user, {
          headers: { "Set-Cookie": login(request, user) },
        });
      }
      let user;
      try {
        user = await sec.signIn(input);
      } catch (error) {
        acc.record({
          ...meta,
          email: String(input.email || "").toLowerCase(),
          ok: false,
          method: "password",
          reason: error.message,
        });
        throw error;
      }
      if (acc.mfaEnabled(user.id))
        return Response.json({
          mfa_required: true,
          challenge: acc.challenge(user.id),
        });
      acc.record({
        ...meta,
        user_id: user.id,
        email: user.email,
        ok: true,
        method: "password",
      });
      return Response.json(user, {
        headers: { "Set-Cookie": login(request, user) },
      });
    }
    if (route === "auth/mfa") {
      const input = await jsonBody(request, 2048);
      let user;
      try {
        user = acc.completeChallenge(input.challenge, input.code);
      } catch (error) {
        acc.record({
          ...meta,
          email: "",
          ok: false,
          method: "mfa",
          reason: error.message,
        });
        throw error;
      }
      acc.record({
        ...meta,
        user_id: user.id,
        email: user.email,
        ok: true,
        method: "mfa",
      });
      return Response.json(user, {
        headers: { "Set-Cookie": login(request, user) },
      });
    }
    if (route === "auth/forgot")
      return Response.json(
        await acc.forgot(await jsonBody(request, 2048), trustedOrigin(request)),
      );
    if (route === "auth/reset")
      return Response.json(await acc.reset(await jsonBody(request, 4096)));
    const actor = guard(request),
      db = new ScopedMail(sec, actor);
    // Call signalling is chatty, so it has its own, higher limit.
    sec.rate(
      route === "calls/signal" || route === "calls/caption"
        ? "callsig:" + actor.id
        : "writes:" + actor.id,
      route === "calls/signal" || route === "calls/caption" ? 1200 : 120,
    );
    const body = await jsonBody(request, Math.ceil((MAX_FILE * 4) / 3) + 8192);
    if (route === "logout") {
      logout(request);
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie":
              "dispatch_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          },
        },
      );
    }
    if (route === "coordination")
      return Response.json(await callTool(body.tool, body.args, db));
    if (route === "settings/team")
      return Response.json(sec.updateTeam(actor, body));
    if (route === "settings/teams")
      return Response.json(sec.newTeam(actor, body.name));
    if (route === "settings/invite") {
      sec.requireRole(actor, body.team_id, "admin");
      acc.guardInviteMail(actor, body.email);
      const result = sec.invite(actor, body),
        team = sec.teams(actor).find((t) => t.id === body.team_id);
      const emailed = await acc.mailInvite(
        String(body.email).toLowerCase(),
        result.code,
        team?.name || "a team",
        trustedOrigin(request),
      );
      return Response.json({ ...result, emailed });
    }
    if (route === "messages/star")
      return Response.json(acc.starThread(db, body));
    if (route === "settings/avatar")
      return Response.json(acc.setAvatar(actor, body));
    if (route === "settings/avatar/remove")
      return Response.json(acc.removeAvatar(actor));
    if (route === "settings/sessions/revoke") {
      const result = acc.revokeSession(actor, body.id);
      return Response.json(result, {
        headers: result.signed_out
          ? {
              "Set-Cookie":
                "dispatch_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
            }
          : {},
      });
    }
    if (route === "settings/sessions/revoke-others")
      return Response.json(acc.revokeOtherSessions(actor));
    if (route === "settings/team/retention")
      return Response.json(sec.setRetention(actor, body));
    if (route === "messages/delete")
      return Response.json(deleteMessagesAs(sec, actor, body.ids));
    if (route === "projects/delete")
      return Response.json(
        deleteProjectAs(sec, actor, body.project_key, body.confirm),
      );
    if (route === "settings/teams/delete")
      return Response.json(
        deleteTeamAs(sec, actor, body.team_id, body.confirm),
      );
    if (route === "settings/user/delete")
      return Response.json(acc.deleteUserAs(actor, body.user_id));
    if (route === "settings/account/delete") {
      const result = await acc.deleteOwnAccount(actor, body);
      return Response.json(result, {
        headers: {
          "Set-Cookie":
            "dispatch_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        },
      });
    }
    if (route === "calls/join") {
      // Joining needs access to the conversation; the room is keyed by its thread.
      const user = sec.human(actor),
        thread = db.thread(String(body.message_id || ""));
      return Response.json(calls.join(thread[0].thread_id, user));
    }
    if (route === "calls/signal")
      return Response.json(
        calls.signal(String(body.thread_id || ""), sec.human(actor), body),
      );
    if (route === "calls/chime") {
      sec.human(actor);
      const thread = db.thread(String(body.message_id || ""));
      return Response.json(calls.setChime(thread[0].thread_id, !!body.on));
    }
    if (route === "calls/caption")
      return Response.json(
        calls.caption(
          String(body.thread_id || ""),
          sec.human(actor),
          String(body.from || ""),
          body.text,
        ),
      );
    if (route === "calls/leave")
      return Response.json(
        calls.leave(
          String(body.thread_id || ""),
          sec.human(actor),
          String(body.peer || ""),
        ),
      );
    if (route === "me/identity") {
      // People write as themselves: each person gets a "human" identity in the project, named after them.
      const user = sec.human(actor);
      let slug = String(user.name || "user")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^[^a-zA-Z]+/, "")
        .replace(/-+$/, "")
        .slice(0, 40);
      if (!slug) slug = "user";
      const clash = db
        .agents(body.project_key)
        .find((a) => a.name === slug && a.program !== "human");
      const name = clash
        ? slug + "-" + user.id.replace(/[^a-z0-9]/gi, "").slice(0, 4)
        : slug;
      // Only write (and log) when the identity is new or changed, so this stays quiet on every page load.
      const model = "web:" + user.id,
        existing = db
          .agents(body.project_key)
          .find((a) => a.name === name && a.program === "human");
      if (existing && existing.model === model) return Response.json(existing);
      return Response.json(
        db.register({
          project_key: body.project_key,
          name,
          program: "human",
          model,
        }),
      );
    }
    if (route === "settings/update/apply") {
      acc.siteAdmin(actor);
      sec.rate("update-apply", 3, 3600000);
      const result = applyUpdate();
      sec.log(actor, null, "instance.update", result.latest?.tag || "");
      return Response.json(result);
    }
    if (route === "settings/backups/run") {
      acc.siteAdmin(actor);
      sec.rate("backup-run", 6, 3600000);
      const result = await runBackup().catch((error) => {
        throw error instanceof MailError
          ? error
          : new MailError("Backup failed: " + error.message, 500);
      });
      sec.log(actor, null, "backup.created", result.stamp);
      return Response.json({ stamp: result.stamp });
    }
    if (route === "settings/mfa/start")
      return Response.json(await acc.mfaStart(actor, body));
    if (route === "settings/mfa/confirm")
      return Response.json(acc.mfaConfirm(actor, body));
    if (route === "settings/mfa/disable")
      return Response.json(await acc.mfaDisable(actor, body));
    if (route === "settings/user/reset")
      return Response.json(acc.adminReset(actor, body.user_id));
    if (route === "settings/invite/revoke")
      return Response.json(sec.revokeInvite(actor, body.id));
    if (route === "settings/join")
      return Response.json(sec.join(actor, body.code));
    if (route === "settings/member")
      return Response.json(sec.member(actor, body));
    if (route === "settings/key")
      return Response.json(sec.issueKey(actor, body));
    if (route === "settings/key/revoke")
      return Response.json(sec.revokeKey(actor, body.id));
    if (route === "settings/personal-key")
      return Response.json(sec.issuePersonalKey(actor, body));
    if (route === "settings/personal-key/revoke")
      return Response.json(sec.revokePersonalKey(actor, body.id));
    if (route === "settings/user")
      return Response.json(sec.disableUser(actor, body));
    if (route === "settings/profile")
      return Response.json(await sec.profile(actor, body));
    if (path.join("/") === "projects/rename")
      return Response.json(db.renameProject(body.id, body.name));
    if (path[0] === "projects" && path.length === 1)
      return Response.json(db.ensureProject(body.name, body.team_id), {
        status: 201,
      });
    if (path[0] === "agents" && path.length === 1)
      return Response.json(db.register(body), { status: 201 });
    if (path[0] === "messages" && path.length === 1)
      return Response.json(db.send(body), { status: 201 });
    if (path[0] === "messages" && path.length === 3 && path[2] === "read")
      return Response.json(db.read(path[1], body.agent_name));
    if (path[0] === "files" && path.length === 1) {
      if (
        typeof body.data_base64 !== "string" ||
        !body.data_base64 ||
        body.data_base64.length % 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data_base64)
      )
        throw new MailError("Invalid base64");
      return Response.json(
        db.upload(
          body.project_key,
          body.filename,
          Buffer.from(body.data_base64, "base64"),
        ),
        { status: 201 },
      );
    }
    throw new MailError("Not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}

async function oauthRoute(request, sec, acc, name, step, url) {
  const origin = trustedOrigin(request);
  if (!origin)
    throw new MailError("Set DISPATCH_ORIGIN to use sign-in providers", 503);
  const secure = secureCookie(request) ? "; Secure" : "",
    cookie = (value, age) =>
      `dispatch_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/oauth; Max-Age=${age}${secure}`,
    meta = { ip: clientIp(request), ua: request.headers.get("user-agent") };
  if (!providers[name] || !enabledProviders().includes(name))
    throw new MailError("Sign-in provider is not enabled", 404);
  if (step === "start") {
    sec.rate("oauth:start", 120, 300000);
    const { url: target, state } = acc.oauthStart(name, origin);
    return new Response(null, {
      status: 302,
      headers: { Location: target, "Set-Cookie": cookie(state, 600) },
    });
  }
  if (step !== "callback") throw new MailError("Not found", 404);
  const fail = (message) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: `${origin}/?auth_error=${encodeURIComponent(message)}`,
        "Set-Cookie": cookie("", 0),
      },
    });
  const saved = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)dispatch_oauth=([A-Za-z0-9_-]{20,64})(?:;|$)/)?.[1];
  const state = url.searchParams.get("state"),
    code = url.searchParams.get("code");
  if (!saved || !state || saved !== state || !code)
    return fail("Sign-in expired. Try again.");
  try {
    sec.rate("oauth:callback", 120, 300000);
    const who = await acc.identity(name, code, origin),
      user = acc.resolve(name, who);
    acc.record({
      ...meta,
      user_id: user.id,
      email: user.email,
      ok: true,
      method: name,
    });
    const headers = new Headers({ Location: origin + "/" });
    headers.append("Set-Cookie", login(request, user));
    headers.append("Set-Cookie", cookie("", 0));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (!(error instanceof MailError)) throw error;
    acc.record({
      ...meta,
      email: "",
      ok: false,
      method: name,
      reason: error.message,
    });
    return fail(error.message);
  }
}
