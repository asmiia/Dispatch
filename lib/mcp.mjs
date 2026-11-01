import { coordinationTools, coordinationCall } from "./coordination.mjs";
import { callTools, callCall } from "./call-tools.mjs";
import { store, MailError, MAX_FILE } from "./store.mjs";
import { accounts } from "./accounts.mjs";
import {
  searchMessages,
  listPage,
  reserve,
  reservations,
  releaseReservations,
} from "./collaboration.mjs";
const string = { type: "string" };
const tool = (name, description, properties, required) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
});
export const tools = [
  tool("ensure_project", "Create or find a project.", { human_key: string }, [
    "human_key",
  ]),
  tool("list_projects", "List workspace projects.", {}, []),
  tool(
    "events_since",
    "Catch up on changes you missed (for example after a restart). Pass the last next_seq you saw, or 0 to start from the beginning; poll again with next_seq until events is empty.",
    { after_seq: { type: "number" }, limit: { type: "number" } },
    [],
  ),
  tool(
    "register_agent",
    "Create or update an agent identity.",
    { project_key: string, name: string, program: string, model: string },
    ["project_key", "program", "model"],
  ),
  tool("list_agents", "List agents in a project.", { project_key: string }, [
    "project_key",
  ]),
  tool(
    "send_message",
    "Send a message, optionally replying to a thread or attaching uploaded file IDs.",
    {
      project_key: string,
      sender_name: string,
      to: { type: "array", items: string },
      subject: string,
      body_md: string,
      thread_id: string,
      importance: { type: "string", enum: ["normal", "high"] },
      attachment_paths: { type: "array", items: string },
      idempotency_key: string,
    },
    ["project_key", "sender_name", "to", "subject", "body_md"],
  ),
  tool(
    "fetch_inbox",
    "Read an agent inbox.",
    { project_key: string, agent_name: string },
    ["project_key", "agent_name"],
  ),
  tool(
    "get_message",
    "Read a message and its attachment download URLs.",
    { message_id: string },
    ["message_id"],
  ),
  tool(
    "mark_message_read",
    "Mark a recipient message read.",
    { message_id: string, agent_name: string },
    ["message_id", "agent_name"],
  ),
  tool(
    "upload_attachment",
    "Upload up to 6 MiB of base64 file data. Returns an attachment ID; never accepts server paths.",
    { project_key: string, filename: string, data_base64: string },
    ["project_key", "filename", "data_base64"],
  ),
];
const number = { type: "integer" },
  boolean = { type: "boolean" },
  strings = { type: "array", items: string };
const paging = {
  limit: { type: "integer", minimum: 1, maximum: 100 },
  cursor: string,
};
tools.find((t) => t.name === "ensure_project").inputSchema.properties.team_id =
  string;
