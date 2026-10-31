import { unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { MailError } from "./store.mjs";

const marks = (list) => list.map(() => "?").join(",");
const chunks = (list, size = 400) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// ---- row removal (callers run these inside one transaction) ----
function removeMessages(db, ids) {
  const candidates = [];
  for (const part of chunks(ids)) {
    const m = marks(part);
    candidates.push(
      ...db
        .prepare(`SELECT DISTINCT file_id FROM message_files WHERE message_id IN (${m})`)
        .all(...part)
        .map((r) => r.file_id),
    );
    for (const table of ["acknowledgments", "recipients", "message_files", "idempotency"])
      db.prepare(`DELETE FROM ${table} WHERE message_id IN (${m})`).run(...part);
    db.prepare(`DELETE FROM messages WHERE id IN (${m})`).run(...part);
  }
  // A file survives if another message still attaches it.
  return [...new Set(candidates)].filter(
    (id) => !db.prepare("SELECT 1 FROM message_files WHERE file_id=?").get(id),
  );
}
function removeFiles(db, ids) {
  for (const part of chunks(ids)) {
    const m = marks(part);
    db.prepare(`DELETE FROM file_owners WHERE file_id IN (${m})`).run(...part);
    db.prepare(`DELETE FROM attachments WHERE id IN (${m})`).run(...part);
  }
}
function removeProject(db, projectId) {
  const messageIds = db.prepare("SELECT id FROM messages WHERE project_id=?").all(projectId).map((r) => r.id);
  removeMessages(db, messageIds);
  const files = db.prepare("SELECT id FROM attachments WHERE project_id=?").all(projectId).map((r) => r.id);
  removeFiles(db, files);
  for (const table of ["contacts", "product_projects", "build_slots", "reservations"])
    db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(projectId);
  const agents = db.prepare("SELECT id FROM agents WHERE project_id=?").all(projectId).map((r) => r.id);
  for (const part of chunks(agents)) {
    const m = marks(part);
    for (const [table, col] of [
      ["agent_keys", "agent_id"],
      ["agent_profiles", "agent_id"],
      ["recipients", "agent_id"],
      ["acknowledgments", "agent_id"],
      ["contacts", "sender_id"],
      ["contacts", "recipient_id"],
    ])
      db.prepare(`DELETE FROM ${table} WHERE ${col} IN (${m})`).run(...part);
  }
  db.prepare("DELETE FROM agents WHERE project_id=?").run(projectId);
  db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
  return { messages: messageIds.length, files };
}
function unlinkFiles(directory, ids) {
  for (const id of ids)
    try {
      unlinkSync(join(directory, "files", id));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
}

// ---- operations ----
export function deleteMessages(sec, ids) {
  ids = [...new Set(ids)];
  const orphaned = sec.transaction(() => {
    const files = removeMessages(sec.db, ids);
    removeFiles(sec.db, files);
    return files;
  });
  unlinkFiles(sec.mail.directory, orphaned);
  return { messages: ids.length, files: orphaned.length };
}

// Admin-only: every message must belong to a team the actor administers.
export function deleteMessagesAs(sec, actor, ids) {
  sec.human(actor);
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((i) => typeof i !== "string"))
    throw new MailError("Choose between 1 and 500 messages");
  const found = ids.map((id) =>
    sec.db
      .prepare("SELECT m.id,p.team_id FROM messages m JOIN projects p ON p.id=m.project_id WHERE m.id=?")
      .get(id),
  );
  if (found.some((f) => !f)) throw new MailError("Not found", 404);
  for (const team of new Set(found.map((f) => f.team_id))) sec.requireRole(actor, team, "admin");
  const result = deleteMessages(sec, ids);
  for (const team of new Set(found.map((f) => f.team_id)))
    sec.log(actor, team, "messages.deleted", `${found.filter((f) => f.team_id === team).length} messages`);
  return result;
}

export function deleteProjectAs(sec, actor, key, confirm) {
  sec.human(actor);
  const project = sec.db
    .prepare("SELECT * FROM projects WHERE id=? OR name=?")
    .all(key, key)
    .find((p) => p.team_id && (() => { try { sec.requireRole(actor, p.team_id, "admin"); return true; } catch { return false; } })());
  if (!project) throw new MailError("Not found", 404);
  if (confirm !== project.name) throw new MailError("Type the project name to confirm");
  let result;
  sec.transaction(() => {
    result = removeProject(sec.db, project.id);
  });
  unlinkFiles(sec.mail.directory, result.files);
  sec.log(actor, project.team_id, "project.deleted", `${project.name} (${result.messages} messages)`);
  return { messages: result.messages, files: result.files.length };
}

export function deleteTeamAs(sec, actor, teamId, confirm) {
  const role = sec.requireRole(actor, teamId, "owner");
  if (actor.team_scope) throw new MailError("A browser session is required", 403);
  const team = sec.db.prepare("SELECT * FROM teams WHERE id=?").get(teamId);
  if (confirm !== team.name) throw new MailError("Type the team name to confirm");
  let messages = 0;
  const files = [];
  sec.transaction(() => {
    for (const p of sec.db.prepare("SELECT id FROM projects WHERE team_id=?").all(teamId)) {
      const r = removeProject(sec.db, p.id);
      messages += r.messages;
      files.push(...r.files);
    }
    const products = sec.db.prepare("SELECT id FROM coordination_products WHERE team_id=?").all(teamId).map((r) => r.id);
    for (const part of chunks(products)) {
      sec.db.prepare(`DELETE FROM product_projects WHERE product_id IN (${marks(part)})`).run(...part);
      sec.db.prepare(`DELETE FROM coordination_products WHERE id IN (${marks(part)})`).run(...part);
    }
    for (const table of ["invitations", "personal_keys", "memberships", "audit"])
      sec.db.prepare(`DELETE FROM ${table} WHERE team_id=?`).run(teamId);
    sec.db.prepare("DELETE FROM teams WHERE id=?").run(teamId);
  });
  unlinkFiles(sec.mail.directory, files);
  sec.log(actor, null, "team.deleted", `${team.name} (${messages} messages, role ${role})`);
  return { messages, files: files.length };
}

// Removes an account and everything that identifies it. Refuses to orphan a team or the last administrator.
export function deleteUserRecords(sec, userId) {
  const user = sec.db.prepare("SELECT * FROM users WHERE id=?").get(userId);
  if (!user) throw new MailError("Account not found", 404);
  for (const m of sec.db.prepare("SELECT m.team_id,t.name FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=? AND m.role='owner'").all(userId)) {
    const others = sec.db
      .prepare("SELECT COUNT(*) c FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=? AND m.role='owner' AND m.user_id!=? AND u.disabled=0")
      .get(m.team_id, userId).c;
    if (!others) throw new MailError(`Transfer ownership of "${m.name}" or delete that team first`, 409);
  }
  if (user.site_admin && !sec.db.prepare("SELECT COUNT(*) c FROM users WHERE site_admin=1 AND disabled=0 AND id!=?").get(userId).c)
    throw new MailError("This is the only instance administrator", 409);
  sec.transaction(() => {
    const db = sec.db;
    for (const [table, col] of [
      ["sessions", "user_id"],
      ["mfa_challenges", "user_id"],
      ["mfa", "user_id"],
      ["password_resets", "user_id"],
      ["oauth_identities", "user_id"],
      ["personal_keys", "user_id"],
      ["invitations", "created_by"],
      ["agent_keys", "issuer_id"],
      ["memberships", "user_id"],
      ["login_events", "user_id"],
    ])
      db.prepare(`DELETE FROM ${table} WHERE ${col}=?`).run(userId);
    db.prepare("UPDATE audit SET actor_id='deleted' WHERE actor_id=?").run(userId);
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
  });
  return user;
}

// ---- export ----
export function exportAccount(sec, actor) {
  const user = sec.human(actor),
    db = sec.db;
  const rows = (sql, ...a) => db.prepare(sql).all(...a);
  return {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email, name: user.name, site_admin: !!user.site_admin, created_at: user.created_at },
    teams: rows("SELECT t.name,m.role FROM memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=?", user.id),
    two_factor_enabled: !!db.prepare("SELECT enabled FROM mfa WHERE user_id=?").get(user.id)?.enabled,
    linked_sign_ins: rows("SELECT provider,email,created_at FROM oauth_identities WHERE user_id=?", user.id),
    personal_tokens: rows("SELECT name,created_at,expires_at,revoked_at FROM personal_keys WHERE user_id=?", user.id),
    agent_keys_issued: rows("SELECT name,created_at,expires_at,revoked_at,last_used FROM agent_keys WHERE issuer_id=?", user.id),
    sign_in_history: rows("SELECT method,ok,reason,ip,created_at FROM login_events WHERE user_id=? ORDER BY created_at DESC LIMIT 500", user.id),
    activity: rows("SELECT action,target,created_at FROM audit WHERE actor_id=? ORDER BY created_at DESC LIMIT 5000", user.id),
  };
}

