export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackups } = await import("./lib/backup-scheduler.mjs");
    startBackups();
  }
}
