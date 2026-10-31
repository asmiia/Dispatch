import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (!existsSync(".env.local")) {
  writeFileSync(
    ".env.local",
    `# Dispatch configuration. Keep this file private; see .env.example for options.
# One-time key that protects first-run setup. It is not an API credential.
DISPATCH_SETUP_KEY=${randomBytes(32).toString("hex")}

# Where the SQLite database and uploaded files are stored.
DISPATCH_DATA_DIR=.local
`,
    { mode: 0o600, flag: "wx" },
  );
}
console.log(
  "Ready. Your one-time setup key (DISPATCH_SETUP_KEY) is in .env.local. Run npm run dev.",
);
