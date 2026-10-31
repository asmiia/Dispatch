import { resolve } from "node:path";
import {
  createBackup,
  listBackups,
  verifyBackup,
  restoreBackup,
  backupRoot,
} from "../lib/backup.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {}
const dataDir = resolve(process.env.DISPATCH_DATA_DIR || ".local"),
  root = backupRoot(dataDir),
  [command = "help", ...rest] = process.argv.slice(2),
  flags = rest.filter((a) => a.startsWith("--")),
  arg = rest.find((a) => !a.startsWith("--")) || "latest";
const pick = async () => {
  const stamp = arg === "latest" ? (await listBackups(root))[0]?.stamp : arg;
  if (!stamp) throw new Error("No backups found in " + root);
  return stamp;
};
const mb = (n) => (n / 1048576).toFixed(1) + " MiB";
try {
  if (command === "backup") {
    const r = await createBackup(dataDir);
    console.log(`Backup ${r.stamp} written to ${root} (database ${mb(r.db_bytes)}, ${r.files_new} new of ${r.files_total} attachments, key: ${r.key}).`);
    if (r.key === "plain")
      console.log("Warning: the encryption key is stored unencrypted. Set DISPATCH_BACKUP_PASSPHRASE to protect it.");
  } else if (command === "list") {
    const all = await listBackups(root);
    if (!all.length) console.log("No backups in " + root);
    for (const b of all) console.log(`${b.stamp}  ${b.created}  db ${mb(b.db_bytes)}  key ${b.key}`);
  } else if (command === "verify") {
    const stamp = await pick(),
      r = await verifyBackup(root, stamp);
    console.log(r.ok ? `Backup ${stamp} is intact.` : `Backup ${stamp} has problems:\n- ` + r.problems.join("\n- "));
    process.exitCode = r.ok ? 0 : 1;
  } else if (command === "restore") {
    const r = await restoreBackup(root, await pick(), dataDir, { force: flags.includes("--force") });
    console.log(`Restored backup ${r.stamp} into ${dataDir}.` + (r.aside ? ` Previous data was moved to ${r.aside}.` : ""));
    console.log("Start Dispatch again.");
  } else {
    console.log(`Usage: node scripts/backup.mjs <command>
  backup                 take a backup now (safe while Dispatch is running)
  list                   list backups
  verify [stamp|latest]  check checksums, database integrity and attachments
  restore [stamp|latest] [--force]
                         restore into DISPATCH_DATA_DIR. Stop Dispatch first.
                         --force moves existing data aside before restoring.`);
  }
} catch (error) {
  console.error("Error: " + error.message);
  process.exitCode = 1;
}
