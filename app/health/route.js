import { store } from "../../lib/store.mjs";
import pkg from "../../package.json" with { type: "json" };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const started = Date.now();
// Unauthenticated liveness/readiness probe. Exposes no data beyond status.
export async function GET() {
  try {
    store().db.prepare("SELECT 1").get();
    return Response.json(
      {
        status: "ok",
        version: pkg.version,
        uptime_seconds: Math.round((Date.now() - started) / 1000),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
