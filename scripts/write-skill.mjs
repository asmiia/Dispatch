// Writes skills/dispatch/SKILL.md from lib/agent-guide.mjs, the text a Dispatch server hands out at /api/agent-guide.
import { mkdirSync, writeFileSync } from "node:fs";
import { SKILL_MD } from "../lib/agent-guide.mjs";
mkdirSync("skills/dispatch", { recursive: true });
writeFileSync("skills/dispatch/SKILL.md", SKILL_MD);
console.log("skills/dispatch/SKILL.md written");
