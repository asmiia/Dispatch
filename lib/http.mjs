import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { store, MailError } from "./store.mjs";
import { security } from "./security.mjs";
import { log } from "./log.mjs";
const digest = (value) => createHash("sha256").update(value).digest();
export const originFor = (request) =>
  process.env.DISPATCH_ORIGIN ||
  `${new URL(request.url).protocol}//${request.headers.get("host") || new URL(request.url).host}`;
// Origin used in emailed links and OAuth redirects. The Host header is attacker
// controlled, so it is only trusted for loopback; otherwise DISPATCH_ORIGIN is required.
export function trustedOrigin(request) {
  if (process.env.DISPATCH_ORIGIN) return process.env.DISPATCH_ORIGIN;
  const { hostname } = new URL(request.url);
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    ? originFor(request)
    : null;
}
export function validToken(value) {
  const expected = process.env.DISPATCH_SETUP_KEY;
  return (
    typeof value === "string" &&
    !!expected &&
    expected.length >= 32 &&
    timingSafeEqual(digest(value), digest(expected))
  );
}
export function checkOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== originFor(request))
    throw new MailError("Cross-origin request rejected", 403);
}
export function guard(request) {
  checkOrigin(request);
  return security().authenticate(request);
}
export async function jsonBody(request, max = 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) throw new MailError("Missing request body");
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new MailError("Request too large", 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new MailError("Invalid JSON");
  }
}
// Only trust proxy headers when the operator says a proxy is in front.
export const clientIp = (request) =>
  process.env.DISPATCH_TRUST_PROXY === "true"
    ? (
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
        request.headers.get("x-real-ip") ||
        ""
      ).slice(0, 64)
    : "";
export const secureCookie = (request) =>
  new URL(request.url).protocol === "https:" ||
  process.env.DISPATCH_COOKIE_SECURE === "true";
export function login(request, user) {
  const session = security().session(user, {
    ip: clientIp(request),
    ua: request.headers.get("user-agent"),
  });
  const secure =
    new URL(request.url).protocol === "https:" ||
    process.env.DISPATCH_COOKIE_SECURE === "true";
  return `dispatch_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure ? "; Secure" : ""}`;
}
export function logout(request) {
  const session = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)dispatch_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (session)
    store()
      .db.prepare("DELETE FROM sessions WHERE hash=?")
      .run(digest(session).toString("hex"));
}
export function errorResponse(error) {
  if (!(error instanceof MailError))
    log("error", "request.failed", {
      reason: String(error?.message || error).slice(0, 300),
    });
  return Response.json(
    { error: error instanceof MailError ? error.message : "Server error" },
    { status: error.status || 500 },
  );
}