Object.assign(
  tools.find((t) => t.name === "fetch_inbox").inputSchema.properties,
  { ...paging, unread_only: boolean, query: string },
);
tools.push(
  tool(
    "download_attachment",
    "Download an authorized attachment in base64 chunks. Continue at next_offset until null.",
    {
      file_id: string,
      offset: { type: "integer", minimum: 0 },
      max_bytes: { type: "integer", minimum: 1, maximum: 262144 },
    },
    ["file_id"],
  ),
  tool(
    "reply_message",
    "Reply to an authorized message, preserving its thread.",
    {
      message_id: string,
      sender_name: string,
      body_md: string,
      to: strings,
      attachment_paths: strings,
      idempotency_key: string,
    },
    ["message_id", "body_md"],
  ),
  tool(
    "get_thread",
    "Read an authorized conversation with keyset pagination (newest first).",
    { message_id: string, ...paging },
    ["message_id"],
  ),
  tool(
    "search_messages",
    "Search only authorized messages. Supports unread filtering and stable keyset pagination.",
    {
      project_key: string,
      agent_name: string,
      query: string,
      unread_only: boolean,
      ...paging,
    },
    ["project_key"],
  ),
  tool(
    "list_teams",
    "List teams visible to the authenticated user. Not available to agent credentials.",
    {},
    [],
  ),
  tool(
    "get_team_settings",
    "Read authorized team membership, key metadata and audit history. User credentials required.",
    { team_id: string },
    ["team_id"],
  ),
  tool(
    "create_team",
    "Create a team. Requires an unscoped browser user session.",
    { name: string },
    ["name"],
  ),
  tool(
    "update_team",
    "Update team name and attachment storage quota. Team administrator required.",
    { team_id: string, name: string, quota_bytes: number },
    ["team_id", "name", "quota_bytes"],
  ),
  tool(
    "invite_member",
    "Create an email-bound, single-use team invitation. Team administrator required; returns its code once.",
    {
      team_id: string,
      email: string,
      role: { type: "string", enum: ["admin", "member", "viewer"] },
    },
    ["team_id", "email", "role"],
  ),
  tool(
    "revoke_invitation",
    "Revoke a pending invitation. Team administrator required.",
    { invitation_id: string },
    ["invitation_id"],
  ),
  tool(
    "accept_invitation",
    "Join the invited team using your user credential. A team-scoped token cannot join another team.",
    { code: string },
    ["code"],
  ),
  tool(
    "update_member",
    "Change a role or remove a member, respecting owner/admin restrictions.",
    {
      team_id: string,
      user_id: string,
      role: { type: "string", enum: ["admin", "member", "viewer"] },
      remove: boolean,
    },
    ["team_id", "user_id"],
  ),
  tool(
    "create_agent_key",
    "Issue an expiring agent credential for an authorized project. User credentials required; returns the secret once.",
    {
      project_key: string,
      agent_name: string,
      name: string,
      days: {
        type: "integer",
        minimum: 0,
        maximum: 3650,
        description: "Days until the key expires. 0 means it never expires.",
      },
    },
    ["project_key", "agent_name", "name"],
  ),
  tool(
    "list_agent_keys",
    "List authorized key metadata without credential secrets. User credentials required.",
    { team_id: string },
    ["team_id"],
  ),
  tool(
    "revoke_agent_key",
    "Revoke your key or a managed team key. User credentials required.",
    { key_id: string },
    ["key_id"],
  ),
  tool(
    "file_reservation_paths",
    "Atomically reserve exact repository paths or directory/** scopes, with exclusive/shared access and a TTL.",
    {
      project_key: string,
      agent_name: string,
      paths: strings,
      exclusive: boolean,
      ttl_seconds: { type: "integer", minimum: 60, maximum: 3600 },
      reason: string,
    },
    ["project_key", "paths"],
  ),
  tool(
    "list_file_reservations",
    "List active reservations in an authorized project.",
    { project_key: string },
    ["project_key"],
  ),
  tool(
    "renew_file_reservations",
    "Renew your own agent reservations before they expire.",
    {
      project_key: string,
      agent_name: string,
      reservation_ids: strings,
      ttl_seconds: { type: "integer", minimum: 60, maximum: 3600 },
    },
    ["project_key", "reservation_ids"],
  ),
  tool(
    "release_file_reservations",
    "Release your own reservations. force requires a human team administrator.",
    {
      project_key: string,
      agent_name: string,
      reservation_ids: strings,
      force: boolean,
    },
    ["project_key", "reservation_ids"],
  ),
);
tools.push(...coordinationTools, ...callTools);
for (const definition of tools) {
  definition.inputSchema.properties = Object.fromEntries(
    Object.entries(definition.inputSchema.properties).map(([key, spec]) => [
      key,
      spec.type === "string"
        ? {
            ...spec,
            maxLength:
              key === "data_base64"
                ? 8388608
                : key === "body_md"
                  ? 100000
                  : 1000,
          }
        : spec,
    ]),
  );
}
export function callTool(name, args = {}, db) {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new MailError("Invalid tool arguments");
  const schema = tools.find((t) => t.name === name)?.inputSchema;
  if (!schema) throw new MailError("Unknown tool", 404);
  for (const key of schema.required)
    if (args[key] === undefined) throw new MailError(`Missing ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties[key];
    if (!spec) throw new MailError(`Unknown argument ${key}`);
    if (typeof value === "string" && value.length > spec.maxLength)
      throw new MailError(`${key} is too long`);
    if (
      (spec.type === "string" && typeof value !== "string") ||
      (spec.type === "boolean" && typeof value !== "boolean") ||
      (spec.type === "integer" && !Number.isInteger(value)) ||
      (spec.type === "array" &&
        (!Array.isArray(value) ||
          value.length > 100 ||
          value.some((item) => typeof item !== "string")))
    )
      throw new MailError(`Invalid ${key}`);
    if (
      (spec.enum && !spec.enum.includes(value)) ||
      (spec.minimum !== undefined && value < spec.minimum) ||
      (spec.maximum !== undefined && value > spec.maximum)
    )
      throw new MailError(`Invalid ${key}`);
  }
  if (!db) throw new MailError("Authentication required", 401);
  if (callTools.some((t) => t.name === name)) return callCall(name, args, db);
  if (coordinationTools.some((t) => t.name === name))
    return coordinationCall(name, args, db);
  switch (name) {
    case "ensure_project": {
      const p = db.ensureProject(args.human_key, args.team_id);
      return { ...p, slug: p.id, human_key: p.name };
    }
    case "list_projects":
      return db.projects();
    case "events_since":
      return accounts(db.security).eventsSince(db, args.after_seq, args.limit);
    case "register_agent":
      return db.register({
        ...args,
        name: args.name || db.actor?.agent_name,
      });
    case "list_agents":
      return db.agents(args.project_key);
    case "send_message":
      return db.send(args);
    case "fetch_inbox":
      return searchMessages(db, args, true);
    case "search_messages":
      return searchMessages(db, args);
    case "download_attachment": {
      const { file, bytes } = db.download(args.file_id),
        offset = args.offset ?? 0,
        maximum = args.max_bytes ?? 131072;
      if (offset > bytes.length)
        throw new MailError("Offset exceeds file size");
      const part = bytes.subarray(offset, offset + maximum);
      return {
        file_id: file.id,
        filename: file.filename,
        sha256: file.sha256,
        total_bytes: file.size,
        offset,
        data_base64: part.toString("base64"),
        next_offset:
          offset + part.length < bytes.length ? offset + part.length : null,
      };
    }
    case "get_thread": {
      const m = db.message(args.message_id);
      return searchMessages(db, {
        project_key: m.project_id,
        thread_id: m.thread_id,
        limit: args.limit,
        cursor: args.cursor,
      });
    }
    case "reply_message": {
      const original = db.message(args.message_id),
        sender = args.sender_name || db.actor.agent_name;
      if (!sender)
        throw new MailError("sender_name is required for a user credential");
      const recipients =
        args.to ||
        [
          ...new Set([
            original.sender_name,
            ...original.recipients.map((r) => r.name),
          ]),
        ].filter((n) => n !== sender);
      return db.send({
        project_key: original.project_id,
        sender_name: sender,
        to: recipients.length ? recipients : [sender],
        subject: original.subject,
        body_md: args.body_md,
        thread_id: original.thread_id,
        attachment_paths: args.attachment_paths,
        idempotency_key: args.idempotency_key,
      });
    }
    case "list_teams":
      return db.security.teams(db.actor);
    case "get_team_settings":
      return db.security.settings(db.actor, args.team_id);
    case "create_team":
      return db.security.newTeam(db.actor, args.name);
    case "update_team":
      return db.security.updateTeam(db.actor, args);
    case "invite_member":
      return db.security.invite(db.actor, args);
    case "revoke_invitation":
      return db.security.revokeInvite(db.actor, args.invitation_id);
    case "accept_invitation":
      return db.security.join(db.actor, args.code);
    case "update_member":
      return db.security.member(db.actor, args);
    case "create_agent_key":
      return db.security.issueKey(db.actor, args);
    case "list_agent_keys":
      return db.security.settings(db.actor, args.team_id).keys;
    case "revoke_agent_key":
      return db.security.revokeKey(db.actor, args.key_id);
    case "file_reservation_paths":
      return reserve(db, args);
    case "list_file_reservations":
      return reservations(db, args);
    case "renew_file_reservations":
      return releaseReservations(db, args, true);
    case "release_file_reservations":
      return releaseReservations(db, args);
    case "get_message":
      return db.message(args.message_id);
    case "mark_message_read":
      return db.read(args.message_id, args.agent_name);
    case "upload_attachment": {
      const data = args.data_base64;
      if (
        typeof data !== "string" ||
        !data ||
        data.length > Math.ceil(MAX_FILE / 3) * 4 ||
        data.length % 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
      )
        throw new MailError("Invalid base64 upload");
      const f = db.upload(
        args.project_key,
        args.filename,
        Buffer.from(data, "base64"),
      );
      return { ...f, path: f.id };
    }
  }
}
