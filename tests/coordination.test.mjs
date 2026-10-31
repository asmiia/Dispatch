import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailStore } from "../lib/store.mjs";
import { Security, ScopedMail } from "../lib/security.mjs";
import { callTool } from "../lib/mcp.mjs";
test("Coordination: recipient-only acknowledgments, contact approval, lease ownership, retirement and scoped digests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-coord-")),
    base = new MailStore(dir),
    sec = new Security(base);
  try {
    const user = await sec.register(
        {
          email: "owner@example.com",
          name: "Owner",
          password: "coordination test password",
        },
        true,
      ),
      actor = { kind: "user", id: user.id },
      human = new ScopedMail(sec, actor),
      team = sec.teams(actor)[0],
      p = human.ensureProject("Project", team.id);
    for (const name of ["Alpha", "Bravo", "Charlie"])
      human.register({ project_key: p.id, name });
    const scopes = ["Alpha", "Bravo", "Charlie"].map((agent_name) => {
      const key = sec.issueKey(actor, {
        project_key: p.id,
        agent_name,
        name: agent_name,
      });
      return new ScopedMail(
        sec,
        sec.authenticate(
          new Request("http://localhost/mcp", {
            headers: { Authorization: "Bearer " + key.token },
          }),
        ),
      );
    });
    const [a, b, c] = scopes,
      run = (s, n, args = {}) => callTool(n, { project_key: p.id, ...args }, s);
    run(b, "set_contact_policy", { policy: "approval" });
    assert.throws(
      () =>
        a.send({
          project_key: p.id,
          sender_name: "Alpha",
          to: ["Bravo"],
          subject: "Hello",
          body_md: "Blocked",
        }),
      /contact policy/,
    );
    run(a, "request_contact", { to_agent: "Bravo" });
    assert.throws(
      () => run(c, "respond_contact", { from_agent: "Alpha", accept: true }),
      /not found/,
    );
    run(b, "respond_contact", { from_agent: "Alpha", accept: true });
    const m = a.send({
      project_key: p.id,
      sender_name: "Alpha",
      to: ["Bravo"],
      subject: "Hello",
      body_md: "We should build the release.",
    });
    assert.throws(
      () => run(a, "acknowledge_message", { message_id: m.id }),
      /recipient/,
    );
    run(b, "acknowledge_message", { message_id: m.id });
    run(b, "acknowledge_message", { message_id: m.id });
    assert.ok(
      run(a, "get_message_delivery_receipt", { message_id: m.id })[0]
        .acknowledged_at,
    );
    assert.throws(
      () => run(c, "summarize_thread", { message_id: m.id }),
      /Not found|not found/,
    );
    assert.equal(
      run(a, "summarize_thread", { message_id: m.id }).messages[0].excerpt,
      "We should build the release.",
    );
    const slot = run(a, "acquire_build_slot", { name: "release" });
    assert.throws(
      () => run(b, "acquire_build_slot", { name: "release" }),
      /leased/,
    );
    assert.throws(
      () => run(b, "release_build_slot", { slot_id: slot.id }),
      /not found/,
    );
    run(a, "renew_build_slot", { slot_id: slot.id });
    run(a, "release_build_slot", { slot_id: slot.id });
    assert.equal(run(b, "list_build_slots").length, 0);
    assert.throws(
      () =>
        run(a, "update_agent_profile", {
          agent_name: "Bravo",
          purpose: "impersonated",
        }),
      /impersonate/,
    );
    run(a, "update_agent_profile", { purpose: "Build specialist" });
    assert.equal(
      run(a, "whois", { agent_name: "Alpha" }).purpose,
      "Build specialist",
    );
    assert.throws(
      () => run(a, "retire_agent", { agent_name: "Bravo" }),
      /administrator/,
    );
    run(human, "retire_agent", { agent_name: "Alpha" });
    assert.throws(() => run(a, "list_build_slots"), /retired/);
    run(human, "unretire_agent", { agent_name: "Alpha" });
    assert.equal(run(a, "list_build_slots").length, 0);
    const group = run(human, "ensure_product", { name: "Release" });
    run(human, "products_link", { product_id: group.id });
    assert.equal(run(a, "list_products")[0].id, group.id);
    assert.equal(
      run(a, "search_messages_product", {
        product_id: group.id,
        query: "build",
      }).projects[0].messages.length,
      1,
    );
    assert.throws(
      () => run(a, "ensure_product", { name: "Unauthorized" }),
      /administrator/,
    );
    const isolated = human.ensureProject("Isolated", team.id);
    assert.throws(
      () =>
        callTool(
          "products_link",
          { project_key: isolated.id, product_id: "missing" },
          human,
        ),
      /Not found/,
    );
    assert.equal(
      run(a, "summarize_thread_product", {
        product_id: group.id,
        message_id: m.id,
      }).messages.length,
      1,
    );
    const session = run(a, "macro_start_session", { paths: ["src/**"] });
    assert.equal(session.agent.name, "Alpha");
    assert.ok(session.reservations);
  } finally {
    base.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
