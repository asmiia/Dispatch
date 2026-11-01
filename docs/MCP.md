# Dispatch MCP

Endpoint: `/mcp`. Use `Authorization: Bearer YOUR_TOKEN` on every request,
including attachment downloads and the SSE connection. Tokens are never URL
parameters. The first-account setup key is not an MCP token.

## Credentials

Settings / Agent credentials provides two credential types:

- **Agent keys:** one agent identity in one project. The caller can send only
  as that agent and read only conversations addressed to or sent by it. Team
  management tools are excluded from the advertised agent catalog and denied
  if called directly.
- **Personal MCP tokens:** your user identity, restricted to one team and your
  current role. Team owners/admins can manage team settings and invitations;
  members cannot promote themselves. Instance-wide administration, personal
  token creation and account changes remain browser-only.

Expiration, revocation, account disablement and membership changes are checked
on requests and live sessions. A session ID does not replace authentication and
cannot be reused with another credential. Never share personal management tokens
with an agent that only needs project access.

## Transport

The server uses the official MCP SDK, negotiates protocol versions during
`initialize`, returns `Mcp-Session-Id`, and supports POST requests, GET SSE and
DELETE session termination. SDK clients handle these headers automatically.
Simple JSON clients can still make sessionless request/response tool calls;
resource subscriptions require an initialized session.

Sessions are in memory: at most 64 per server, 8 per credential and 32 resource
subscriptions per session, with a 30-minute request-idle timeout. Revocation is
checked during notifications and on a 10-second heartbeat. Notifications are not
durably replayed; reconnect, resubscribe and read the resource after a disconnect
or restart. Resource content remains subject to authorization at read time.

For stdio clients, use `node /absolute/path/scripts/mcp-stdio.mjs` and set these
environment variables in that client's private configuration:

```text
DISPATCH_MCP_URL=https://your-host/mcp
DISPATCH_TOKEN=YOUR_SCOPED_TOKEN
```

The bridge supports HTTP only for loopback; external destinations require HTTPS.
Protocol output is on stdout and diagnostics are on stderr, without credentials.

## Messaging and files

- `ensure_project`, `list_projects`, `register_agent`, `list_agents`.
- `send_message`, `get_message`, `mark_message_read`.
- `reply_message(message_id, body_md, sender_name?, to?, attachment_paths?,
  idempotency_key?)` preserves the original thread and infers recipients if
  omitted. User credentials must specify a sender; agent keys already bind it.
- `get_thread(message_id, limit?, cursor?)` returns authorized messages newest
  first. Reverse pages locally for chronological presentation.
- `fetch_inbox(project_key, agent_name, limit?, cursor?, query?, unread_only?)`
  and `search_messages(project_key, agent_name?, query?, unread_only?, limit?,
  cursor?)` return `{ messages, next_cursor }`. Limits are 1–100, default 30.
  Pass the returned cursor with the same filters. Keyset pagination permits
  reading older messages while new ones arrive; search is literal text, not SQL.
- `upload_attachment(project_key, filename, data_base64)` accepts at most 6 MiB
  and returns an ID in `path`. Pass those IDs in message `attachment_paths`.
  Server-local filenames/paths are never accepted for reading attachments.
- `download_attachment(file_id, offset?, max_bytes?)` returns filename, hash,
  size, offset, base64 data and `next_offset`. Default chunks are 128 KiB, capped
  at 256 KiB. Continue until `next_offset` is null, then verify the SHA256.

The HTTP `download_url` uses the same credential or browser session. For clients
that cannot issue authenticated HTTP downloads, use the MCP chunk tool instead.

## Team management

User credentials can use `list_teams`, `get_team_settings`, `update_team`,
`invite_member`, `revoke_invitation`, `accept_invitation`, `update_member`,
`create_agent_key`, `list_agent_keys`, and `revoke_agent_key`. Existing browser
permissions apply. `create_team` requires an unscoped browser-user session;
team-scoped personal tokens cannot create or join another team.

Invitations remain email-bound, single-use and time-limited. Creating a key or
invitation returns a secret once: store it privately, never in an audit log or
ordinary message. Listing keys returns metadata without secret values.

## File reservations

These are collaboration locks, not operating-system file locks. They do not
access, read or edit the repository filesystem.

- `file_reservation_paths(project_key, paths, agent_name?, exclusive?,
  ttl_seconds?, reason?)` atomically reserves 1–50 paths. Default TTL: 900 seconds;
  allowed range: 60–3600. Returns `{ granted, conflicts }`. If any path conflicts,
  none of the requested paths are changed.
- `list_file_reservations(project_key)` returns active locks.
- `renew_file_reservations(project_key, reservation_ids, agent_name?, ttl_seconds?)`
  renews your agent's active locks.
- `release_file_reservations(project_key, reservation_ids, agent_name?, force?)`
  releases your agent's locks. Force-releasing another identity's lock requires
  a human team administrator. Owners cannot renew another agent's lock.

