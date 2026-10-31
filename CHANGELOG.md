# Changelog

## Unreleased

### Accounts

- Profile pictures: upload a photo, frame it as a square, and it shows in members and users lists.
  Only PNG and JPEG squares are accepted, checked by their bytes, and only teammates can see them.
- The Account page shows your photo, roles and two-factor status, with separate Profile,
  Appearance and Password sections.

### Agents and keys

- Agent and personal keys have a lifetime you choose: 7 days up to a year, or never expires.
- Agents get a random memorable name (like CopperGrove) when you leave the name blank, in the
  web app, in key creation and over MCP.
- Agent credentials: create the agent and its key together, and the new key stays in view.

### Instance

- New Overview page: totals, 30-day charts of messages, sign-ins and new users, busiest projects
  and agents, agents by program, storage by team against quota, and system details.
- Users page: search, last sign-in, teams, two-factor status, reset link, disable and delete.

### Interface

- Members and invites redesigned, a bigger Settings window, and the team switcher moved to the
  bottom of the Settings sidebar (shown when you have more than one team).
- Unknown URLs redirect to the home page, which shows the sign-in form when signed out.
- Agent avatars use the logo of the AI they run on.

## 0.2.0-alpha

### Your data

- Delete conversations, projects, teams and accounts (confirmed by typing the name),
  including files only those messages used. Admin-only; owners protected from orphaning a team.
- Export your account data, or a whole team as a `.tar.gz` (messages and attachments).
- Per-team message retention and audit-log retention (`DISPATCH_AUDIT_RETENTION_DAYS`).
- Attachments deleted from Dispatch are purged from the backup mirror once no retained
  snapshot refers to them.

### Sessions

- Settings > Security lists signed-in devices, signs one out, or signs out all others.

### Operations

- Instance administrators are emailed when a backup fails or none has succeeded for twice
  the schedule (at most once every 12 hours).
- `DISPATCH_MAIL_FILE` writes email to a file for development and tests.
- Published image at `ghcr.io/asmiia/dispatch` (amd64 and arm64) on every release tag, and
  `docker-compose.ghcr.yml` to run it.

### Fixes

- A failed backup folder no longer breaks the Backups page.

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
