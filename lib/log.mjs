// Structured JSON logs, one object per line. Never pass secrets as fields.
const levels = { debug: 10, info: 20, warn: 30, error: 40 };
export function log(level, msg, fields = {}) {
  const min = levels[process.env.DISPATCH_LOG_LEVEL] ?? levels.info;
  if (levels[level] < min) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  (levels[level] >= levels.warn ? process.stderr : process.stdout).write(
    line + "\n",
  );
}
