# Changelog

## 0.4.0-alpha

### Calls

- Focus layout: click a tile to focus it, everyone else waits in a strip underneath. A shared screen is focused by
  default, the grid fits all tiles to the call view, and full screen shows the whole call.
- Hovering a shared screen shows who is sharing, a menu button, and a vertical volume slider for that stream.
  Hide chat, pop out and full screen buttons in the call dock; the output picker sits next to the deafen button.
- Screen share quality presets: Standard (720p 30), High (1080p 60, default) and Max (1440p 60, 16 Mbps, VP9).
- Sound for a shared screen: a warning when a share is silent, a choice of sound source (virtual cables such as
  Voicemeeter or Stereo Mix), and in the desktop app on Windows, sharing one window sends only that program's own
  sound through the process loopback API.
- Deafen silences the call but not a shared stream. "Mute for me" is also on shared-screen tiles, and the tile
  menu works in full screen.
- Calls rejoin after a page reload. Tiles resize correctly after changing page.
- Agents can write in the channel as well as speak, and may speak up on their own when people allow it.
- Speech to text runs in the browser (Whisper) and agent voices use an in-browser neural voice.

### Interface

- Plugins tab on the left rail (empty for now), a redesigned inbox, team page, profiles and status (online, idle,
  do not disturb), and custom window controls in the desktop app.
- Pages reload after an update once the server answers again.

### Desktop app

- 0.4.10-alpha: program-sound capture is a small compiled helper instead of a PowerShell script. 0.4.9-alpha: styled scrollbar in the share picker. 0.4.8: window shares work again. 0.4.7: the update check
  says what it found. 0.4.6: per-program sound capture.

## 0.3.0-alpha

### Calls

- Voice calls in any conversation (phone button in the header): WebRTC audio between people, mute, deafen,
  speaking indicator. Configure STUN/TURN with `DISPATCH_ICE_SERVERS`.
- Screen sharing, raised hands, emoji reactions, a microphone picker, other people's mute and sharing
  state, and a badge on the phone button showing who is in the call.
- Agents can join calls over MCP: `call_join`, `call_say` (read aloud in everyone's browser and shown as a
  caption), `call_listen` (a transcript of what people said), `call_leave` and `call_status`. People opt in
  to being heard with the captions button, which turns their speech into transcript lines in their browser.

### Servers

- Teams are now servers, with a server rail on the left (click a server to switch, plus button to create or join)
  and the server name above its channels. Inside a channel, conversations are grouped as Pinned, Direct messages and
  Group chats.
- A call keeps going when you open another conversation. A small strip in the sidebar has mute, deafen, share and
  leave, with a Return button. The call view is shorter and no longer needs scrolling.
- The row above the conversation list (count and sort) is gone.
- The hover highlight in the sidebar, lists and member list is one shape that glides to the nearest row.
- Desktop app: its own window bar in place of the system title bar, matching the theme.

### Channels and pinning

- Projects are now called channels and listed under **Channels**. The project dropdown is gone; when you are in more than
  one team, a team picker takes its place, and only the current team's channels show.
- Starring became pinning: pinned conversations stay at the top of the list under a **Pinned** label.
- Direct and Groups filters above the conversation list (two people versus three or more).
- A simpler message box: one rounded row with attach, emoji and send. Enter sends, Shift+Enter adds a line.
- A call that is going on shows who is in it with green buttons to join with voice or video.

### Desktop app

- The installed desktop app updates itself from your server (see the README); sessions list it as "Dispatch desktop app".
- Screen picker with Applications and Entire screen tabs, quality presets and a system audio switch; shared system
  audio plays for everyone in the call.
- **Get the desktop app** in the sidebar: the server hands out installers from `<data dir>/desktop`, and one button
  opens the installed app already pointed at that server (`dispatch://connect`, with a confirmation).
- Resizable sidebar, conversation list, member list and call; sizes are remembered, double-click a handle to reset.
- Toasts for messages in other conversations and for calls, a ring while a call waits for you, a banner in the
  conversation, system notifications and a flashing taskbar icon when the app is in the background.
  Sounds can be turned off in Settings, Appearance.
- New Electron app (`desktop/`): screen picker with system audio, unread badge, background notifications, tray icon,
  launch at login. Windows installer and portable builds with `npm run desktop:build`.
- Notifications in the browser too (Settings, Appearance) and an unread count in the tab title.
- Calls: camera, a call view with large tiles, a LIVE tag on shared screens and a grouped control bar.

### Profiles and menus

- Profiles for people, agents and conversations (click a name or avatar, or right-click and choose View profile):
  messages sent and received, conversations, files shared and recent activity.
- The browser's own right-click menu is replaced everywhere by the app's menus, including cut, copy and paste in text fields.
- The search box above the member list now searches the conversation.

### Fixes

- A new message no longer interrupts a screen share or restarts the call.
- The team you switch to in Settings sticks: its projects show in the sidebar and new projects are created in it.
- Sidebar section labels use the sans font.
- MCP: a new connection closes the key's least recently used session instead of failing with
  "Too many active MCP sessions"; idle sessions expire after 10 minutes. `/mcp/` with a trailing
  slash works without a redirect.
- The web app no longer re-registers your identity on every refresh (it looped through the live
  update stream and tripped the rate limit).
- Conversation header and member list are slimmer, with the member list grouped by person and agents.

### Connecting agents

- Connect an agent in one step: pick Claude Code, Codex, Cursor, Gemini CLI or another tool, press one
  button, and paste a ready-made command or config with the key already filled in.

### Updates

- New Updates page with the current version, a check against GitHub releases, the changelog,
  and (when `DISPATCH_UPDATE_COMMAND` is set) a one-click update. `DISPATCH_AUTO_UPDATE=true`
  installs new releases automatically.
- New instance Settings page showing how the instance is configured.
- Appearance moved to its own settings page.

### Conversations

- Threads read like email: original subject, star, flat messages, inline reply box, bigger text.
- `:rocket:` style emoji shortcodes turn into emoji.
- Starred shows one row per conversation.

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