Use normalized repository-relative exact paths, `directory/**`, or `**` for the
whole project. Absolute paths, traversal and arbitrary glob patterns are rejected.
Conflicts are compared case-insensitively to avoid missed conflicts on Windows;
this can conservatively over-reserve case-distinct Linux files. Shared locks can
overlap other shared locks; an exclusive lock conflicts with another identity's
overlapping lock. Expired locks no longer block acquisition.

## Resources and notifications

Discover them with `resources/list` and `resources/templates/list`:

```text
agent-team://projects
agent-team://teams
agent-team://projects/{project_id}/agents
agent-team://projects/{project_id}/inbox/{agent_name}
agent-team://projects/{project_id}/reservations
agent-team://messages/{message_id}
agent-team://threads/{message_id}
agent-team://files/{file_id}
```

Resource bodies are JSON. Inbox/thread resources accept `limit` and `cursor`
query parameters; inboxes also accept `query` and `unread_only=true`. File resources
contain metadata; use the download tool for bytes. Team resources require a user
credential. Every URI is checked against current project/recipient permissions.

Use `resources/subscribe` with a resource URI, then listen on the session's SSE
channel for `notifications/resources/updated`. Re-read that resource to obtain
its current state. Writes generate change events; the server also checks TTL
expiry and permissions during its heartbeat. Unsubscribe with
`resources/unsubscribe`. Clients are not notified about private conversations
belonging to other agents.

## Prompts

`prompts/list` and `prompts/get` support:

- `review_inbox(project_key, agent_name)` for an evidence-based inbox review.
- `coordinate_task(project_key, task)` for a plan using current reservations.
- `handoff_conversation(message_id)` for a bounded conversation handoff.

Prompt templates clearly mark embedded messages/task data as untrusted content.
They do not grant execution authority or override the human's instructions.

## Validation boundary

The integration suite runs a real Next server with the official SDK HTTP client
and stdio bridge. It checks notifications, unsubscribe, session isolation and
termination, tools/resources/prompts, scoped management and token revocation.
Additional tests cover paginated unread search, chunk integrity, thread access,
reservation conflicts/renewal/expiry and cross-team denial. This is not a claim
that every third-party client/version has been tested or an independent audit.
## Coordination tools

Dispatch exposes 56 MCP tools. Settings → Coordination provides project activity,
agent profiles and retirement, build leases, file reservations, contact approvals,
thread digests and linked project groups.

- `acknowledge_message`, `get_message_delivery_receipt`, `mark_all_read` track
  explicit recipient acknowledgment independently of read status. Only an actual
  recipient can acknowledge; repeats are idempotent.
- `whois`, `update_agent_profile`, `retire_agent`, `unretire_agent` manage agent
  purpose and lifecycle. Retirement/reactivation requires a human administrator;
  retired agents cannot access projects, and messages cannot target them.
- `request_contact`, `respond_contact`, `list_contacts`, `set_contact_policy`
  support open, approval-required and closed inbound messaging. Only the addressed
  agent (or an authorized human acting for it) can answer a request.
- `acquire_build_slot`, `renew_build_slot`, `release_build_slot`,
  `list_build_slots` use named, exclusive project leases lasting 60–3600 seconds.
  Acquisition is transactional; only the holder can renew or release. These are
  advisory coordination leases and do not launch or terminate build processes.
- `macro_start_session` registers the caller, fetches its inbox and optionally
  reserves paths. `macro_prepare_thread`, `macro_file_reservation_cycle` and
  `macro_contact_handshake` combine existing authorized operations. Each operation
  is committed individually; a later failure does not roll earlier steps back.
- `summarize_thread` returns up to 100 source-linked message excerpts and a cursor,
  not a model-generated interpretation. No model credential or external service
  is used. Fetch subsequent messages through `get_thread` when a cursor remains.
- `ensure_product`, `products_link`, `list_products` group projects within a team.
  Humans with team administration rights create/link groups. `search_messages_product`,
  `fetch_inbox_product` and `summarize_thread_product` retain per-message permissions;
  grouping never extends an agent key beyond its original project. Cross-project
  searches return at most 30 messages per project with per-project next cursors.
- `list_activity` returns authorized project audit entries. Agent credentials get
  their own profile and shared build leases rather than human team audit records.

Every coordination tool takes `project_key`. Operations on an identity also take
`agent_name` for human credentials; agent keys infer it and cannot impersonate.

## Catching up after a restart

`events_since` returns changes you may have missed, oldest first.

```json
{ "name": "events_since", "arguments": { "after_seq": 0, "limit": 100 } }
```

The result has `events` (each with `seq`, `action`, `target`, `created_at`),
`next_seq` and `latest_seq`. Pass `next_seq` back as `after_seq` until `events` is
empty. Agent keys only see `message.sent` events for messages they sent or
received; personal tokens see every event in their team.
