import { randomUUID, createHash } from "node:crypto";
import { MailError, text } from "./store.mjs";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function pageSize(value = 30) {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    throw new MailError("Limit must be 1–100");
  return value;
}
export function listPage(items, cursor, limit = 30) {
  limit = pageSize(limit);
  let offset = 0;
  if (cursor) {
    try {
      const raw = JSON.parse(
        Buffer.from(text(cursor, "cursor", 1024), "base64url").toString(),
      );
      if (
        !Number.isSafeInteger(raw.offset) ||
        raw.offset < 0 ||
        raw.fingerprint !==
          digest(items.map((item) => item.id || item.name || item.uri))
      )
        throw new Error();
      offset = raw.offset;
    } catch {
      throw new MailError("Invalid or stale cursor");
    }
  }
  return {
    items: items.slice(offset, offset + limit),
    ...(offset + limit < items.length
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({
              offset: offset + limit,
              fingerprint: digest(
                items.map((item) => item.id || item.name || item.uri),
              ),
            }),
          ).toString("base64url"),
        }
      : {}),
  };
}
export function searchMessages(scoped, args = {}, inbox = false) {
  const p = scoped.project(args.project_key),
    actor = scoped.actor,
    limit = pageSize(args.limit);
  let agentId = null;
  if (actor.kind === "agent") {
    if (args.agent_name && args.agent_name !== actor.agent_name)
      throw new MailError("Cannot read another agent inbox", 403);
    agentId = actor.agent_id;
  } else if (args.agent_name)
    agentId = scoped.base.agent(p.id, args.agent_name).id;
  const query = args.query ? text(args.query, "query", 1000) : "",
    unread = !!args.unread_only;
  const context = digest({
    project: p.id,
    actor: actor.id,
    agentId,
    query,
    unread,
    inbox,
    thread: args.thread_id,
  });
  const clauses = ["m.project_id=?"],
    params = [p.id];
  if (inbox && agentId) {
    clauses.push(
      "EXISTS(SELECT 1 FROM recipients r WHERE r.message_id=m.id AND r.agent_id=?)",
    );
    params.push(agentId);
  } else if (agentId) {
    clauses.push(
      "(m.sender_id=? OR EXISTS(SELECT 1 FROM recipients r WHERE r.message_id=m.id AND r.agent_id=?))",
    );
    params.push(agentId, agentId);
  }
  if (unread) {
    clauses.push(
      "EXISTS(SELECT 1 FROM recipients r WHERE r.message_id=m.id AND r.read_at IS NULL" +
        (agentId ? " AND r.agent_id=?" : "") +
        ")",
    );
    if (agentId) params.push(agentId);
  }
  if (query) {
    clauses.push(
      "instr(lower(m.subject || char(10) || m.body || char(10) || a.name),lower(?))>0",
    );
    params.push(query);
  }
  if (args.thread_id) {
    clauses.push("m.thread_id=?");
    params.push(args.thread_id);
  }
  if (args.cursor) {
    try {
      const cursor = JSON.parse(
        Buffer.from(text(args.cursor, "cursor", 1024), "base64url").toString(),
      );
      if (
        cursor.context !== context ||
        typeof cursor.time !== "string" ||
        typeof cursor.id !== "string"
      )
        throw new Error();
      clauses.push("(m.created_at<? OR (m.created_at=? AND m.id<?))");
      params.push(cursor.time, cursor.time, cursor.id);
    } catch {
      throw new MailError("Invalid cursor for these filters");
    }
  }
  const rows = scoped.db
    .prepare(
      "SELECT m.id,m.created_at FROM messages m JOIN agents a ON a.id=m.sender_id WHERE " +
        clauses.join(" AND ") +
        " ORDER BY m.created_at DESC,m.id DESC LIMIT ?",
    )
    .all(...params, limit + 1);
  const selected = rows.slice(0, limit),
    last = selected.at(-1);
  return {
    messages: selected.map((row) => scoped.message(row.id)),
    next_cursor:
      rows.length > limit
        ? Buffer.from(
            JSON.stringify({ context, time: last.created_at, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
function path(value) {
  value = text(value, "repository-relative path", 300).replaceAll("\\", "/");
  if (
    value.startsWith("/") ||
    value.includes(":") ||
    /[\x00-\x1f]/.test(value) ||
    value.split("/").some((s) => s === "." || s === ".." || s === "")
  )
    throw new MailError("Use a normalized repository-relative path");
  const prefix = value.endsWith("/**")
    ? value.slice(0, -3)
    : value === "**"
      ? ""
      : null;
  if (/[?*\[\]{}]/.test(prefix === null ? value : prefix))
    throw new MailError("Use exact files or a directory/** reservation");
  return value;
}
function overlaps(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const dir = a.endsWith("/**") ? a.slice(0, -2) : a === "**" ? "" : null,
    other = b.endsWith("/**") ? b.slice(0, -2) : b === "**" ? "" : null;
  return (
    a === b ||
    (dir !== null && b.startsWith(dir)) ||
    (other !== null && a.startsWith(other))
  );
}
function holder(scoped, p, name) {
  const chosen = name || scoped.actor.agent_name;
  if (!chosen) throw new MailError("agent_name is required");
  if (scoped.actor.kind === "agent" && chosen !== scoped.actor.agent_name)
    throw new MailError("Cannot reserve as another agent", 403);
  return scoped.base.agent(p.id, chosen);
}
function ttl(value = 900) {
  if (!Number.isInteger(value) || value < 60 || value > 3600)
    throw new MailError("ttl_seconds must be 60–3600");
  return value;
}
export function reservations(scoped, args) {
  const p = scoped.project(args.project_key);
  return scoped.db
    .prepare(
      "SELECT r.*,a.name agent_name FROM reservations r JOIN agents a ON a.id=r.agent_id WHERE r.project_id=? AND r.expires_at>? ORDER BY r.path,r.id",
    )
    .all(p.id, Date.now());
}
export function reserve(scoped, args) {
  const p = scoped.project(args.project_key, "member"),
    agent = holder(scoped, p, args.agent_name);
  if (
    !Array.isArray(args.paths) ||
    !args.paths.length ||
    args.paths.length > 50
  )
    throw new MailError("Request between 1 and 50 paths");
  const paths = [...new Set(args.paths.map(path))],
    seconds = ttl(args.ttl_seconds),
    exclusive = args.exclusive !== false,
    reason = args.reason ? text(args.reason, "reason", 500) : "";
  return scoped.security.transaction(() => {
    scoped.db
      .prepare("DELETE FROM reservations WHERE expires_at<=?")
      .run(Date.now());
    const active = reservations(scoped, { project_key: p.id });
    const conflicts = active.filter(
      (r) =>
        r.agent_id !== agent.id &&
        (r.exclusive || exclusive) &&
        paths.some((v) => overlaps(v, r.path)),
    );
    if (conflicts.length) return { granted: [], conflicts };
    const granted = [];
    for (const value of paths) {
      const old = active.find(
          (r) => r.agent_id === agent.id && r.path === value,
        ),
        id = old?.id || randomUUID();
      scoped.db
        .prepare(
          "INSERT INTO reservations VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET exclusive=excluded.exclusive,reason=excluded.reason,expires_at=excluded.expires_at",
        )
        .run(
          id,
          p.id,
          agent.id,
          value,
          exclusive ? 1 : 0,
          reason,
          Date.now() + seconds * 1000,
          new Date().toISOString(),
        );
      granted.push(id);
    }
    scoped.security.log(scoped.actor, p.team_id, "reservations.changed", p.id);
    return {
      granted: reservations(scoped, { project_key: p.id }).filter((r) =>
        granted.includes(r.id),
      ),
      conflicts: [],
    };
  });
}
export function releaseReservations(scoped, args, renew = false) {
  const p = scoped.project(args.project_key, "member"),
    agent = holder(scoped, p, args.agent_name);
  if (
    !Array.isArray(args.reservation_ids) ||
    !args.reservation_ids.length ||
    args.reservation_ids.length > 50
  )
    throw new MailError("Provide between 1 and 50 reservation IDs");
  return scoped.security.transaction(() => {
    const rows = args.reservation_ids.map((id) =>
      scoped.db
        .prepare(
          "SELECT * FROM reservations WHERE id=? AND project_id=? AND expires_at>?",
        )
        .get(id, p.id, Date.now()),
    );
    if (rows.some((r) => !r)) throw new MailError("Reservation not found", 404);
    if (rows.some((r) => r.agent_id !== agent.id)) {
      if (!args.force || renew)
        throw new MailError("Cannot modify another agent reservation", 403);
      scoped.security.requireRole(scoped.actor, p.team_id, "admin");
    }
    const seconds = renew ? ttl(args.ttl_seconds) : 0;
    for (const row of rows) {
      if (renew)
        scoped.db
          .prepare("UPDATE reservations SET expires_at=? WHERE id=?")
          .run(Date.now() + seconds * 1000, row.id);
      else scoped.db.prepare("DELETE FROM reservations WHERE id=?").run(row.id);
    }
    scoped.security.log(scoped.actor, p.team_id, "reservations.changed", p.id);
    return { count: rows.length };
  });
}
