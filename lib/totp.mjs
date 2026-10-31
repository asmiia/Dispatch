import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32 = (bytes) => {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
};
export const unbase32 = (text) => {
  let bits = 0,
    value = 0;
  const out = [];
  for (const ch of text.replace(/=+$/, "").toUpperCase()) {
    const i = alphabet.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};
export const newSecret = () => base32(randomBytes(20));
export function code(secret, step, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", unbase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(n % 10 ** digits).padStart(digits, "0");
}
// Returns the matching time step (so callers can reject replays), or null.
export function verify(secret, input, time = Date.now(), window = 1) {
  const given = String(input || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const now = Math.floor(time / 30000);
  for (let d = -window; d <= window; d++) {
    const expected = code(secret, now + d);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given)))
      return now + d;
  }
  return null;
}
export const otpauth = (secret, account, issuer = "Dispatch") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
