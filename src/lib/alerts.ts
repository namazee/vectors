import "server-only";
import { Resend } from "resend";
import { BRAND } from "@/config/plans";

/** Email the admin. Falls back to a console log when Resend isn't configured. */
export async function sendAdminAlert(subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_ALERT_EMAIL;
  const from = process.env.ALERT_EMAIL_FROM || `${BRAND.appName} <alerts@resend.dev>`;
  const fullSubject = `[${BRAND.appName}] ${subject}`;
  if (!key || !to) {
    console.warn(`[alert] ${fullSubject}\n${text}\n(Set RESEND_API_KEY and ADMIN_ALERT_EMAIL to receive these by email.)`);
    return;
  }
  try {
    const { error } = await new Resend(key).emails.send({ from, to: to.split(",").map((s) => s.trim()), subject: fullSubject, text });
    if (error) console.error("[alert] email failed", error);
  } catch (e) {
    console.error("[alert] email failed", e);
  }
}
