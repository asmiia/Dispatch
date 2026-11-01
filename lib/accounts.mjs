import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  hash,
  email as normalizeEmail,
  publicUser,
  passwordHash,
  passwordMatches,
} from "./security.mjs";
import { MailError } from "./store.mjs";
import { newSecret, verify, otpauth } from "./totp.mjs";
import { sendMail, mailEnabled } from "./mailer.mjs";
import { log } from "./log.mjs";
import { deleteUserRecords } from "./deletion.mjs";
import { statSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };

const now = () => new Date().toISOString();
const same = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const providers = {
  github: {
    label: "GitHub",
    authorize: "https://github.com/login/oauth/authorize",
    scope: "read:user user:email",
  },
  google: {
    label: "Google",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "openid email",
  },
};
const credentials = (name) => {
  const id = process.env[`DISPATCH_${name.toUpperCase()}_CLIENT_ID`],
    secret = process.env[`DISPATCH_${name.toUpperCase()}_CLIENT_SECRET`];
  return id && secret ? { id, secret } : null;
};
export const enabledProviders = () =>
  Object.keys(providers).filter((name) => credentials(name));

export function accounts(sec) {
  return (sec.__accounts ??= new Accounts(sec));
}

class Accounts {
  constructor(sec) {
    this.sec = sec;
    this.db = sec.db;
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS login_events(id TEXT PRIMARY KEY,user_id TEXT,email TEXT NOT NULL,ok INTEGER NOT NULL,method TEXT NOT NULL,reason TEXT,ip TEXT,ua TEXT,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS login_events_time ON login_events(created_at DESC);
      CREATE TABLE IF NOT EXISTS password_resets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,used_at TEXT);
      CREATE TABLE IF NOT EXISTS mfa(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,last_step INTEGER NOT NULL DEFAULT 0,recovery TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS mfa_challenges(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS stars(user_id TEXT NOT NULL REFERENCES users(id),thread_id TEXT NOT NULL,project_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,thread_id));
      CREATE INDEX IF NOT EXISTS stars_project ON stars(user_id,project_id);
      CREATE TABLE IF NOT EXISTS oauth_identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),email TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(provider,subject));`);
  }

  // TOTP secrets are encrypted with a key kept beside, not inside, the database.
  key() {
    const file = join(this.sec.mail.directory, ".secret-key");
    if (!existsSync(file))
      try {
        writeFileSync(file, randomBytes(32).toString("hex"), {
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    return Buffer.from(readFileSync(file, "utf8").trim(), "hex");
  }
  seal(value) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key(), iv),
      body = Buffer.concat([c.update(value, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), body].map((b) => b.toString("hex")).join(".");
  }
  open(sealed) {
    const [iv, tag, body] = sealed.split(".").map((h) => Buffer.from(h, "hex")),
      d = createDecipheriv("aes-256-gcm", this.key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  }

  // ---- sign-in history
  record(input) {
    // Rate-limited attempts are not stored, so a flood can't fill the disk.
    if (/^Too many/.test(input.reason || "")) return;
    this.db
      .prepare("INSERT INTO login_events VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        input.user_id || null,
        String(input.email || "").slice(0, 254),
        input.ok ? 1 : 0,
        input.method,
        input.reason || null,
        input.ip || null,
        String(input.ua || "").slice(0, 200),
        now(),
      );
    this.db
      .prepare("DELETE FROM login_events WHERE created_at<?")
      .run(new Date(Date.now() - 90 * 86400000).toISOString());
    this.db
      .prepare(
        "DELETE FROM login_events WHERE rowid<=(SELECT MAX(rowid) FROM login_events)-20000",
      )
      .run();
    log(
      input.ok ? "info" : "warn",
      input.ok ? "auth.login" : "auth.login_failed",
      {
        method: input.method,
        user_id: input.user_id || undefined,
        reason: input.reason,
        ip: input.ip || undefined,
      },
    );
  }
  siteAdmin(actor) {
    const admin = this.sec.human(actor);
    if (!admin.site_admin || actor.team_scope)
      throw new MailError(
        "Instance administration requires a browser session",
        403,
      );
    return admin;
  }
  activity(actor) {
    this.siteAdmin(actor);
    const day = new Date(Date.now() - 86400000).toISOString(),
      one = (sql, ...a) => Object.values(this.db.prepare(sql).get(...a))[0];
    return {
      stats: {
        users: one("SELECT COUNT(*) FROM users"),
        teams: one("SELECT COUNT(*) FROM teams"),
        projects: one("SELECT COUNT(*) FROM projects"),
        messages: one("SELECT COUNT(*) FROM messages"),
        messages_24h: one(
          "SELECT COUNT(*) FROM messages WHERE created_at>?",
          day,
        ),
        logins_24h: one(
          "SELECT COUNT(*) FROM login_events WHERE ok=1 AND created_at>?",
          day,
        ),
        failed_24h: one(
          "SELECT COUNT(*) FROM login_events WHERE ok=0 AND created_at>?",
          day,
        ),
        mfa_users: one("SELECT COUNT(*) FROM mfa WHERE enabled=1"),
      },
      logins: this.db
        .prepare(
          "SELECT id,email,ok,method,reason,ip,created_at FROM login_events ORDER BY created_at DESC LIMIT 60",
        )
        .all(),
    };
  }

  // ---- stars: a personal bookmark on a conversation
  starThread(scoped, input) {
    const user = this.browserUser(scoped.actor);
    const found = this.db
      .prepare("SELECT id,project_id FROM messages WHERE thread_id=? LIMIT 1")
      .get(String(input.thread_id || ""));
    if (!found) throw new MailError("Not found", 404);
    scoped.message(found.id); // throws unless you can read this conversation
    if (input.starred === false)
      this.db
        .prepare("DELETE FROM stars WHERE user_id=? AND thread_id=?")
        .run(user.id, input.thread_id);
    else
      this.db
        .prepare("INSERT OR IGNORE INTO stars VALUES(?,?,?,?)")
        .run(user.id, input.thread_id, found.project_id, now());
    return { ok: true, starred: input.starred !== false };
  }
  starred(scoped, projectKey) {
    const user = this.browserUser(scoped.actor),
      project = scoped.project(projectKey);
    return {
      threads: this.db
        .prepare("SELECT thread_id FROM stars WHERE user_id=? AND project_id=?")
        .all(user.id, project.id)
        .map((r) => r.thread_id),
    };
  }

  // ---- profile picture: square PNG or JPEG, validated by its bytes
  setAvatar(actor, input) {
    const user = this.browserUser(actor);
    this.sec.rate("avatar:" + user.id, 20, 3600000);
    const b64 = String(input.data_base64 || "");
    if (!b64 || b64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64))
      throw new MailError("Invalid image");
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length > 400 * 1024)
      throw new MailError("Photos can be up to 400 KB", 413);
    const info = imageInfo(bytes);
    if (!info) throw new MailError("Use a PNG or JPEG photo");
    if (info.w !== info.h || info.w < 64 || info.w > 1024)
      throw new MailError("Photos must be square, between 64 and 1024 pixels");
    this.db
      .prepare("UPDATE users SET avatar=?,avatar_mime=?,avatar_v=? WHERE id=?")
      .run(bytes, info.mime, hash(bytes).slice(0, 12), user.id);
    this.sec.log(actor, null, "account.photo_changed", user.id);
    return { ok: true, avatar_v: hash(bytes).slice(0, 12) };
  }
  removeAvatar(actor) {
    const user = this.browserUser(actor);
    this.db
      .prepare(
        "UPDATE users SET avatar=NULL,avatar_mime=NULL,avatar_v=NULL WHERE id=?",
      )
      .run(user.id);
    return { ok: true };
  }
  // Visible to the person themself, people who share a team with them, and instance administrators.
  avatar(actor, id) {
    const viewer = this.sec.human(actor);
    if (id !== viewer.id && !viewer.site_admin) {
      const shared = this.db
        .prepare(
          "SELECT 1 FROM memberships a JOIN memberships b ON a.team_id=b.team_id WHERE a.user_id=? AND b.user_id=?",
        )
        .get(viewer.id, id);
      if (!shared) throw new MailError("Not found", 404);
    }
    const row = this.db
      .prepare("SELECT avatar,avatar_mime,avatar_v FROM users WHERE id=?")
      .get(id);
    if (!row?.avatar) throw new MailError("Not found", 404);
    return { bytes: row.avatar, mime: row.avatar_mime, version: row.avatar_v };
  }

  // ---- instance analytics (administrators only)
  analytics(actor) {
    this.siteAdmin(actor);
    const db = this.db,
      one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0],
      rows = (sql, ...a) => db.prepare(sql).all(...a),
      days = Array.from({ length: 30 }, (_, i) =>
        new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
      ),
      since = days[0] + "T00:00:00.000Z",
      series = (sql, ...a) => {
        const found = new Map(rows(sql, ...a).map((r) => [r.d, r.n]));
        return days.map((d) => found.get(d) || 0);
      },
      day = new Date(Date.now() - 86400000).toISOString(),
      week = new Date(Date.now() - 7 * 86400000).toISOString();
    let dbBytes = 0;
    for (const suffix of ["", "-wal"])
      try {
        dbBytes += statSync(
          join(this.sec.mail.directory, "mail.sqlite" + suffix),
        ).size;
      } catch {}
    return {
      days,
      totals: {
        users: one("SELECT COUNT(*) FROM users"),
        active_users_30d: one(
          "SELECT COUNT(DISTINCT user_id) FROM login_events WHERE ok=1 AND user_id IS NOT NULL AND created_at>=?",
          since,
        ),
        teams: one("SELECT COUNT(*) FROM teams"),
        projects: one("SELECT COUNT(*) FROM projects"),
        agents: one("SELECT COUNT(*) FROM agents"),
        messages: one("SELECT COUNT(*) FROM messages"),
        messages_24h: one(
          "SELECT COUNT(*) FROM messages WHERE created_at>?",
          day,
        ),
        messages_7d: one(
          "SELECT COUNT(*) FROM messages WHERE created_at>?",
          week,
        ),
        files: one("SELECT COUNT(*) FROM attachments"),
        file_bytes: one("SELECT COALESCE(SUM(size),0) FROM attachments"),
        mfa_users: one("SELECT COUNT(*) FROM mfa WHERE enabled=1"),
        failed_24h: one(
          "SELECT COUNT(*) FROM login_events WHERE ok=0 AND created_at>?",
          day,
        ),
      },
      series: {
        messages: series(
          "SELECT substr(created_at,1,10) d, COUNT(*) n FROM messages WHERE created_at>=? GROUP BY d",
          since,
        ),
        signins: series(
          "SELECT substr(created_at,1,10) d, COUNT(*) n FROM login_events WHERE ok=1 AND created_at>=? GROUP BY d",
          since,
        ),
        failed: series(
          "SELECT substr(created_at,1,10) d, COUNT(*) n FROM login_events WHERE ok=0 AND created_at>=? GROUP BY d",
          since,
        ),
        new_users: series(
          "SELECT substr(created_at,1,10) d, COUNT(*) n FROM users WHERE created_at>=? GROUP BY d",
          since,
        ),
      },
      top_projects: rows(
        "SELECT p.name, t.name team, COUNT(m.id) n FROM messages m JOIN projects p ON p.id=m.project_id LEFT JOIN teams t ON t.id=p.team_id WHERE m.created_at>=? GROUP BY p.id ORDER BY n DESC LIMIT 8",
        since,
      ),
      top_agents: rows(
        "SELECT a.name, a.program, a.model, p.name project, COUNT(m.id) n FROM messages m JOIN agents a ON a.id=m.sender_id JOIN projects p ON p.id=a.project_id WHERE m.created_at>=? GROUP BY a.id ORDER BY n DESC LIMIT 8",
        since,
      ),
      by_program: rows(
        "SELECT program, COUNT(*) n FROM agents GROUP BY program ORDER BY n DESC LIMIT 10",
      ),
      storage: rows(
        "SELECT t.name, t.quota_bytes, COALESCE(SUM(a.size),0) bytes, COUNT(a.id) files FROM teams t LEFT JOIN projects p ON p.team_id=t.id LEFT JOIN attachments a ON a.project_id=p.id GROUP BY t.id ORDER BY bytes DESC",
      ),
      system: {
        version: pkg.version,
        node: process.version,
        platform: process.platform,
        uptime_seconds: Math.round(process.uptime()),
        memory_bytes: process.memoryUsage().rss,
        database_bytes: dbBytes,
      },
    };
  }

  // ---- sessions: list, revoke one, revoke the rest
  sessions(actor) {
    const user = this.browserUser(actor);
    return this.db
      .prepare(
        "SELECT hash,created_at,last_seen,ip,ua FROM sessions WHERE user_id=? AND expires_at>? ORDER BY COALESCE(last_seen,created_at) DESC",
      )
      .all(user.id, Date.now())
      .map((r) => ({
        id: r.hash.slice(0, 16),
        current: r.hash === actor.session,
        created_at: r.created_at,
        last_seen: r.last_seen,
        ip: r.ip,
        ua: r.ua,
      }));
  }
  revokeSession(actor, id) {
    const user = this.browserUser(actor);
    if (typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id))
      throw new MailError("Session not found", 404);
    const row = this.db
      .prepare(
        "SELECT hash FROM sessions WHERE user_id=? AND substr(hash,1,16)=?",
      )
      .get(user.id, id);
    if (!row) throw new MailError("Session not found", 404);
    this.db.prepare("DELETE FROM sessions WHERE hash=?").run(row.hash);
    this.sec.log(actor, null, "session.revoked", id);
    return { ok: true, signed_out: row.hash === actor.session };
  }
  revokeOtherSessions(actor) {
    const user = this.browserUser(actor);
    const r = this.db
      .prepare("DELETE FROM sessions WHERE user_id=? AND hash!=?")
      .run(user.id, actor.session || "");
    this.sec.log(actor, null, "session.revoked_others", String(r.changes));
    return { ok: true, revoked: Number(r.changes) };
  }

  // ---- account deletion
  async deleteOwnAccount(actor, input) {
    const user = this.browserUser(actor);
    this.sec.rate("account-delete:" + user.id, 5, 900000);
    if (!(await passwordMatches(input.password, user.password_hash)))
      throw new MailError("Password is incorrect", 403);
    if (
      this.mfaEnabled(user.id) &&
      !this.checkSecondFactor(user.id, input.code)
    )
      throw new MailError("That code is not valid", 403);
    if (input.confirm !== user.email)
      throw new MailError("Type your email address to confirm");
    deleteUserRecords(this.sec, user.id);
    log("info", "account.deleted", { user_id: user.id });
    return { ok: true };
  }
  deleteUserAs(actor, userId) {
    this.siteAdmin(actor);
    if (userId === actor.id)
      throw new MailError("Use Delete my account for your own account", 400);
    const user = deleteUserRecords(this.sec, userId);
    this.sec.log(actor, null, "user.deleted", user.email);
    return { ok: true };
  }

  // ---- two-factor
  mfaRow(userId) {
    return this.db.prepare("SELECT * FROM mfa WHERE user_id=?").get(userId);
  }
  mfaEnabled(userId) {
    return !!this.mfaRow(userId)?.enabled;
  }
  mfaStatus(actor) {
    const user = this.sec.human(actor),
      row = this.mfaRow(user.id);
    return {
      enabled: !!row?.enabled,
      recovery_left: row?.enabled ? JSON.parse(row.recovery).length : 0,
    };
  }
  browserUser(actor) {
    if (actor.team_scope)
      throw new MailError("Account changes require a browser session", 403);
    return this.sec.human(actor);
  }
  async mfaStart(actor, input) {
    const user = this.browserUser(actor);
    this.sec.rate("mfa-setup:" + user.id, 10, 300000);
    // A stolen session must not be able to enrol its own authenticator.
    if (!(await passwordMatches(input?.password, user.password_hash)))
      throw new MailError("Password is incorrect", 403);
    if (this.mfaEnabled(user.id))
      throw new MailError("Two-factor authentication is already on", 409);
    const secret = newSecret();
    this.db
      .prepare(
        "INSERT INTO mfa(user_id,secret,enabled,last_step,recovery) VALUES(?,?,0,0,'[]') ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,enabled=0,last_step=0,recovery='[]'",
      )
      .run(user.id, this.seal(secret));
    const uri = otpauth(secret, user.email),
      { default: QR } = await import("qrcode"),
      qr = QR.create(uri, { errorCorrectionLevel: "M" }).modules;
    const rows = [];
    for (let y = 0; y < qr.size; y++)
      rows.push(
        Array.from({ length: qr.size }, (_, x) =>
          qr.data[y * qr.size + x] ? 1 : 0,
        ).join(""),
      );
    return { secret, uri, qr: rows };
  }
  mfaConfirm(actor, input) {
    const user = this.browserUser(actor);
    this.sec.rate("mfa-setup:" + user.id, 10, 300000);
    const row = this.mfaRow(user.id);
    if (!row || row.enabled)
      throw new MailError("Start two-factor setup first", 409);
    const step = verify(this.open(row.secret), input.code);
    if (step === null) throw new MailError("That code is not valid", 403);
    const codes = Array.from({ length: 8 }, () => {
      const raw = randomBytes(5).toString("hex");
      return raw.slice(0, 5) + "-" + raw.slice(5);
    });
    this.db
      .prepare(
        "UPDATE mfa SET enabled=1,last_step=?,recovery=? WHERE user_id=?",
      )
      .run(step, JSON.stringify(codes.map(hash)), user.id);
    this.sec.log(actor, null, "mfa.enabled", user.id);
    return { recovery_codes: codes };
  }
  async mfaDisable(actor, input) {
    const user = this.browserUser(actor);
    this.sec.rate("mfa-setup:" + user.id, 10, 300000);
    if (!(await passwordMatches(input.password, user.password_hash)))
      throw new MailError("Password is incorrect", 403);
    if (
      this.mfaEnabled(user.id) &&
      !this.checkSecondFactor(user.id, input.code)
    )
      throw new MailError("That code is not valid", 403);
    this.db.prepare("DELETE FROM mfa WHERE user_id=?").run(user.id);
    this.sec.log(actor, null, "mfa.disabled", user.id);
    return { ok: true };
  }
  // Accepts a current TOTP code (once per time step) or a one-time recovery code.
  checkSecondFactor(userId, input) {
    const row = this.mfaRow(userId);
    if (!row?.enabled) return false;
    const given = String(input || "")
      .trim()
      .toLowerCase();
    const step = verify(this.open(row.secret), given);
    if (step !== null && step > row.last_step) {
      this.db
        .prepare("UPDATE mfa SET last_step=? WHERE user_id=?")
        .run(step, userId);
      return true;
    }
    const list = JSON.parse(row.recovery),
      h = hash(given),
      at = list.findIndex((x) => same(x, h));
    if (at < 0) return false;
    list.splice(at, 1);
    this.db
      .prepare("UPDATE mfa SET recovery=? WHERE user_id=?")
      .run(JSON.stringify(list), userId);
    return true;
  }
  challenge(userId) {
    const raw = randomBytes(32).toString("hex");
    this.db
      .prepare("DELETE FROM mfa_challenges WHERE expires_at<?")
      .run(Date.now());
    this.db
      .prepare("INSERT INTO mfa_challenges VALUES(?,?,?,0)")
      .run(hash(raw), userId, Date.now() + 300000);
    return raw;
  }
  completeChallenge(raw, code) {
    this.sec.rate("mfa:global", 200, 300000);
    const row =
      typeof raw === "string" && raw.length <= 128
        ? this.db
            .prepare(
              "SELECT * FROM mfa_challenges WHERE hash=? AND expires_at>?",
            )
            .get(hash(raw), Date.now())
        : null;
    if (!row) throw new MailError("Sign in again", 401);
    this.db
      .prepare("UPDATE mfa_challenges SET attempts=attempts+1 WHERE hash=?")
      .run(row.hash);
    if (row.attempts >= 5) {
      this.db.prepare("DELETE FROM mfa_challenges WHERE hash=?").run(row.hash);
      throw new MailError("Too many attempts. Sign in again.", 429);
    }
    if (!this.checkSecondFactor(row.user_id, code))
      throw new MailError("That code is not valid", 401);
    this.db.prepare("DELETE FROM mfa_challenges WHERE hash=?").run(row.hash);
    return publicUser(this.sec.user(row.user_id));
  }

  // ---- email: invitations and password reset
  // Limits how much email one admin can send to arbitrary addresses.
  guardInviteMail(actor, address) {
    if (!mailEnabled()) return;
    this.sec.rate("invite-mail:" + actor.id, 50, 86400000);
    this.sec.rate(
      "invite-mail-to:" + hash(normalizeEmail(address)),
      3,
      86400000,
    );
  }
  async mailInvite(address, code, teamName, origin) {
    if (!origin) {
      if (mailEnabled())
        log("warn", "mail.skipped", {
          reason: "Set DISPATCH_ORIGIN to email links",
        });
      return false;
    }
    const link = `${origin}/?invite=${encodeURIComponent(code)}&email=${encodeURIComponent(address)}`;
    return sendMail({
      to: address,
      subject: `You're invited to ${teamName} on Dispatch`,
      text: `You've been invited to join ${teamName} on Dispatch.\n\nCreate your account: ${link}\n\nThis invitation expires in 7 days. If you weren't expecting it, ignore this email.`,
    });
  }
  resetToken(userId, minutes = 60) {
    const raw = randomBytes(32).toString("base64url");
    this.db
      .prepare(
        "UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL",
      )
      .run(now(), userId);
    this.db
      .prepare("INSERT INTO password_resets VALUES(?,?,?,?,NULL)")
      .run(randomUUID(), userId, hash(raw), Date.now() + minutes * 60000);
    return raw;
  }
  async forgot(input, origin) {
    const address = normalizeEmail(input.email);
    this.sec.rate("forgot:global", 60, 3600000);
    this.sec.rate("forgot:" + hash(address), 3, 3600000);
    const user = this.db
      .prepare("SELECT * FROM users WHERE email=? AND disabled=0")
      .get(address);
    if (user && mailEnabled() && !origin)
      log("warn", "mail.skipped", {
        reason: "Set DISPATCH_ORIGIN to email links",
      });
    if (user && mailEnabled() && origin) {
      const link = `${origin}/?reset=${encodeURIComponent(this.resetToken(user.id))}`;
      // Not awaited: response time must not reveal whether the account exists.
      void sendMail({
        to: address,
        subject: "Reset your Dispatch password",
        text: `Use this link to choose a new password (valid for 1 hour):\n\n${link}\n\nIf you didn't ask for this, ignore this email. Your password won't change.`,
      });
    }
    return { ok: true, email_enabled: mailEnabled() };
  }
  adminReset(actor, userId) {
    this.siteAdmin(actor);
    const target = this.db
      .prepare("SELECT id FROM users WHERE id=? AND disabled=0")
      .get(userId);
    if (!target) throw new MailError("Account not found", 404);
    const code = this.resetToken(target.id);
    this.sec.log(actor, null, "password.reset_issued", target.id);
    return { code };
  }
  async reset(input) {
    this.sec.rate("reset", 30, 900000);
    const row =
      typeof input.code === "string" && input.code.length <= 128
        ? this.db
            .prepare(
              "SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
            )
            .get(hash(input.code), Date.now())
        : null;
    if (!row)
      throw new MailError("This reset link is invalid or has expired", 403);
    const encoded = await passwordHash(input.password);
    this.sec.transaction(() => {
      this.db
        .prepare(
          "UPDATE password_resets SET used_at=? WHERE id=? AND used_at IS NULL",
        )
        .run(now(), row.id);
      this.db
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(encoded, row.user_id);
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(row.user_id);
      this.db
        .prepare(
          "UPDATE personal_keys SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
        )
        .run(now(), row.user_id);
      this.sec.log({ id: row.user_id }, null, "password.reset", row.user_id);
    });
    return { ok: true };
  }

  // ---- OAuth sign-in (GitHub, Google): existing accounts and invited emails only.
  oauthStart(name, origin) {
    const cred = credentials(name);
    if (!cred || !providers[name])
      throw new MailError("Sign-in provider is not enabled", 404);
    const state = randomBytes(24).toString("base64url"),
      url = new URL(providers[name].authorize);
    url.search = new URLSearchParams({
      client_id: cred.id,
      redirect_uri: `${origin}/api/auth/oauth/${name}/callback`,
      scope: providers[name].scope,
      state,
      response_type: "code",
      ...(name === "google" ? { prompt: "select_account" } : {}),
    }).toString();
    return { url: url.toString(), state };
  }
  async identity(name, code, origin) {
    const cred = credentials(name);
    const json = async (response) => {
      if (!response.ok)
        throw new MailError("The provider rejected the request", 502);
      return response.json();
    };
    const signal = () => AbortSignal.timeout(10000);
    if (name === "github") {
      const token = await json(
        await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: cred.id,
            client_secret: cred.secret,
            code,
            redirect_uri: `${origin}/api/auth/oauth/github/callback`,
          }),
          signal: signal(),
        }),
      );
      if (!token.access_token)
        throw new MailError("GitHub sign-in failed", 403);
      const headers = {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Dispatch",
      };
      const [profile, emails] = await Promise.all([
        fetch("https://api.github.com/user", {
          headers,
          signal: signal(),
        }).then(json),
        fetch("https://api.github.com/user/emails", {
          headers,
          signal: signal(),
        }).then(json),
      ]);
      const primary = emails.find((e) => e.primary && e.verified);
      if (!primary)
        throw new MailError("GitHub has no verified primary email", 403);
      return {
        subject: String(profile.id),
        email: primary.email.toLowerCase(),
      };
    }
    const token = await json(
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cred.id,
          client_secret: cred.secret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${origin}/api/auth/oauth/google/callback`,
        }),
        signal: signal(),
      }),
    );
    if (!token.access_token) throw new MailError("Google sign-in failed", 403);
    const info = await json(
      await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: signal(),
      }),
    );
    if (!info.email || info.email_verified !== true)
      throw new MailError("Google has no verified email for this account", 403);
    return { subject: String(info.sub), email: info.email.toLowerCase() };
  }
  // Resolves a provider identity to a user, or throws a MailError the UI can show.
  resolve(name, who) {
    return this.sec.transaction(() => {
      const linked = this.db
        .prepare(
          "SELECT user_id FROM oauth_identities WHERE provider=? AND subject=?",
        )
        .get(name, who.subject);
      if (linked) return publicUser(this.sec.user(linked.user_id));
      const existing = this.db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(who.email);
      const link = (userId) =>
        this.db
          .prepare("INSERT INTO oauth_identities VALUES(?,?,?,?,?)")
          .run(name, who.subject, userId, who.email, now());
      if (existing) {
        if (existing.disabled)
          throw new MailError("This account is disabled", 403);
        if (this.mfaEnabled(existing.id))
          throw new MailError(
            "This account has two-factor authentication. Sign in with your password first.",
            403,
          );
        link(existing.id);
        this.sec.log({ id: existing.id }, null, "oauth.linked", name);
        return publicUser(existing);
      }
      const invite = this.db
        .prepare(
          "SELECT * FROM invitations WHERE email=? AND used_at IS NULL AND expires_at>? ORDER BY expires_at DESC",
        )
        .all(who.email, Date.now())
        .find((i) => {
          try {
            this.sec.requireRole(
              { kind: "user", id: i.created_by },
              i.team_id,
              "admin",
            );
            return true;
          } catch {
            return false;
          }
        });
      if (!invite)
        throw new MailError(
          "No account or invitation exists for this email",
          403,
        );
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO users(id,email,name,password_hash,site_admin,disabled,created_at) VALUES(?,?,?,?,0,0,?)",
        )
        .run(
          id,
          who.email,
          who.email.split("@")[0].slice(0, 80),
          randomBytes(16).toString("hex") +
            ":" +
            randomBytes(64).toString("hex"),
          now(),
        );
      link(id);
      this.sec.consumeInvite({ kind: "user", id }, invite);
      return publicUser(this.sec.user(id));
    });
  }

  // ---- change feed: the audit log's rowid is a monotonic sequence, so clients can catch up after a restart.
  eventsSince(scoped, after, limit) {
    after = Math.max(0, Number(after) || 0);
    limit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const a = scoped.actor;
    let rows;
    if (a.kind === "agent") {
      rows = this.db
        .prepare(
          `SELECT l.rowid seq,l.action,l.target,l.created_at FROM audit l
           JOIN messages m ON m.id=l.target
           LEFT JOIN recipients r ON r.message_id=m.id
           WHERE l.rowid>? AND l.action='message.sent' AND m.project_id=? AND (m.sender_id=? OR r.agent_id=?)
           GROUP BY l.rowid ORDER BY l.rowid LIMIT ?`,
        )
        .all(after, a.project_id, a.agent_id, a.agent_id, limit);
    } else {
      // Members and viewers don't see administrative events (the audit log is admin-only).
      const mine = this.sec.teams(a),
        admin = mine
          .filter((t) => ["owner", "admin"].includes(t.role))
          .map((t) => t.id),
        other = mine.filter((t) => !admin.includes(t.id)).map((t) => t.id),
        hidden = [
          "key.*",
          "personal_key.*",
          "invitation.*",
          "team.*",
          "instance.*",
          "user.*",
          "account.*",
          "mfa.*",
          "password.*",
          "oauth.*",
        ],
        marks = (list) => list.map(() => "?").join(",") || "NULL";
      rows =
        admin.length || other.length
          ? this.db
              .prepare(
                `SELECT l.rowid seq,l.action,l.target,l.created_at,u.name actor FROM audit l LEFT JOIN users u ON u.id=l.actor_id
                 WHERE l.rowid>? AND (l.team_id IN (${marks(admin)}) OR (l.team_id IN (${marks(other)}) AND ${hidden.map(() => "l.action NOT GLOB ?").join(" AND ")}))
                 ORDER BY l.rowid LIMIT ?`,
              )
              .all(after, ...admin, ...other, ...hidden, limit)
          : [];
    }
    return {
      events: rows,
      next_seq: rows.length ? rows[rows.length - 1].seq : after,
      latest_seq: this.db
        .prepare("SELECT COALESCE(MAX(rowid),0) m FROM audit")
        .get().m,
    };
  }
}

// Reads the pixel size from a PNG or JPEG header, and rejects anything else.
function imageInfo(buf) {
  if (
    buf.length > 24 &&
    buf.readUInt32BE(0) === 0x89504e47 &&
    buf.readUInt32BE(4) === 0x0d0a1a0a
  )
    return {
      mime: "image/png",
      w: buf.readUInt32BE(16),
      h: buf.readUInt32BE(20),
    };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (
        marker === 0xff ||
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += marker === 0xff ? 1 : 2;
        continue;
      }
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        return {
          mime: "image/jpeg",
          h: buf.readUInt16BE(i + 5),
          w: buf.readUInt16BE(i + 7),
        };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
