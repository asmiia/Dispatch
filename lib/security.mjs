import { checkActive, checkContacts } from "./coordination.mjs";
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
  scrypt,
} from "node:crypto";
import { promisify } from "node:util";
import { store, MailError, text } from "./store.mjs";
import { publish } from "./events.mjs";
import { agentName } from "./names.mjs";
const derive = promisify(scrypt);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
// Key lifetime in days; 0 means the key never expires.
const NEVER = 253402300799000;
function expiry(input, fallback = 30) {
  const days = Number(input.days ?? fallback);
  if (days === 0) return NEVER;
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new MailError(
      "Key lifetime must be 0 (never expires) or 1 to 3650 days",
    );
  return Date.now() + days * 86400000;
}
const roles = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  site_admin: !!user.site_admin,
  disabled: !!user.disabled,
  avatar_v: user.avatar_v || null,
});
export function email(value) {
  value = text(value, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new MailError("Enter a valid email");
  return value;
}
export async function passwordHash(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new MailError("Use a password between 12 and 128 characters");
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString("hex")}`;
}
export async function passwordMatches(value, stored) {
  if (typeof value !== "string" || value.length > 128) return false;
  const [salt, key] = stored.split(":");
  const candidate = await derive(value, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(candidate, Buffer.from(key, "hex"));
}

export class Security {
  constructor(mail) {
    this.mail = mail;
    this.db = mail.db;
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,site_admin INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,name TEXT NOT NULL,quota_bytes INTEGER NOT NULL DEFAULT 268435456,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships(team_id TEXT NOT NULL REFERENCES teams(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(team_id,user_id));
      CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,team_id TEXT NOT NULL REFERENCES teams(id),email TEXT NOT NULL,role TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,used_at TEXT,created_by TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS agent_keys(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id),issuer_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL,last_used TEXT);
      CREATE TABLE IF NOT EXISTS file_owners(file_id TEXT PRIMARY KEY REFERENCES attachments(id),principal_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,team_id TEXT,actor_id TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,start INTEGER NOT NULL,count INTEGER NOT NULL);`);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS personal_keys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),team_id TEXT NOT NULL REFERENCES teams(id),name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),agent_id TEXT NOT NULL REFERENCES agents(id),path TEXT NOT NULL,exclusive INTEGER NOT NULL,reason TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL);`);
    this.db
      .exec(`CREATE INDEX IF NOT EXISTS messages_project_time ON messages(project_id,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS recipients_agent_read ON recipients(agent_id,read_at,message_id);
      CREATE INDEX IF NOT EXISTS files_messages ON message_files(file_id,message_id);
      CREATE INDEX IF NOT EXISTS reservations_project_expiry ON reservations(project_id,expires_at);
      CREATE INDEX IF NOT EXISTS audit_team_time ON audit(team_id,created_at DESC);`);
    if (
      !this.db
        .prepare("PRAGMA table_info(projects)")
        .all()
        .some((c) => c.name === "team_id")
    )
      this.db.exec(
        "ALTER TABLE projects ADD COLUMN team_id TEXT REFERENCES teams(id)",
      );
    if (
      !this.db
        .prepare("PRAGMA table_info(sessions)")
        .all()
        .some((c) => c.name === "user_id")
    ) {
      this.db.exec(
        "ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES users(id); DELETE FROM sessions;",
      );
    }
    for (const [table, column, type] of [
      ["sessions", "created_at", "TEXT"],
      ["sessions", "last_seen", "TEXT"],
      ["sessions", "ip", "TEXT"],
      ["sessions", "ua", "TEXT"],
      ["teams", "retention_days", "INTEGER NOT NULL DEFAULT 0"],
      ["users", "avatar", "BLOB"],
      ["users", "avatar_mime", "TEXT"],
      ["users", "avatar_v", "TEXT"],
    ])
      if (
        !this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((c) => c.name === column)
      )
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  log(actor, team, action, target) {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), team || null, actor.id, action, target, now());
    publish({ team_id: team, actor_id: actor.id, action, target });
  }
  rate(key, limit = 120, period = 60000) {
    const time = Date.now();
    this.db
      .prepare(
        "INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET start=CASE WHEN start<? THEN excluded.start ELSE start END,count=CASE WHEN start<? THEN 1 ELSE count+1 END",
      )
      .run(key, time, time - period, time - period);
    if (
      this.db.prepare("SELECT count FROM rate_limits WHERE key=?").get(key)
        .count > limit
    )
      throw new MailError("Too many requests. Try again shortly.", 429);
    this.db
      .prepare("DELETE FROM rate_limits WHERE start<?")
      .run(time - 86400000);
  }
  needsSetup() {
    return !this.db.prepare("SELECT 1 FROM users LIMIT 1").get();
  }
  user(id) {
    const u = this.db
      .prepare("SELECT * FROM users WHERE id=? AND disabled=0")
      .get(id);
    if (!u) throw new MailError("Sign in to continue", 401);
    return u;
  }
  human(actor) {
    if (actor.kind !== "user")
      throw new MailError("A user account is required", 403);
    return this.user(actor.id);
  }
  role(actor, team) {
    if (actor.team_scope && actor.team_scope !== team)
      throw new MailError("Not found", 404);
    const u = this.human(actor);
    if (u.site_admin) return "owner";
    const row = this.db
      .prepare("SELECT role FROM memberships WHERE team_id=? AND user_id=?")
      .get(team, u.id);
    if (!row) throw new MailError("Not found", 404);
    return row.role;
  }
  requireRole(actor, team, minimum = "member") {
    const role = this.role(actor, team);
    if (roles[role] < roles[minimum])
      throw new MailError("Insufficient permissions", 403);
    return role;
  }
  teams(actor) {
    const u = this.human(actor);
    if (actor.team_scope) {
      const role = this.role(actor, actor.team_scope);
      return this.db
        .prepare("SELECT *,? role FROM teams WHERE id=?")
        .all(role, actor.team_scope);
    }
    return u.site_admin
      ? this.db
          .prepare("SELECT t.*,'owner' role FROM teams t ORDER BY created_at")
          .all()
      : this.db
          .prepare(
            "SELECT t.*,m.role FROM teams t JOIN memberships m ON m.team_id=t.id WHERE m.user_id=? ORDER BY t.created_at",
          )
          .all(u.id);
  }
  newTeam(actor, name) {
    if (actor.team_scope)
      throw new MailError("Team-scoped tokens cannot create other teams", 403);
    this.human(actor);
    name = text(name, "team name", 100);
    const id = randomUUID();
    return this.transaction(() => {
      this.db
        .prepare("INSERT INTO teams(id,name,created_at) VALUES(?,?,?)")
        .run(id, name, now());
      this.db
        .prepare("INSERT INTO memberships VALUES(?,?,?)")
        .run(id, actor.id, "owner");
      this.log(actor, id, "team.created", id);
      return this.db.prepare("SELECT * FROM teams WHERE id=?").get(id);
    });
  }
  async register(input, bootstrap) {
    this.rate("registration", 30, 300000);
    const address = email(input.email),
      name = text(input.name, "name", 80),
      encoded = await passwordHash(input.password);
    return this.transaction(() => {
      const first = this.needsSetup();
      if (first && !bootstrap)
        throw new MailError(
          "The setup key is required for the first account",
          403,
        );
      let invitation;
      if (!first) {
        invitation = this.invitation(input.invite_code);
        if (invitation.email !== address)
          throw new MailError("Invitation does not match this email", 403);
      }
      if (this.db.prepare("SELECT 1 FROM users WHERE email=?").get(address))
        throw new MailError("Account already exists. Sign in instead.", 409);
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO users(id,email,name,password_hash,site_admin,disabled,created_at) VALUES(?,?,?,?,?,0,?)",
        )
        .run(id, address, name, encoded, first ? 1 : 0, now());
      const actor = { kind: "user", id };
      if (first) {
        const team = randomUUID();
        this.db
          .prepare("INSERT INTO teams(id,name,created_at) VALUES(?,?,?)")
          .run(team, "My team", now());
        this.db
          .prepare("INSERT INTO memberships VALUES(?,?,?)")
          .run(team, id, "owner");
        this.db
          .prepare("UPDATE projects SET team_id=? WHERE team_id IS NULL")
          .run(team);
        this.log(actor, team, "instance.initialized", id);
      } else this.consumeInvite(actor, invitation);
      return publicUser(this.user(id));
    });
  }
  async signIn(input) {
    const address = email(input.email);
    this.rate("login:global", 100, 300000);
    this.rate("login:" + hash(address), 10, 300000);
    const user = this.db
      .prepare("SELECT * FROM users WHERE email=?")
      .get(address);
    const encoded =
      user?.password_hash ||
      "00000000000000000000000000000000:" + "0".repeat(128);
    const matches = await passwordMatches(input.password, encoded);
    if (!user || user.disabled || !matches)
      throw new MailError("Incorrect email or password", 401);
    return publicUser(user);
  }
  session(user, meta = {}) {
    const raw = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    this.db
      .prepare(
        "INSERT INTO sessions(hash,expires_at,user_id,created_at,last_seen,ip,ua) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        hash(raw),
        Date.now() + 86400000,
        user.id,
        now(),
        now(),
        meta.ip || null,
        String(meta.ua || "").slice(0, 200) || null,
      );
    return raw;
  }
  authenticate(request) {
    const authorization = request.headers.get("authorization");
    if (authorization) {
      if (!authorization.startsWith("Bearer "))
        throw new MailError("Invalid credentials", 401);
      const raw = authorization.slice(7);
      if (raw.length > 200) throw new MailError("Invalid credentials", 401);
      if (raw.startsWith("at_user_")) {
        const key = this.db
          .prepare(
            "SELECT k.* FROM personal_keys k JOIN users u ON u.id=k.user_id WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>? AND u.disabled=0",
          )
          .get(hash(raw), Date.now());
        if (!key) throw new MailError("Invalid or expired user key", 401);
        const actor = {
          kind: "user",
          id: key.user_id,
          token_id: key.id,
          team_scope: key.team_id,
        };
        this.role(actor, key.team_id);
        this.rate("personal:" + key.id, 240);
        return actor;
      }
      const key = this.db
        .prepare(
          "SELECT k.*,a.project_id,a.name agent_name FROM agent_keys k JOIN agents a ON a.id=k.agent_id JOIN users u ON u.id=k.issuer_id WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>? AND u.disabled=0",
        )
        .get(hash(raw), Date.now());
      if (!key) throw new MailError("Invalid or expired agent key", 401);
      const p = this.mail.project(key.project_id);
      this.requireRole(
        { kind: "user", id: key.issuer_id },
        p.team_id,
        "member",
      );
      this.rate("key:" + key.id, 240);
      this.db
        .prepare("UPDATE agent_keys SET last_used=? WHERE id=?")
        .run(now(), key.id);
      return {
        kind: "agent",
        id: key.id,
        agent_id: key.agent_id,
        agent_name: key.agent_name,
        project_id: key.project_id,
      };
    }
    const raw = request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)dispatch_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const session =
      raw &&
      this.db
        .prepare("SELECT user_id FROM sessions WHERE hash=? AND expires_at>?")
        .get(hash(raw), Date.now());
    if (!session?.user_id) throw new MailError("Sign in to continue", 401);
    this.user(session.user_id);
    // Record activity at most once a minute.
    this.db
      .prepare(
        "UPDATE sessions SET last_seen=? WHERE hash=? AND (last_seen IS NULL OR last_seen<?)",
      )
      .run(now(), hash(raw), new Date(Date.now() - 60000).toISOString());
    return { kind: "user", id: session.user_id, session: hash(raw) };
  }
  invitation(code) {
    if (typeof code !== "string" || code.length > 200)
      throw new MailError("Invalid invitation", 403);
    const i = this.db
      .prepare(
        "SELECT * FROM invitations WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
      )
      .get(hash(code), Date.now());
    if (!i) throw new MailError("Invalid or expired invitation", 403);
    this.requireRole({ kind: "user", id: i.created_by }, i.team_id, "admin");
    return i;
  }
  consumeInvite(actor, invitation) {
    this.db
      .prepare(
        "INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(team_id,user_id) DO NOTHING",
      )
      .run(invitation.team_id, actor.id, invitation.role);
    const changed = this.db
      .prepare(
        "UPDATE invitations SET used_at=? WHERE id=? AND used_at IS NULL",
      )
      .run(now(), invitation.id);
    if (!changed.changes) throw new MailError("Invitation already used", 409);
    this.log(actor, invitation.team_id, "invitation.accepted", invitation.id);
  }
  join(actor, code) {
    const user = this.human(actor);
    return this.transaction(() => {
      const i = this.invitation(code);
      if (actor.team_scope && actor.team_scope !== i.team_id)
        throw new MailError("Credential is restricted to another team", 403);
      if (i.email !== user.email)
        throw new MailError("Invitation does not match your email", 403);
      this.consumeInvite(actor, i);
      return { ok: true };
    });
  }
  invite(actor, input) {
    const role = this.requireRole(actor, input.team_id, "admin");
    if (
      !["viewer", "member", "admin"].includes(input.role) ||
      (input.role === "admin" && role !== "owner")
    )
      throw new MailError("Cannot grant that role", 403);
    const code = randomBytes(32).toString("base64url"),
      id = randomUUID();
    this.db
      .prepare("INSERT INTO invitations VALUES(?,?,?,?,?,?,NULL,?)")
      .run(
        id,
        input.team_id,
        email(input.email),
        input.role,
        hash(code),
        Date.now() + 7 * 86400000,
        actor.id,
      );
    this.log(actor, input.team_id, "invitation.created", id);
    return { id, code };
  }
  settings(actor, team) {
    this.human(actor);
    const list = this.teams(actor);
    team = team || list[0]?.id;
    const role = team ? this.role(actor, team) : null;
    const admin = roles[role] >= 2;
    return {
      user: publicUser(this.user(actor.id)),
      teams: list,
      team_id: team,
      role,
      usage_bytes: team
        ? this.db
            .prepare(
              "SELECT COALESCE(SUM(a.size),0) n FROM attachments a JOIN projects p ON p.id=a.project_id WHERE p.team_id=?",
            )
            .get(team).n
        : 0,
      members: team
        ? this.db
            .prepare(
              "SELECT u.id,u.name,u.email,u.disabled,u.avatar_v,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE team_id=? ORDER BY u.name",
            )
            .all(team)
        : [],
      invitations: admin
        ? this.db
            .prepare(
              "SELECT id,email,role,expires_at,used_at FROM invitations WHERE team_id=? ORDER BY expires_at DESC LIMIT 100",
            )
            .all(team)
        : [],
      keys: team
        ? this.db
            .prepare(
              "SELECT k.id,k.name,k.created_at,k.expires_at,k.revoked_at,k.last_used,a.name agent_name,p.name project_name FROM agent_keys k JOIN agents a ON a.id=k.agent_id JOIN projects p ON p.id=a.project_id WHERE p.team_id=? AND (?=1 OR k.issuer_id=?) ORDER BY k.created_at DESC",
            )
            .all(team, admin ? 1 : 0, actor.id)
        : [],
      audit: admin
        ? this.db
            .prepare(
              "SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE team_id=? ORDER BY created_at DESC LIMIT 100",
            )
            .all(team)
        : [],
      projects: admin
        ? this.db
            .prepare(
              "SELECT p.id,p.name,p.created_at,(SELECT COUNT(*) FROM messages m WHERE m.project_id=p.id) messages FROM projects p WHERE p.team_id=? ORDER BY p.created_at",
            )
            .all(team)
        : [],
      personal_keys: this.db
        .prepare(
          "SELECT id,team_id,name,expires_at,revoked_at,created_at FROM personal_keys WHERE user_id=? AND team_id=? ORDER BY created_at DESC",
        )
        .all(actor.id, team || null),
      users:
        this.user(actor.id).site_admin && !actor.team_scope
          ? this.db
              .prepare(
                `SELECT u.id,u.email,u.name,u.site_admin,u.disabled,u.created_at,u.avatar_v,
                  (SELECT MAX(l.created_at) FROM login_events l WHERE l.user_id=u.id AND l.ok=1) last_login,
                  (SELECT enabled FROM mfa WHERE user_id=u.id) mfa,
                  (SELECT group_concat(t.name || ' (' || m.role || ')', ', ') FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=u.id) teams
                 FROM users u ORDER BY u.created_at`,
              )
              .all()
          : [],
    };
  }
  member(actor, input) {
    const role = this.requireRole(actor, input.team_id, "admin");
    const old = this.db
      .prepare("SELECT role FROM memberships WHERE team_id=? AND user_id=?")
      .get(input.team_id, input.user_id);
    if (!old) throw new MailError("Member not found", 404);
    if (
      old.role === "owner" ||
      input.user_id === actor.id ||
      (role !== "owner" && old.role === "admin")
    )
      throw new MailError("Cannot change this membership", 403);
    if (input.remove)
      this.db
        .prepare("DELETE FROM memberships WHERE team_id=? AND user_id=?")
        .run(input.team_id, input.user_id);
    else {
      if (
        !["admin", "member", "viewer"].includes(input.role) ||
        (input.role === "admin" && role !== "owner")
      )
        throw new MailError("Cannot grant this role", 403);
      this.db
        .prepare("UPDATE memberships SET role=? WHERE team_id=? AND user_id=?")
        .run(input.role, input.team_id, input.user_id);
    }
    this.log(
      actor,
      input.team_id,
      input.remove ? "member.removed" : "member.role_changed",
      input.user_id,
    );
    return { ok: true };
  }
  updateTeam(actor, input) {
    this.requireRole(actor, input.team_id, "admin");
    const name = text(input.name, "team name", 100),
      quota = Number(input.quota_bytes);
    if (
      !Number.isSafeInteger(quota) ||
      quota < 6 * 1024 * 1024 ||
      quota > 10 * 1024 ** 3
    )
      throw new MailError("Quota must be between 6 MiB and 10 GiB");
    this.db
      .prepare("UPDATE teams SET name=?,quota_bytes=? WHERE id=?")
      .run(name, quota, input.team_id);
    this.log(actor, input.team_id, "team.updated", input.team_id);
    return { ok: true };
  }
  setRetention(actor, input) {
    this.requireRole(actor, input.team_id, "admin");
    const days = Number(input.days);
    if (!Number.isInteger(days) || days < 0 || days > 3650)
      throw new MailError("Retention must be 0 (keep forever) to 3650 days");
    this.db
      .prepare("UPDATE teams SET retention_days=? WHERE id=?")
      .run(days, input.team_id);
    this.log(actor, input.team_id, "team.retention_changed", String(days));
    return { ok: true };
  }
  revokeInvite(actor, id) {
    const i = this.db
      .prepare("SELECT team_id FROM invitations WHERE id=?")
      .get(id);
    if (!i) throw new MailError("Not found", 404);
    this.requireRole(actor, i.team_id, "admin");
    this.db
      .prepare("UPDATE invitations SET used_at=? WHERE id=?")
      .run(now(), id);
    this.log(actor, i.team_id, "invitation.revoked", id);
    return { ok: true };
  }
  issueKey(actor, input) {
    this.human(actor);
    const access = new ScopedMail(this, actor),
      p = access.project(input.project_key, "member"),
      a = this.mail.agent(p.id, input.agent_name),
      raw = "at_" + randomBytes(32).toString("base64url");
    const expires = expiry(input);
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO agent_keys VALUES(?,?,?,?,?,?,NULL,?,NULL)")
      .run(
        id,
        a.id,
        actor.id,
        text(input.name, "key label", 80),
        hash(raw),
        expires,
        now(),
      );
    this.log(actor, p.team_id, "key.created", id);
    return { id, token: raw };
  }
  revokeKey(actor, id) {
    this.human(actor);
    const k = this.db
      .prepare(
        "SELECT k.issuer_id,p.team_id FROM agent_keys k JOIN agents a ON a.id=k.agent_id JOIN projects p ON p.id=a.project_id WHERE k.id=?",
      )
      .get(id);
    if (!k) throw new MailError("Not found", 404);
    if (k.issuer_id !== actor.id) this.requireRole(actor, k.team_id, "admin");
    this.db
      .prepare("UPDATE agent_keys SET revoked_at=? WHERE id=?")
      .run(now(), id);
    this.log(actor, k.team_id, "key.revoked", id);
    return { ok: true };
  }
  disableUser(actor, input) {
    if (actor.team_scope)
      throw new MailError(
        "Instance administration requires a browser session",
        403,
      );
    const admin = this.human(actor);
    if (!admin.site_admin || input.user_id === actor.id)
      throw new MailError("Cannot modify this account", 403);
    this.db
      .prepare("UPDATE users SET disabled=? WHERE id=?")
      .run(input.disabled ? 1 : 0, input.user_id);
    if (input.disabled)
      this.db
        .prepare("DELETE FROM sessions WHERE user_id=?")
        .run(input.user_id);
    this.log(actor, null, "user.status_changed", input.user_id);
    return { ok: true };
  }
  async profile(actor, input) {
    if (actor.team_scope)
      throw new MailError("Account changes require a browser session", 403);
    const user = this.human(actor);
    if (input.password) {
      if (!(await passwordMatches(input.current_password, user.password_hash)))
        throw new MailError("Current password is incorrect", 403);
      const encoded = await passwordHash(input.password);
      this.db
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(encoded, user.id);
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      this.db
        .prepare(
          "UPDATE personal_keys SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
        )
        .run(now(), user.id);
    }
    if (input.name)
      this.db
        .prepare("UPDATE users SET name=? WHERE id=?")
        .run(text(input.name, "name", 80), user.id);
    this.log(actor, null, "account.updated", user.id);
    return { ok: true, sign_in_again: !!input.password };
  }
  issuePersonalKey(actor, input) {
    this.human(actor);
    if (actor.team_scope)
      throw new MailError("Create personal credentials in your browser", 403);
    this.role(actor, input.team_id);
    const expires = expiry(input);
    const id = randomUUID(),
      token = "at_user_" + randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO personal_keys VALUES(?,?,?,?,?,?,NULL,?)")
      .run(
        id,
        actor.id,
        input.team_id,
        text(input.name, "credential label", 80),
        hash(token),
        expires,
        now(),
      );
    this.log(actor, input.team_id, "personal_key.created", id);
    return { id, token };
  }
  revokePersonalKey(actor, id) {
    this.human(actor);
    const key = this.db
      .prepare("SELECT * FROM personal_keys WHERE id=? AND user_id=?")
      .get(id, actor.id);
    if (!key) throw new MailError("Not found", 404);
    if (actor.team_scope && actor.team_scope !== key.team_id)
      throw new MailError("Not found", 404);
    this.db
      .prepare("UPDATE personal_keys SET revoked_at=? WHERE id=?")
      .run(now(), id);
    this.log(actor, key.team_id, "personal_key.revoked", id);
    return { ok: true };
  }
}

export class ScopedMail {
  constructor(security, actor) {
    this.security = security;
    this.actor = actor;
    this.base = security.mail;
    this.db = security.db;
  }
  project(key, minimum = "viewer") {
    if (this.actor.kind === "agent") checkActive(this.db, this.actor.agent_id);
    key = text(key, "project", 500);
    let p;
    if (this.actor.kind === "agent") {
      p = this.base.project(this.actor.project_id);
      if (p.id !== key && p.name !== key) throw new MailError("Not found", 404);
    } else {
      const user = this.security.human(this.actor);
      p = user.site_admin
        ? this.db
            .prepare("SELECT * FROM projects WHERE id=? OR name=?")
            .get(key, key)
        : this.db
            .prepare(
              "SELECT p.* FROM projects p JOIN memberships m ON m.team_id=p.team_id WHERE m.user_id=? AND (p.id=? OR p.name=?)",
            )
            .get(user.id, key, key);
      if (!p) throw new MailError("Not found", 404);
      this.security.requireRole(this.actor, p.team_id, minimum);
    }
    return p;
  }
  projects() {
    if (this.actor.kind === "agent")
      return [this.project(this.actor.project_id)];
    const u = this.security.human(this.actor);
    return this.base
      .projects()
      .filter(
        (p) =>
          (!this.actor.team_scope || p.team_id === this.actor.team_scope) &&
          (u.site_admin ||
            this.db
              .prepare(
                "SELECT 1 FROM memberships WHERE team_id=? AND user_id=?",
              )
              .get(p.team_id, u.id)),
      );
  }
  ensureProject(name, team) {
    if (this.actor.kind === "agent") return this.project(name);
    this.security.human(this.actor);
    team = team || this.security.teams(this.actor)[0]?.id;
    if (!team) throw new MailError("Create a team first");
    this.security.requireRole(this.actor, team, "admin");
    name = text(name, "project name", 500);
    const existing = this.db
      .prepare("SELECT * FROM projects WHERE team_id=? AND name=?")
      .get(team, name);
    if (existing) return existing;
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO projects(id,name,created_at,team_id) VALUES(?,?,?,?)",
      )
      .run(id, name, now(), team);
    this.security.log(this.actor, team, "project.created", id);
    return this.base.project(id);
  }
  register(input) {
    const p = this.project(input.project_key, "member");
    if (
      this.actor.kind === "agent" &&
      input.name &&
      input.name !== this.actor.agent_name
    )
      throw new MailError("Agent identity is fixed by its credential", 403);
    const registered = this.base.register({
      ...input,
      project_key: p.id,
      name:
        this.actor.kind === "agent"
          ? this.actor.agent_name
          : String(input.name || "").trim() ||
            agentName(new Set(this.base.agents(p.id).map((a) => a.name))),
    });
    this.security.log(this.actor, p.team_id, "agent.updated", registered.id);
    return registered;
  }
  // Each agent carries the person who first issued a key for it, so the UI can group agents under their owner.
  agents(key) {
    const owners = new Map(
      this.db
        .prepare(
          "SELECT k.agent_id,u.id owner_id,u.name owner_name FROM agent_keys k JOIN users u ON u.id=k.issuer_id ORDER BY k.created_at DESC",
        )
        .all()
        .map((r) => [r.agent_id, r]),
    );
    const names = new Map(
      this.db
        .prepare("SELECT id,name,avatar_v FROM users")
        .all()
        .map((u) => [u.id, u]),
    );
    return this.base.agents(this.project(key).id).map((a) => {
      // A person's identity records who they are in its model ("web:<user id>").
      const person = a.program === "human" ? a.model.split(":")[1] : null,
        owner_id = person || owners.get(a.id)?.owner_id || null;
      return {
        ...a,
        owner_id,
        owner_name: owner_id ? names.get(owner_id)?.name || null : null,
        owner_avatar_v: owner_id ? names.get(owner_id)?.avatar_v || null : null,
      };
    });
  }
  send(input) {
    const p = this.project(input.project_key, "member");
    if (
      this.actor.kind === "agent" &&
      input.sender_name !== this.actor.agent_name
    )
      throw new MailError("Cannot impersonate another agent", 403);
    if (this.actor.kind === "agent" && input.thread_id) {
      const allowed = this.db
        .prepare(
          "SELECT 1 FROM messages m LEFT JOIN recipients r ON r.message_id=m.id WHERE m.project_id=? AND m.thread_id=? AND (m.sender_id=? OR r.agent_id=?) LIMIT 1",
        )
        .get(p.id, input.thread_id, this.actor.agent_id, this.actor.agent_id);
      if (!allowed) throw new MailError("Thread not found", 404);
    }
    for (const id of input.attachment_paths || []) this.file(id);
    checkContacts(this, p, input);
    const message = this.base.send({ ...input, project_key: p.id });
    this.security.log(this.actor, p.team_id, "message.sent", message.id);
    return message;
  }
  message(id) {
    const m = this.base.message(id);
    this.project(m.project_id);
    if (
      this.actor.kind === "agent" &&
      m.sender_id !== this.actor.agent_id &&
      !m.recipients.some((r) => r.name === this.actor.agent_name)
    )
      throw new MailError("Not found", 404);
    return m;
  }
  thread(id) {
    this.message(id);
    return this.base
      .thread(id)
      .filter(
        (m) =>
          this.actor.kind === "user" ||
          m.sender_id === this.actor.agent_id ||
          m.recipients.some((r) => r.name === this.actor.agent_name),
      );
  }
  inbox(key, name, query = "") {
    const p = this.project(key);
    if (this.actor.kind === "agent" && name && name !== this.actor.agent_name)
      throw new MailError("Cannot read another agent inbox", 403);
    return this.base.inbox(
      p.id,
      this.actor.kind === "agent" ? this.actor.agent_name : name,
      query,
    );
  }
  read(id, name) {
    const m = this.message(id);
    this.project(m.project_id, "member");
    if (this.actor.kind === "agent" && name !== this.actor.agent_name)
      throw new MailError("Cannot change another agent receipt", 403);
    const read = this.base.read(id, name);
    this.security.log(
      this.actor,
      m.team_id || this.base.project(m.project_id).team_id,
      "message.read",
      id,
    );
    return read;
  }
  file(id) {
    const f = this.base.file(id);
    this.project(f.project_id);
    if (this.actor.kind === "agent") {
      const own = this.db
        .prepare("SELECT 1 FROM file_owners WHERE file_id=? AND principal_id=?")
        .get(id, this.actor.id);
      const shared = this.db
        .prepare(
          "SELECT 1 FROM message_files mf JOIN messages m ON m.id=mf.message_id LEFT JOIN recipients r ON r.message_id=m.id WHERE mf.file_id=? AND (m.sender_id=? OR r.agent_id=?) LIMIT 1",
        )
        .get(id, this.actor.agent_id, this.actor.agent_id);
      if (!own && !shared) throw new MailError("Not found", 404);
    }
    return f;
  }
  upload(key, name, bytes) {
    const p = this.project(key, "member");
    return this.security.transaction(() => {
      const team = this.db
        .prepare("SELECT quota_bytes FROM teams WHERE id=?")
        .get(p.team_id);
      const used = this.db
        .prepare(
          "SELECT coalesce(sum(a.size),0) total FROM attachments a JOIN projects p ON p.id=a.project_id WHERE p.team_id=?",
        )
        .get(p.team_id).total;
      if (used + bytes.length > team.quota_bytes)
        throw new MailError("Team storage quota exceeded", 413);
      const file = this.base.upload(p.id, name, bytes);
      this.db
        .prepare("INSERT INTO file_owners VALUES(?,?)")
        .run(file.id, this.actor.id);
      this.security.log(this.actor, p.team_id, "file.uploaded", file.id);
      return file;
    });
  }
  download(id) {
    this.file(id);
    return this.base.download(id);
  }
}
export function security() {
  if (!globalThis.__agentTeamSecurity)
    globalThis.__agentTeamSecurity = new Security(store());
  return globalThis.__agentTeamSecurity;
}
