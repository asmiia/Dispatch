import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SKILL_MD, AGENTS_MD, INSTRUCTIONS, guide } from "../lib/agent-guide.mjs";
import { tools } from "../lib/mcp.mjs";

// The guide names tools; a rename must not leave it teaching agents calls that do not exist.
test("every tool the guide mentions exists", () => {
  const names = new Set(tools.map((t) => t.name));
  for (const text of [SKILL_MD, INSTRUCTIONS]) {
    const mentioned = text.match(/\b(?:call|file_reservation|list|fetch|get|send|reply|mark|search|events|upload|download|release|renew)_[a-z_]+\b/g) || [];
    for (const name of new Set(mentioned)) assert.ok(names.has(name) || name === "file_reservation_paths", `unknown tool ${name}`);
  }
});

test("the skill file in the repo is the one the server hands out", () => {
  assert.equal(readFileSync(new URL("../skills/dispatch/SKILL.md", import.meta.url), "utf8"), SKILL_MD);
});

test("formats", () => {
  assert.match(guide("skill"), /^---\nname: dispatch/);
  assert.match(guide("cursor"), /alwaysApply: true/);
  assert.equal(guide("agents"), AGENTS_MD);
  assert.ok(INSTRUCTIONS.length < 2500);
});
