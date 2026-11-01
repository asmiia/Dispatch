import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailStore } from "../lib/store.mjs";
import { Security, ScopedMail } from "../lib/security.mjs";
test("first administrator, invitations, team isolation, scoped keys and revocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "team-security-"));
  const mail = new MailStore(dir),
    sec = new Security(mail);
  const password = "strong testing password 2026";
  try {
    await assert.rejects(
      () =>
        sec.register(
          { email: "owner@example.com", name: "Owner", password },
          false,
        ),
      /setup key/,
    );
    const owner = await sec.register(
        { email: "owner@example.com", name: "Owner", password },
        true,
      ),
      admin = { kind: "user", id: owner.id };
    assert.equal(owner.site_admin, true);
    const teamA = sec.teams(admin)[0];
    const invitation = sec.invite(admin, {
      team_id: teamA.id,
      email: "member@example.com",
      role: "member",
    });
    await assert.rejects(
      () =>
        sec.register(
          {
            email: "wrong@example.com",
            name: "Wrong",
            password,
            invite_code: invitation.code,
          },
          false,
        ),
      /does not match/,
    );
    const member = await sec.register(
        {
          email: "member@example.com",
          name: "Member",
          password,
          invite_code: invitation.code,
        },
        false,
      ),
      person = { kind: "user", id: member.id };
    assert.equal(member.site_admin, false);
    await assert.rejects(
      () =>
        sec.register(
          {
            email: "other@example.com",
            name: "Other",
            password,
            invite_code: invitation.code,
          },
          false,
        ),
      /Invalid or expired/,
    );
    const ownerMail = new ScopedMail(sec, admin),
      memberMail = new ScopedMail(sec, person);
    const pA = ownerMail.ensureProject("Project A", teamA.id);
    const teamB = sec.newTeam(admin, "Team B"),
      pB = ownerMail.ensureProject("Project B", teamB.id);
    assert.throws(() => memberMail.project(pB.id), /Not found/);
    assert.equal(memberMail.projects().length, 1);
    assert.throws(
      () => memberMail.ensureProject("Forbidden", teamA.id),
      /permissions/,
    );
    for (const name of ["CopperGrove", "SilverPine", "BlueLake"])
      ownerMail.register({ project_key: pA.id, name });
    ownerMail.register({ project_key: pB.id, name: "CopperGrove" });
    const privateFile = ownerMail.upload(
      pB.id,
      "private.txt",
      Buffer.from("team B secret"),
    );
    assert.throws(() => memberMail.download(privateFile.id), /Not found/);
    const key = sec.issueKey(person, {
      project_key: pA.id,
      agent_name: "CopperGrove",
      name: "Desktop",
    });
    const request = () =>
      new Request("http://localhost/mcp", {
        headers: { Authorization: "Bearer " + key.token },
      });
    const actor = sec.authenticate(request()),
      agentMail = new ScopedMail(sec, actor);
    assert.equal(agentMail.projects().length, 1);
    assert.throws(() => agentMail.project(pB.id), /Not found/);
    assert.throws(() => sec.settings(actor, teamA.id), /user account/);
    assert.throws(
      () =>
        sec.issueKey(actor, {
          project_key: pA.id,
          agent_name: "CopperGrove",
          name: "No",
        }),
      /user account/,
    );
    assert.throws(
      () =>
        agentMail.send({
          project_key: pA.id,
          sender_name: "SilverPine",
          to: ["CopperGrove"],
          subject: "Spoof",
          body_md: "No",
        }),
      /impersonate/,
    );
    const ownFile = agentMail.upload(pA.id, "own.txt", Buffer.from("own"));
    const privateA = ownerMail.upload(
      pA.id,
      "other.txt",
      Buffer.from("private other-agent attachment"),
    );
    assert.throws(() => agentMail.download(privateA.id), /Not found/);
    const hidden = ownerMail.send({
      project_key: pA.id,
      sender_name: "SilverPine",
      to: ["BlueLake"],
      subject: "Private",
      body_md: "hidden",
      attachment_paths: [privateA.id],
    });
    assert.throws(() => agentMail.message(hidden.id), /Not found/);
    assert.throws(
      () =>
        agentMail.send({
          project_key: pA.id,
          sender_name: "CopperGrove",
          to: ["SilverPine"],
          subject: "Thread injection",
          body_md: "no",
          thread_id: hidden.thread_id,
        }),
      /Thread not found/,
    );
    assert.throws(() => agentMail.inbox(pA.id, "SilverPine"), /another agent/);
    const sent = agentMail.send({
      project_key: pA.id,
      sender_name: "CopperGrove",
      to: ["SilverPine"],
      subject: "Ready",
      body_md: "Attached",
      attachment_paths: [ownFile.id],
    });
    assert.equal(agentMail.message(sent.id).attachments.length, 1);
    sec.revokeKey(person, key.id);
    assert.throws(() => sec.authenticate(request()), /Invalid or expired/);
    const key2 = sec.issueKey(person, {
      project_key: pA.id,
      agent_name: "CopperGrove",
      name: "Second",
    });
    sec.member(admin, {
      team_id: teamA.id,
      user_id: member.id,
      role: "viewer",
    });
    assert.throws(
      () =>
        sec.authenticate(
          new Request("http://localhost/mcp", {
            headers: { Authorization: "Bearer " + key2.token },
          }),
        ),
      /permissions/,
    );
    assert.throws(
      () =>
        memberMail.send({
          project_key: pA.id,
          sender_name: "CopperGrove",
          to: ["SilverPine"],
          subject: "blocked",
          body_md: "no",
        }),
      /permissions/,
    );
    assert.throws(
      () =>
        sec.member(admin, {
          team_id: teamA.id,
          user_id: owner.id,
          remove: true,
        }),
      /Cannot change/,
    );
    assert.throws(
      () => sec.disableUser(admin, { user_id: owner.id, disabled: true }),
      /Cannot modify/,
    );
    sec.disableUser(admin, { user_id: member.id, disabled: true });
    assert.throws(() => sec.human(person), /Sign in/);
    assert.equal(
      mail.db.prepare("SELECT count(*) count FROM audit").get().count > 5,
      true,
    );
  } finally {
    mail.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("bootstrap is single-use under concurrent registration and legacy projects belong to first owner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "team-bootstrap-")),
    mail = new MailStore(dir);
  const old = mail.ensureProject("Legacy");
  const sec = new Security(mail);
  try {
    const results = await Promise.allSettled([
      sec.register(
        {
          email: "a@example.com",
          name: "A",
          password: "secure test password 123",
        },
        true,
      ),
      sec.register(
        {
          email: "b@example.com",
          name: "B",
          password: "secure test password 456",
        },
        true,
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      mail.db
        .prepare("SELECT count(*) count FROM users WHERE site_admin=1")
        .get().count,
      1,
    );
    assert.ok(mail.project(old.id).team_id);
  } finally {
    mail.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
