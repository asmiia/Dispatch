export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackups } = await import("./lib/backup-scheduler.mjs");
    const { startMaintenance } = await import("./lib/maintenance.mjs");
    const { startAutoUpdate } = await import("./lib/updates.mjs");
    startBackups();
    startAutoUpdate();
    startMaintenance();
  }
}
