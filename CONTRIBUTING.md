# Contributing to Dispatch

Thanks for helping. Dispatch is alpha software built by a small team, so small, focused
contributions that come with a test are the easiest to review and merge.

## Ways to help

- **Try it and report what breaks.** The most useful thing right now is someone running it
  on a setup the maintainers don't have: Docker on another OS, a real SMTP server, a real
  GitHub or Google OAuth app. Open a [bug report](../../issues/new?template=bug_report.yml).
- **Pick up an issue.** Look for [`good first issue`](../../labels/good%20first%20issue) and
  [`help wanted`](../../labels/help%20wanted). Comment first so two people don't build the
  same thing.
- **Improve the docs.** If something in the README or `docs/MCP.md` confused you, fix it.
- **Ask questions in [Discussions](../../discussions)** rather than issues.

Found a security problem? Don't open an issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need **Node.js 24.12 or newer** (Dispatch uses Node's built-in SQLite) and Google Chrome
if you want to run the browser test or regenerate screenshots.

```bash
git clone https://github.com/asmiia/Dispatch.git
cd Dispatch
npm install
npm run setup     # writes .env.local with a one-time setup key
npm run dev       # http://localhost:3080
```

Create the administrator account with the setup key from `.env.local`. To see email without
an SMTP server, set `DISPATCH_MAIL_FILE=./outbox.jsonl` and watch that file.

## Project map

```
app/        Next.js UI (React, plain CSS) and the API route (app/api/[...path]/route.js)
lib/        store.mjs (SQLite), security.mjs (auth, teams, roles), accounts.mjs (2FA, sessions,
            OAuth, reset), deletion.mjs, backup*.mjs, mcp*.mjs (MCP server and transport)
scripts/    setup, backup CLI, MCP stdio bridge, screenshot and demo generators
tests/      node:test suites and a Playwright browser test
docs/       MCP guide and screenshots
```

Two rules the codebase relies on:

- **Authorization lives in `lib/security.mjs` (`ScopedMail`, `requireRole`).** New routes must
  go through it. Never read the database directly from a route to answer a user request.
- **Colours come from tokens in `app/theme.css`** (`var(--c-…)` for surfaces, `var(--t-…)` for
  text). Don't hard-code hex values in components or stylesheets; add or retune a token so
  both themes stay consistent.

## Tests

Build first. The server suites start `next start` on their own ports against throwaway data
directories, and they never read your `.env.local` or touch your real data and backups.

```bash
npm run build
npm test                # 20+ tests: HTTP, security, store, MCP client, accounts, backup, deletion
npm run test:browser    # real-browser UI test in Chrome
npm run format:check    # Prettier; `npm run format` fixes it
```

A change that alters behaviour needs a test that fails without it. Security-relevant code
(auth, permissions, uploads, deletion, backups) needs one for the failure case too: not only
"the admin can", but "the member can't".

## Pull requests

1. Fork, branch from `main`, keep the change focused. One concern per PR.
2. Run `npm run build && npm test && npm run format:check` before pushing. CI runs the same
   checks and also builds and smoke-tests the Docker image.
3. Update the docs when behaviour or configuration changes: the README, `.env.example`, and
   `CHANGELOG.md` (add a line under the top, unreleased heading if there is one).
4. If you changed the UI, include before and after screenshots, in both themes.
5. Describe *why*, not only what. Link the issue.

Commit messages: a short imperative summary line ("Delete orphaned files with their last
message"), then details if needed. No special format is required.

## Design principles

- **One process, one database file.** Don't add a service that has to run beside Dispatch
  unless there is no alternative. Optional integrations (SMTP, OAuth) must degrade gracefully
  when they aren't configured.
- **Boring and inspectable.** Plain SQL, plain CSS, few dependencies. A new dependency needs a
  reason and a clean `npm audit`.
- **Private by default.** Anything that crosses a team boundary, leaves the server, or logs
  user content needs a very good reason. Secrets never go in logs, URLs or the audit trail.
- **Honest limits.** If a feature has a known gap, say so in the docs rather than hiding it.

## Licence

By contributing you agree that your contribution is licensed under the project's
[MIT licence](LICENSE). There is no CLA.

## Conduct

Be kind and be specific. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## For maintainers: releasing

1. Update `CHANGELOG.md` and bump the version: `npm version <x.y.z-alpha> --no-git-tag-version`.
2. Commit, then tag `vX.Y.Z-alpha` and push the tag. The **Release image** workflow builds and
   publishes `ghcr.io/asmiia/dispatch` for amd64 and arm64.
3. Create the GitHub release (marked as a pre-release while in alpha) from the changelog entry.
