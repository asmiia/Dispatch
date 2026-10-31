import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";

export class MailError extends Error {
  // The bundler can load this module more than once (routes vs. instrumentation),
  // so identify instances by name instead of by class identity.
  static [Symbol.hasInstance](value) {
    return value instanceof Error && value.name === "MailError";
  }
  constructor(message, status = 400) {
    super(message);
    this.name = "MailError";
    this.status = status;
  }
}
export const MAX_FILE = 6 * 1024 * 1024;
export function text(value, label, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new MailError(`Invalid ${label}`);
  return value.trim();
}
export function filename(value) {
  const name = text(value, "filename", 180);
  if (
    /[\\/:\x00-\x1f\x7f]/.test(name) ||
    name === "." ||
    name === ".." ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(name)
  )
    throw new MailError("Invalid filename");
  return name;
}

export class MailStore {
  constructor(directory) {
    this.directory = resolve(directory);
    mkdirSync(join(this.directory, "files"), { recursive: true });
    this.db = new DatabaseSync(join(this.directory, "mail.sqlite"), {
      timeout: 5000,
    });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL,program TEXT NOT NULL,model TEXT NOT NULL,last_active TEXT NOT NULL,UNIQUE(project_id,name));
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),sender_id TEXT NOT NULL REFERENCES agents(id),subject TEXT NOT NULL,body TEXT NOT NULL,thread_id TEXT NOT NULL,importance TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recipients(message_id TEXT NOT NULL REFERENCES messages(id),agent_id TEXT NOT NULL REFERENCES agents(id),read_at TEXT,PRIMARY KEY(message_id,agent_id));
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),filename TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS message_files(message_id TEXT NOT NULL REFERENCES messages(id),file_id TEXT NOT NULL REFERENCES attachments(id),PRIMARY KEY(message_id,file_id));
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,message_id TEXT NOT NULL REFERENCES messages(id));`);
  }
  project(key) {
    const p = this.db
      .prepare("SELECT * FROM projects WHERE id=? OR name=?")
      .get(key, key);
    if (!p) throw new MailError("Project not found", 404);
    return p;
  }
  ensureProject(name) {
    name = text(name, "project name", 500);
    const old = this.db
      .prepare("SELECT * FROM projects WHERE name=?")
      .get(name);
    if (old) return old;
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)")
      .run(id, name, new Date().toISOString());
    return this.project(id);
  }
  projects() {
    return this.db
      .prepare(
        "SELECT p.*,(SELECT COUNT(*) FROM messages m WHERE m.project_id=p.id) message_count FROM projects p ORDER BY created_at DESC",
      )
      .all();
  }
  agent(project, name) {
    const p = this.project(project);
    const a = this.db
      .prepare("SELECT * FROM agents WHERE project_id=? AND name=?")
      .get(p.id, name);
    if (!a) throw new MailError("Agent not found", 404);
    return a;
  }
  register({ project_key, name, program = "agent", model = "unknown" }) {
    const p = this.project(project_key);
    name = text(name, "agent name", 64);
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name))
      throw new MailError("Invalid agent name");
    program = text(program, "program", 100);
    model = text(model, "model", 100);
    this.db
      .prepare(
        `INSERT INTO agents VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,name) DO UPDATE SET program=excluded.program,model=excluded.model,last_active=excluded.last_active`,
      )
      .run(randomUUID(), p.id, name, program, model, new Date().toISOString());
    return this.agent(p.id, name);
  }
  agents(project) {
    return this.db
      .prepare("SELECT * FROM agents WHERE project_id=? ORDER BY name")
      .all(this.project(project).id);
  }
  upload(project, name, bytes) {
    const p = this.project(project);
    name = filename(name);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_FILE)
      throw new MailError("File must be between 1 byte and 6 MiB", 413);
    const id = randomUUID();
    const path = join(this.directory, "files", id);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    try {
      this.db
        .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?)")
        .run(
          id,
          p.id,
          name,
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          new Date().toISOString(),
        );
    } catch (error) {
      unlinkSync(path);
      throw error;
    }
    return this.file(id);
  }
  file(id) {
    const f = this.db.prepare("SELECT * FROM attachments WHERE id=?").get(id);
    if (!f) throw new MailError("File not found", 404);
    return { ...f, download_url: `/api/files/${f.id}` };
  }
  download(id) {
    const file = this.file(id);
    return {
      file,
      bytes: readFileSync(join(this.directory, "files", file.id)),
    };
  }
  send(input) {
    const p = this.project(input.project_key),
      sender = this.agent(p.id, input.sender_name);
    const subject = text(input.subject, "subject", 200),
      body = text(input.body_md, "message", 100000);
    if (!Array.isArray(input.to) || !input.to.length || input.to.length > 50)
      throw new MailError("Choose between 1 and 50 recipients");
    const recipients = [...new Set(input.to)].map((name) =>
      this.agent(p.id, name),
    );
    const paths = input.attachment_paths ?? [];
    if (!Array.isArray(paths) || paths.length > 10)
      throw new MailError("At most 10 attachments");
    const files = [...new Set(paths)].map((id) => {
      const f = this.file(id);
      if (f.project_id !== p.id)
        throw new MailError("Attachment belongs to another project", 403);
      return f;
    });
    let thread = input.thread_id;
    if (thread) {
      const old = this.db
        .prepare("SELECT project_id FROM messages WHERE thread_id=? LIMIT 1")
        .get(thread);
      if (!old || old.project_id !== p.id)
        throw new MailError("Thread not found in this project", 404);
    }
    const importance = input.importance ?? "normal";
    if (!["normal", "high"].includes(importance))
      throw new MailError("Invalid importance");
    const key = input.idempotency_key
      ? `${p.id}:${text(input.idempotency_key, "idempotency key", 100)}`
      : null;
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          sender: sender.id,
          subject,
          body,
          to: recipients.map((a) => a.id).sort(),
          files: files.map((f) => f.id).sort(),
          thread,
          importance,
        }),
      )
      .digest("hex");
    const id = randomUUID();
    thread ??= id;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (key) {
        const previous = this.db
          .prepare("SELECT * FROM idempotency WHERE key=?")
          .get(key);
        if (previous) {
          if (previous.request_hash !== hash)
            throw new MailError(
              "Idempotency key reused with different contents",
              409,
            );
          this.db.exec("COMMIT");
          return this.message(previous.message_id);
        }
      }
      this.db
        .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)")
        .run(
          id,
          p.id,
          sender.id,
          subject,
          body,
          thread,
          importance,
          new Date().toISOString(),
        );
      for (const r of recipients)
        this.db
          .prepare("INSERT INTO recipients VALUES(?,?,NULL)")
          .run(id, r.id);
      for (const f of files)
        this.db.prepare("INSERT INTO message_files VALUES(?,?)").run(id, f.id);
      if (key)
        this.db
          .prepare("INSERT INTO idempotency VALUES(?,?,?)")
          .run(key, hash, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.message(id);
  }
  message(id) {
    const m = this.db
      .prepare(
        "SELECT m.*,a.name sender_name FROM messages m JOIN agents a ON a.id=m.sender_id WHERE m.id=?",
      )
      .get(id);
    if (!m) throw new MailError("Message not found", 404);
    return {
      ...m,
      recipients: this.db
        .prepare(
          "SELECT a.name,r.read_at FROM recipients r JOIN agents a ON a.id=r.agent_id WHERE message_id=?",
        )
        .all(id),
      attachments: this.db
        .prepare(
          "SELECT f.* FROM attachments f JOIN message_files mf ON mf.file_id=f.id WHERE mf.message_id=?",
        )
        .all(id)
        .map((f) => ({ ...f, download_url: `/api/files/${f.id}` })),
    };
  }
  inbox(project, name, query = "") {
    const p = this.project(project);
    if (name) this.agent(p.id, name);
    return this.db
      .prepare(
        `SELECT DISTINCT m.id FROM messages m JOIN agents s ON s.id=m.sender_id JOIN recipients r ON r.message_id=m.id JOIN agents a ON a.id=r.agent_id WHERE m.project_id=? AND (?='' OR a.name=?) AND (?='' OR instr(lower(m.subject || ' ' || m.body || ' ' || s.name),lower(?))>0) ORDER BY m.created_at DESC LIMIT 100`,
      )
      .all(p.id, name || "", name || "", query, query)
      .map((m) => this.message(m.id));
  }
  read(id, name) {
    const message = this.message(id);
    const a = this.agent(message.project_id, name);
    const changed = this.db
      .prepare(
        "UPDATE recipients SET read_at=? WHERE message_id=? AND agent_id=?",
      )
      .run(new Date().toISOString(), id, a.id);
    if (!changed.changes) throw new MailError("Not a recipient", 403);
    return this.message(id);
  }
  thread(id) {
    const m = this.message(id);
    return this.db
      .prepare(
        "SELECT id FROM messages WHERE project_id=? AND thread_id=? ORDER BY created_at",
      )
      .all(m.project_id, m.thread_id)
      .map((row) => this.message(row.id));
  }
}
export function store() {
  if (!globalThis.__dispatchStore)
    globalThis.__dispatchStore = new MailStore(
      process.env.DISPATCH_DATA_DIR || ".local",
    );
  return globalThis.__dispatchStore;
}