const tarHeader = (name, size, mtime) => {
  const b = Buffer.alloc(512);
  b.write(name, 0, 100);
  b.write("0000644\0", 100);
  b.write("0000000\0", 108);
  b.write("0000000\0", 116);
  b.write(size.toString(8).padStart(11, "0") + "\0", 124);
  b.write(Math.floor(mtime / 1000).toString(8).padStart(11, "0") + "\0", 136);
  b.write("        ", 148);
  b.write("0", 156);
  b.write("ustar\0" + "00", 257);
  let sum = 0;
  for (const v of b) sum += v;
  b.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return b;
};
const tarEntry = (name, bytes) => [
  tarHeader(name, bytes.length, Date.now()),
  bytes,
  Buffer.alloc((512 - (bytes.length % 512)) % 512),
];

// Everything in a team as a .tar.gz: export.json plus attachments, built in memory per file.
export function exportTeam(sec, actor, teamId) {
  sec.requireRole(actor, teamId, "admin");
  const db = sec.db,
    team = db.prepare("SELECT * FROM teams WHERE id=?").get(teamId);
  const projects = db.prepare("SELECT * FROM projects WHERE team_id=?").all(teamId);
  const data = {
    exported_at: new Date().toISOString(),
    team: { id: team.id, name: team.name },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      agents: db.prepare("SELECT name,program,model,last_active FROM agents WHERE project_id=?").all(p.id),
      messages: db
        .prepare("SELECT m.id,m.thread_id,m.subject,m.body,m.importance,m.created_at,a.name sender FROM messages m JOIN agents a ON a.id=m.sender_id WHERE m.project_id=? ORDER BY m.created_at")
        .all(p.id)
        .map((m) => ({
          ...m,
          recipients: db.prepare("SELECT a.name,r.read_at FROM recipients r JOIN agents a ON a.id=r.agent_id WHERE r.message_id=?").all(m.id),
          attachments: db.prepare("SELECT f.id,f.filename,f.size,f.sha256 FROM message_files mf JOIN attachments f ON f.id=mf.file_id WHERE mf.message_id=?").all(m.id).map((f) => ({ ...f, path: `files/${f.id}_${f.filename.replace(/[^\w.-]/g, "_").slice(0, 40)}` })),
        })),
    })),
  };
  const files = projects.flatMap((p) => db.prepare("SELECT id,filename,size FROM attachments WHERE project_id=?").all(p.id));
  if (files.reduce((n, f) => n + f.size, 0) > 1024 ** 3)
    throw new MailError("This team has more than 1 GiB of attachments; export is not supported at that size yet", 413);
  sec.log(actor, teamId, "team.exported", `${files.length} files`);
  const directory = sec.mail.directory;
  function* parts() {
    yield* tarEntry("export.json", Buffer.from(JSON.stringify(data, null, 2)));
    for (const f of files)
      try {
        yield* tarEntry(`files/${f.id}_${f.filename.replace(/[^\w.-]/g, "_").slice(0, 40)}`, readFileSync(join(directory, "files", f.id)));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    yield Buffer.alloc(1024);
  }
  return gzipSync(Buffer.concat([...parts()]));
}
