import { appendFileSync } from "node:fs";
import { log } from "./log.mjs";
let transport;
// DISPATCH_MAIL_FILE writes each email as a JSON line instead of sending it, for development and tests.
export const mailEnabled = () =>
  !!(process.env.DISPATCH_SMTP_URL || process.env.DISPATCH_MAIL_FILE);
// Returns true if the message was handed to the SMTP server. Never throws:
// callers fall back to showing the code/link in the UI.
export async function sendMail({ to, subject, text }) {
  if (!mailEnabled()) return false;
  if (process.env.DISPATCH_MAIL_FILE) {
    try {
      appendFileSync(
        process.env.DISPATCH_MAIL_FILE,
        JSON.stringify({ at: new Date().toISOString(), to, subject, text }) +
          "\n",
      );
      return true;
    } catch {
      return false;
    }
  }
  try {
    const { default: nodemailer } = await import("nodemailer");
    transport ??= nodemailer.createTransport(process.env.DISPATCH_SMTP_URL);
    await transport.sendMail({
      from: process.env.DISPATCH_MAIL_FROM || "Dispatch <no-reply@localhost>",
      to,
      subject,
      text,
    });
    return true;
  } catch (error) {
    log("error", "mail.send_failed", {
      reason: String(error.message || error).slice(0, 200),
    });
    return false;
  }
}
