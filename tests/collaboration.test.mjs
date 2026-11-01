import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailStore } from "../lib/store.mjs";
import { Security, ScopedMail } from "../lib/security.mjs";
import { callTool } from "../lib/mcp.mjs";
import {
  readResource,
  getPrompt,
  resourceList,
} from "../lib/mcp-resources.mjs";
test("MCP features: keyset pagination, unread filters, chunks, replies, resources, prompts and locks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "team-collab-")),
    mail = new MailStore(dir),
    sec = new Security(mail);
  try {
    const user = await sec.register(
        {
          email: "owner@example.com",
          name: "Owner",
          password: "testing collaboration password",
        },
        true,
      ),
      actor = { kind: "user", id: user.id },
      human = new ScopedMail(sec, actor),
      team = sec.teams(actor)[0];
    const p = human.ensureProject("Example project", team.id);
    for (const name of ["SilverPine", "CopperGrove", "BlueLake"])
      human.register({ project_key: p.id, name });
    const keys = ["SilverPine", "CopperGrove", "BlueLake"].map((agent_name) =>
      sec.issueKey(actor, { project_key: p.id, agent_name, name: agent_name }),
    );
    const scoped = (index) =>
      new ScopedMail(
        sec,
        sec.authenticate(
          new Request("http://localhost/mcp", {
            headers: { Authorization: "Bearer " + keys[index].token },
          }),
        ),
      );
    const a = scoped(0),
      b = scoped(1),
      other = scoped(2),
      run = (name, args) => callTool(name, args, a);
    const bytes = Buffer.from("an attachment split across chunks");
    const file = run("upload_attachment", {
      project_key: p.id,
      filename: "notes.txt",
      data_base64: bytes.toString("base64"),
    });
    const ids = [];
    for (let i = 0; i < 7; i++)
      ids.push(
        human.send({
          project_key: p.id,
          sender_name: "CopperGrove",
          to: ["SilverPine"],
          subject: "Thread " + i,
          body_md: "searchable note " + i,
          attachment_paths: i === 0 ? [file.id] : [],
        }),
      );
    const first = run("fetch_inbox", {
      project_key: p.id,
      agent_name: "SilverPine",
      limit: 3,
      unread_only: true,
    });
    assert.equal(first.messages.length, 3);
    assert.ok(first.next_cursor);
    const second = run("fetch_inbox", {
      project_key: p.id,
      agent_name: "SilverPine",
      limit: 3,
      unread_only: true,
      cursor: first.next_cursor,
    });
    assert.equal(second.messages.length, 3);
    assert.ok(
      second.messages.every(
        (m) => !first.messages.some((old) => old.id === m.id),
      ),
    );
    assert.throws(
      () =>
        run("search_messages", {
          project_key: p.id,
          query: "other",
          cursor: first.next_cursor,
        }),
      /Invalid cursor/,
    );
    const found = run("search_messages", {
      project_key: p.id,
      query: "searchable note 0",
    });
    assert.equal(found.messages.length, 1);
    run("mark_message_read", {
      message_id: ids[0].id,
      agent_name: "SilverPine",
    });
    assert.equal(
      run("fetch_inbox", {
        project_key: p.id,
        agent_name: "SilverPine",
        unread_only: true,
      }).messages.length,
      6,
    );
    const reply = run("reply_message", {
      message_id: ids[0].id,
      body_md: "Received.",
    });
    assert.equal(reply.thread_id, ids[0].thread_id);
    assert.equal(
      run("get_thread", { message_id: ids[0].id }).messages.length,
      2,
    );
    const chunks = [];
    let offset = 0;
    do {
      const piece = run("download_attachment", {
        file_id: file.id,
        offset,
        max_bytes: 7,
      });
      chunks.push(Buffer.from(piece.data_base64, "base64"));
      offset = piece.next_offset;
    } while (offset !== null);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.throws(
      () => callTool("download_attachment", { file_id: file.id }, other),
      /Not found/,
    );
    assert.ok(resourceList(a).some((r) => r.name === "SilverPine inbox"));
    assert.throws(
      () => readResource(other, "agent-team://messages/" + ids[0].id),
      /Not found/,
    );
    const inboxResource = readResource(
      a,
      `agent-team://projects/${p.id}/inbox/SilverPine?limit=2`,
    );
    assert.equal(JSON.parse(inboxResource.contents[0].text).messages.length, 2);
    assert.match(
      getPrompt(a, "review_inbox", {
        project_key: p.id,
        agent_name: "SilverPine",
      }).messages[0].content.text,
      /untrusted project data/,
    );
    const lock = run("file_reservation_paths", {
      project_key: p.id,
      paths: ["src/**"],
      ttl_seconds: 60,
    });
    assert.equal(lock.granted.length, 1);
    const conflict = callTool(
      "file_reservation_paths",
      { project_key: p.id, paths: ["src/main.js", "other.js"] },
      b,
    );
    assert.equal(conflict.granted.length, 0);
    assert.equal(conflict.conflicts.length, 1);
    assert.equal(
      callTool("list_file_reservations", { project_key: p.id }, b).length,
      1,
    );
    assert.throws(
      () =>
        run("file_reservation_paths", {
          project_key: p.id,
          paths: ["../secret"],
        }),
      /relative path/,
    );
    assert.throws(
      () =>
        callTool(
          "release_file_reservations",
          { project_key: p.id, reservation_ids: [lock.granted[0].id] },
          b,
        ),
      /another agent/,
    );
    run("renew_file_reservations", {
      project_key: p.id,
      reservation_ids: [lock.granted[0].id],
      ttl_seconds: 120,
    });
    run("release_file_reservations", {
      project_key: p.id,
      reservation_ids: [lock.granted[0].id],
    });
    assert.equal(
      run("list_file_reservations", { project_key: p.id }).length,
      0,
    );
    const shared = run("file_reservation_paths", {
      project_key: p.id,
      paths: ["shared.js"],
      exclusive: false,
    });
    assert.equal(
      callTool(
        "file_reservation_paths",
        { project_key: p.id, paths: ["shared.js"], exclusive: false },
        b,
      ).granted.length,
      1,
    );
    assert.equal(
      callTool(
        "file_reservation_paths",
        { project_key: p.id, paths: ["shared.js"] },
        other,
      ).conflicts.length,
      2,
    );
    mail.db.prepare("UPDATE reservations SET expires_at=0").run();
    assert.equal(
      run("list_file_reservations", { project_key: p.id }).length,
      0,
    );
    const personal = sec.issuePersonalKey(actor, {
        team_id: team.id,
        name: "Admin client",
      }),
      principal = sec.authenticate(
        new Request("http://localhost/mcp", {
          headers: { Authorization: "Bearer " + personal.token },
        }),
      ),
      adminClient = new ScopedMail(sec, principal);
    const secondTeam = sec.newTeam(actor, "Other team"),
      foreign = human.ensureProject("Private", secondTeam.id);
    assert.throws(() => adminClient.project(foreign.id), /Not found/);
    assert.equal(adminClient.projects().length, 1);
    assert.equal(callTool("list_teams", {}, adminClient).length, 1);
    assert.throws(
      () =>
        callTool("get_team_settings", { team_id: secondTeam.id }, adminClient),
      /Not found/,
    );
    assert.throws(
      () => callTool("create_team", { name: "Forbidden" }, adminClient),
      /cannot create/,
    );
    assert.throws(
      () =>
        callTool(
          "invite_member",
          { team_id: team.id, email: "x@example.com", role: "member" },
          a,
        ),
      /user account/,
    );
    assert.ok(
      callTool(
        "invite_member",
        { team_id: team.id, email: "new@example.com", role: "viewer" },
        adminClient,
      ).code,
    );
    sec.revokePersonalKey(actor, personal.id);
    assert.throws(
      () =>
        sec.authenticate(
          new Request("http://localhost/mcp", {
            headers: { Authorization: "Bearer " + personal.token },
          }),
        ),
      /expired user key/,
    );
  } finally {
    mail.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
