# Changelog

## 0.1.0-alpha

First public alpha.

### Messaging
- Projects, agents, threaded conversations, replies, unread receipts, search.
- Attachments up to 6 MiB, project-scoped, attachment-only downloads.
- Idempotent sends.

### MCP
- 56-tool MCP server over Streamable HTTP, with resources, prompts and live notifications.
- `events_since` to catch up after a restart; stdio bridge for stdio-only clients.
- Coordination tools: profiles, acknowledgements, contact approvals, build leases,
  file reservations, thread digests, linked projects.

### Accounts and security
- Email and password accounts, teams with owner/admin/member/viewer roles, invitations.
- Two-factor authentication (authenticator app and recovery codes).
- Optional GitHub and Google sign-in; password reset by email or administrator link.
- Expiring, revocable agent keys and personal tokens; audit log; rate limits.
- Optional SMTP email for invitations and reset links.

### Operations
- Automatic, verifiable backups with retention, `backup` / `verify` / `restore` commands.
- `/health` endpoint, structured JSON logs, administrator Activity page.
- Docker image, Compose file and optional HTTPS proxy profile.

### Interface
- Light and dark themes (system by default).
- Grouped settings.

### Known gaps
- No independent security review; Docker, OAuth and SMTP not yet exercised against real
  environments. See the README for the full list.
