import { randomUUID } from "node:crypto";
import { MailError, text } from "./store.mjs";
import {
  searchMessages,
  reserve,
  releaseReservations,
} from "./collaboration.mjs";
const initialized = new WeakSet();
export function coordinationSchema(db) {
  if (initialized.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS agent_profiles(agent_id TEXT PRIMARY KEY REFERENCES agents(id),purpose TEXT NOT NULL DEFAULT '',retired INTEGER NOT NULL DEFAULT 0,policy TEXT NOT NULL DEFAULT 'open');
 CREATE TABLE IF NOT EXISTS acknowledgments(message_id TEXT NOT NULL REFERENCES messages(id),agent_id TEXT NOT NULL REFERENCES agents(id),at TEXT NOT NULL,PRIMARY KEY(message_id,agent_id));
 CREATE TABLE IF NOT EXISTS contacts(project_id TEXT NOT NULL REFERENCES projects(id),sender_id TEXT NOT NULL REFERENCES agents(id),recipient_id TEXT NOT NULL REFERENCES agents(id),status TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(sender_id,recipient_id));
 CREATE TABLE IF NOT EXISTS coordination_products(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,name TEXT NOT NULL,UNIQUE(team_id,name));
 CREATE TABLE IF NOT EXISTS product_projects(product_id TEXT NOT NULL REFERENCES coordination_products(id),project_id TEXT NOT NULL REFERENCES projects(id),PRIMARY KEY(product_id,project_id));
 CREATE TABLE IF NOT EXISTS build_slots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),agent_id TEXT NOT NULL REFERENCES agents(id),name TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  initialized.add(db);
}
export function checkActive(db, id) {
  coordinationSchema(db);
  if (
    db.prepare("SELECT retired FROM agent_profiles WHERE agent_id=?").get(id)
      ?.retired
  )
    throw new MailError("Agent is retired", 403);
}
export function checkContacts(scoped, p, input) {
  coordinationSchema(scoped.db);
  const sender = scoped.base.agent(p.id, input.sender_name);
  checkActive(scoped.db, sender.id);
  for (const name of input.to || []) {
    const recipient = scoped.base.agent(p.id, name);
    checkActive(scoped.db, recipient.id);
    const policy =
      scoped.db
        .prepare("SELECT policy FROM agent_profiles WHERE agent_id=?")
        .get(recipient.id)?.policy || "open";
    if (
      sender.id !== recipient.id &&
      policy !== "open" &&
      (policy === "closed" ||
        scoped.db
          .prepare(
            "SELECT status FROM contacts WHERE sender_id=? AND recipient_id=?",
          )
          .get(sender.id, recipient.id)?.status !== "accepted")
    )
      throw new MailError("Recipient contact policy requires approval", 403);
  }
}
const str = { type: "string" },
  num = { type: "integer", minimum: 60, maximum: 3600 };
