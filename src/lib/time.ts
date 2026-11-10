import { TIMEZONE } from "@/config/plans";

/** YYYY-MM-DD for the given instant in Asia/Kuala_Lumpur. */
export function klDate(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The instant of the next 00:00 in Kuala Lumpur (UTC+8, no DST). */
export function nextKlMidnight(at: Date = new Date()): Date {
  const [y, m, d] = klDate(at).split("-").map(Number);
  // KL midnight of day d+1 = 16:00 UTC on day d.
  return new Date(Date.UTC(y, m - 1, d + 1, -8, 0, 0));
}

/** Seconds until the next KL midnight (used for Redis key TTLs). */
export function secondsUntilKlMidnight(at: Date = new Date()): number {
  return Math.max(1, Math.ceil((nextKlMidnight(at).getTime() - at.getTime()) / 1000));
}

/** YYYY-MM for the current UTC month (spend-cap period). */
export function utcMonth(at: Date = new Date()): string {
  return at.toISOString().slice(0, 7);
}