const spec = (name, description, extra = {}, required = []) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties: { project_key: str, agent_name: str, ...extra },
    required: ["project_key", ...required],
    additionalProperties: false,
  },
});
export const coordinationTools = [
  spec("whois", "Read an agent profile and activity.", {}, ["agent_name"]),
  spec("update_agent_profile", "Update your agent purpose.", { purpose: str }, [
    "purpose",
  ]),
  spec(
    "retire_agent",
    "Retire an identity; its credentials stop accessing projects.",
    {},
    ["agent_name"],
  ),
  spec(
    "unretire_agent",
    "Human administrators can reactivate an identity.",
    {},
    ["agent_name"],
  ),
  spec(
    "acknowledge_message",
    "Acknowledge a message addressed to your agent.",
    { message_id: str },
    ["message_id"],
  ),
  spec(
    "get_message_delivery_receipt",
    "Read recipient delivery/read/acknowledgment states.",
    { message_id: str },
    ["message_id"],
  ),
  spec("mark_all_read", "Mark your agent inbox read."),
  spec(
    "request_contact",
    "Request permission to contact another agent.",
    { to_agent: str },
    ["to_agent"],
  ),
  spec(
    "respond_contact",
    "Accept or reject a request to your agent.",
    { from_agent: str, accept: { type: "boolean" } },
    ["from_agent", "accept"],
  ),
  spec("list_contacts", "List your agent contact requests and responses."),
  spec(
    "set_contact_policy",
    "Set your agent inbound policy.",
    { policy: { type: "string", enum: ["open", "approval", "closed"] } },
    ["policy"],
  ),
  spec(
    "acquire_build_slot",
    "Acquire a named exclusive project build lease.",
    { name: str, ttl_seconds: num },
    ["name"],
  ),
  spec(
    "renew_build_slot",
    "Renew your active lease.",
    { slot_id: str, ttl_seconds: num },
    ["slot_id"],
  ),
  spec("release_build_slot", "Release your build lease.", { slot_id: str }, [
    "slot_id",
  ]),
  spec("list_build_slots", "List active project build leases."),
  spec(
    "summarize_thread",
    "Return an extractive digest with message sources; no model or paid service.",
    { message_id: str },
    ["message_id"],
  ),
  spec(
    "macro_start_session",
    "Register/update your identity, read inbox and profile, optionally reserve paths.",
    { program: str, model: str, paths: { type: "array", items: str } },
    [],
  ),
  spec(
    "macro_prepare_thread",
    "Read a thread digest and current inbox.",
    { message_id: str },
    ["message_id"],
  ),
  spec(
    "macro_file_reservation_cycle",
    "Reserve paths, or release specified reservation IDs.",
    {
      paths: { type: "array", items: str },
      reservation_ids: { type: "array", items: str },
    },
  ),
  spec(
    "macro_contact_handshake",
    "Request contact or return its existing state.",
    { to_agent: str },
    ["to_agent"],
  ),
  spec("list_activity", "Read authorized project coordination activity."),
  spec("ensure_product", "Create a team project group.", { name: str }, [
    "name",
  ]),
  spec(
    "products_link",
    "Link this project to a team project group.",
    { product_id: str },
    ["product_id"],
  ),
  spec("list_products", "List groups linked to this project."),
  spec(
    "fetch_inbox_product",
    "Read your authorized inbox across linked projects.",
    { product_id: str },
    ["product_id"],
  ),
  spec(
    "summarize_thread_product",
    "Digest an authorized thread in a linked project.",
    { product_id: str, message_id: str },
    ["product_id", "message_id"],
  ),
  spec(
    "search_messages_product",
    "Search authorized projects within your credential scope.",
    { query: str, product_id: str },
    ["query"],
  ),
];
export function coordinationCall(name, a, s) {
  coordinationSchema(s.db);
  const p = s.project(
    a.project_key,
    [
      "whois",
      "list_contacts",
      "list_build_slots",
      "summarize_thread",
      "macro_prepare_thread",
      "get_message_delivery_receipt",
      "list_activity",
      "search_messages_product",
      "list_products",
      "fetch_inbox_product",
      "summarize_thread_product",
    ].includes(name)
      ? "viewer"
      : "member",
  );
  const actor = () => {
    const chosen = a.agent_name || s.actor.agent_name;
    if (!chosen) throw new MailError("agent_name is required");
    if (s.actor.kind === "agent" && chosen !== s.actor.agent_name)
      throw new MailError("Cannot impersonate another agent", 403);
    return s.base.agent(p.id, chosen);
  };
  const profile = (id) =>
    s.db
      .prepare(
        "SELECT a.id,a.name,a.program,a.model,a.last_active,COALESCE(p.purpose,'') purpose,COALESCE(p.retired,0) retired,COALESCE(p.policy,'open') policy FROM agents a LEFT JOIN agent_profiles p ON p.agent_id=a.id WHERE a.id=?",
      )
      .get(id);
  const log = (action, target) =>
    s.security.log(s.actor, p.team_id, action, target);
  const ensure = (id) =>
    s.db
      .prepare("INSERT OR IGNORE INTO agent_profiles(agent_id) VALUES(?)")
      .run(id);
  const lifetime = () => {
    const v = a.ttl_seconds ?? 900;
    if (!Number.isInteger(v) || v < 60 || v > 3600)
      throw new MailError("Invalid TTL");
    return Date.now() + v * 1000;
  };
  switch (name) {
    case "whois":
      return profile(s.base.agent(p.id, a.agent_name).id);
    case "update_agent_profile": {
      const u = actor();
      ensure(u.id);
      s.db
        .prepare("UPDATE agent_profiles SET purpose=? WHERE agent_id=?")
        .run(text(a.purpose, "purpose", 2000), u.id);
      log("agent.profile", u.id);
      return profile(u.id);
    }
    case "retire_agent":
    case "unretire_agent": {
      if (s.actor.kind === "agent")
        throw new MailError("Human administrator required", 403);
      s.security.requireRole(s.actor, p.team_id, "admin");
      const u = s.base.agent(p.id, a.agent_name);
      ensure(u.id);
      s.db
        .prepare("UPDATE agent_profiles SET retired=? WHERE agent_id=?")
        .run(name === "retire_agent" ? 1 : 0, u.id);
      log(name, u.id);
      return profile(u.id);
    }
    case "acknowledge_message": {
      const m = s.message(a.message_id);
      if (m.project_id !== p.id) throw new MailError("Not found", 404);
      const u = actor();
      if (
        !s.db
          .prepare("SELECT 1 FROM recipients WHERE message_id=? AND agent_id=?")
          .get(m.id, u.id)
      )
        throw new MailError("Only a recipient can acknowledge", 403);
      s.read(m.id, u.name);
      s.db
        .prepare("INSERT OR IGNORE INTO acknowledgments VALUES(?,?,?)")
        .run(m.id, u.id, new Date().toISOString());
      log("message.acknowledged", m.id);
      return { acknowledged: true };
    }
    case "get_message_delivery_receipt": {
      const m = s.message(a.message_id);
      if (m.project_id !== p.id) throw new MailError("Not found", 404);
      return s.db
        .prepare(
          "SELECT a.name,r.read_at,k.at acknowledged_at FROM recipients r JOIN agents a ON a.id=r.agent_id LEFT JOIN acknowledgments k ON k.agent_id=r.agent_id AND k.message_id=r.message_id WHERE r.message_id=?",
        )
        .all(m.id);
    }
    case "mark_all_read": {
      const u = actor();
      const changed = s.db
        .prepare(
          "UPDATE recipients SET read_at=? WHERE agent_id=? AND read_at IS NULL AND message_id IN (SELECT id FROM messages WHERE project_id=?)",
        )
        .run(new Date().toISOString(), u.id, p.id);
      log("message.read_all", u.id);
      return { marked: Number(changed.changes) };
    }
    case "set_contact_policy": {
      const u = actor();
      ensure(u.id);
      s.db
        .prepare("UPDATE agent_profiles SET policy=? WHERE agent_id=?")
        .run(a.policy, u.id);
      log("contact.policy", u.id);
      return profile(u.id);
    }
    case "request_contact":
    case "macro_contact_handshake": {
      const u = actor(),
        v = s.base.agent(p.id, a.to_agent);
      checkActive(s.db, v.id);
      if (u.id === v.id) throw new MailError("Select another agent");
      const old = s.db
        .prepare("SELECT * FROM contacts WHERE sender_id=? AND recipient_id=?")
        .get(u.id, v.id);
      if (old) return old;
      s.db
        .prepare("INSERT INTO contacts VALUES(?,?,?,?,?)")
        .run(p.id, u.id, v.id, "pending", new Date().toISOString());
      log("contact.requested", v.id);
      return { status: "pending" };
    }
    case "respond_contact": {
      const u = actor(),
        v = s.base.agent(p.id, a.from_agent);
      const changed = s.db
        .prepare(
          "UPDATE contacts SET status=?,at=? WHERE sender_id=? AND recipient_id=? AND status='pending'",
        )
        .run(
          a.accept ? "accepted" : "rejected",
          new Date().toISOString(),
          v.id,
          u.id,
        );
      if (!changed.changes)
        throw new MailError("Pending request not found", 404);
      log("contact.responded", v.id);
      return { status: a.accept ? "accepted" : "rejected" };
    }
    case "list_contacts": {
      const u = actor();
      return s.db
        .prepare(
          "SELECT c.*,a.name sender,b.name recipient FROM contacts c JOIN agents a ON a.id=c.sender_id JOIN agents b ON b.id=c.recipient_id WHERE c.project_id=? AND (c.sender_id=? OR c.recipient_id=?) ORDER BY c.at DESC LIMIT 100",
        )
        .all(p.id, u.id, u.id);
    }
    case "list_build_slots":
      return s.db
        .prepare(
          "SELECT b.*,a.name agent_name FROM build_slots b JOIN agents a ON a.id=b.agent_id WHERE b.project_id=? AND b.expires_at>?",
        )
        .all(p.id, Date.now());
    case "acquire_build_slot": {
      const u = actor(),
        slot = text(a.name, "name", 120),
        until = lifetime();
      s.db.exec("BEGIN IMMEDIATE");
      try {
        s.db
          .prepare("DELETE FROM build_slots WHERE expires_at<=?")
          .run(Date.now());
        const old = s.db
          .prepare("SELECT * FROM build_slots WHERE project_id=? AND name=?")
          .get(p.id, slot);
        if (old) throw new MailError("Build slot is already leased", 409);
        const id = randomUUID();
        s.db
          .prepare("INSERT INTO build_slots VALUES(?,?,?,?,?)")
          .run(id, p.id, u.id, slot, until);
        s.db.exec("COMMIT");
        log("build.acquired", p.id);
        return { id, name: slot, expires_at: until };
      } catch (e) {
        if (s.db.isTransaction) s.db.exec("ROLLBACK");
        throw e;
      }
    }
    case "renew_build_slot":
    case "release_build_slot": {
      const u = actor(),
        old = s.db
          .prepare(
            "SELECT * FROM build_slots WHERE id=? AND project_id=? AND agent_id=? AND expires_at>?",
          )
          .get(a.slot_id, p.id, u.id, Date.now());
      if (!old) throw new MailError("Active lease not found", 404);
      if (name === "release_build_slot")
        s.db.prepare("DELETE FROM build_slots WHERE id=?").run(old.id);
      else
        s.db
          .prepare("UPDATE build_slots SET expires_at=? WHERE id=?")
          .run(lifetime(), old.id);
      log(name, p.id);
      return { ok: true };
    }
    case "summarize_thread":
    case "macro_prepare_thread": {
      const m = s.message(a.message_id);
      if (m.project_id !== p.id) throw new MailError("Not found", 404);
      const page = searchMessages(s, {
        project_key: p.id,
        thread_id: m.thread_id,
        limit: 100,
      });
      return {
        kind: "extractive",
        subject: m.subject,
        messages: page.messages.map((v) => ({
          id: v.id,
          sender: v.sender_name,
          excerpt: v.body.slice(0, 400),
        })),
        next_cursor: page.next_cursor,
        ...(name === "macro_prepare_thread"
          ? {
              inbox: searchMessages(
                s,
                { project_key: p.id, agent_name: actor().name, limit: 30 },
                true,
              ),
            }
          : {}),
      };
    }
    case "macro_start_session": {
      const chosen = a.agent_name || s.actor.agent_name;
      if (!chosen) throw new MailError("agent_name is required");
      s.register({
        project_key: p.id,
        name: chosen,
        program: a.program || "MCP",
        model: a.model || "unspecified",
      });
      const u = actor();
      return {
        agent: profile(u.id),
        inbox: searchMessages(
          s,
          { project_key: p.id, agent_name: u.name, limit: 30 },
          true,
        ),
        ...(a.paths?.length
          ? {
              reservations: reserve(s, {
                project_key: p.id,
                agent_name: u.name,
                paths: a.paths,
              }),
            }
          : {}),
      };
    }
    case "macro_file_reservation_cycle":
      if (a.reservation_ids?.length) return releaseReservations(s, { ...a });
      else if (a.paths?.length) return reserve(s, a);
      else throw new MailError("paths or reservation_ids required");
    case "list_activity": {
      if (s.actor.kind === "agent")
        return {
          agent: profile(s.actor.agent_id),
          leases: coordinationCall("list_build_slots", a, s),
        };
      return s.db
        .prepare(
          "SELECT action,target,created_at FROM audit WHERE team_id=? AND (target=? OR target IN (SELECT id FROM agents WHERE project_id=?) OR target IN (SELECT id FROM messages WHERE project_id=?)) ORDER BY created_at DESC LIMIT 100",
        )
        .all(p.team_id, p.id, p.id, p.id);
    }
    case "ensure_product": {
      if (s.actor.kind === "agent")
        throw new MailError("Human administrator required", 403);
      s.security.requireRole(s.actor, p.team_id, "admin");
      const label = text(a.name, "name", 120);
      const old = s.db
        .prepare(
          "SELECT * FROM coordination_products WHERE team_id=? AND name=?",
        )
        .get(p.team_id, label);
      if (old) return old;
      const id = randomUUID();
      s.db
        .prepare("INSERT INTO coordination_products VALUES(?,?,?)")
        .run(id, p.team_id, label);
      log("product.created", p.id);
      return { id, name: label };
    }
    case "products_link": {
      if (s.actor.kind === "agent")
        throw new MailError("Human administrator required", 403);
      s.security.requireRole(s.actor, p.team_id, "admin");
      if (
        !s.db
          .prepare(
            "SELECT 1 FROM coordination_products WHERE id=? AND team_id=?",
          )
          .get(a.product_id, p.team_id)
      )
        throw new MailError("Not found", 404);
      s.db
        .prepare("INSERT OR IGNORE INTO product_projects VALUES(?,?)")
        .run(a.product_id, p.id);
      log("product.linked", p.id);
      return { linked: true };
    }
    case "list_products":
      return s.db
        .prepare(
          "SELECT g.id,g.name FROM coordination_products g JOIN product_projects x ON x.product_id=g.id WHERE x.project_id=?",
        )
        .all(p.id);
    case "fetch_inbox_product":
    case "summarize_thread_product":
    case "search_messages_product": {
      let allowed = s.projects().filter((v) => v.team_id === p.team_id);
      if (a.product_id) {
        if (
          !s.db
            .prepare(
              "SELECT 1 FROM product_projects WHERE product_id=? AND project_id=?",
            )
            .get(a.product_id, p.id)
        )
          throw new MailError("Not found", 404);
        const linked = new Set(
          s.db
            .prepare(
              "SELECT project_id FROM product_projects WHERE product_id=?",
            )
            .all(a.product_id)
            .map((v) => v.project_id),
        );
        allowed = allowed.filter((v) => linked.has(v.id));
      }
      if (name === "summarize_thread_product") {
        const m = s.message(a.message_id);
        if (!allowed.some((v) => v.id === m.project_id))
          throw new MailError("Not found", 404);
        return coordinationCall(
          "summarize_thread",
          { ...a, project_key: m.project_id },
          s,
        );
      }
      return {
        projects: allowed.map((v) => ({
          project: v.name,
          ...searchMessages(
            s,
            {
              project_key: v.id,
              query: a.query || "",
              ...(name === "fetch_inbox_product"
                ? { agent_name: a.agent_name || s.actor.agent_name }
                : {}),
              limit: 30,
            },
            name === "fetch_inbox_product",
          ),
        })),
      };
    }
    default:
      throw new MailError("Unknown coordination tool", 404);
  }
}
