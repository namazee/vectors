import "server-only";
import { SPEND_CAP, UNMETERED } from "@/config/plans";
import { getStore } from "@/lib/redis";
import { klDate, secondsUntilKlMidnight, utcMonth } from "@/lib/time";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAdminAlert } from "@/lib/alerts";
import type { RuntimeSettings } from "@/lib/settings";

// ---------------------------------------------------------------------------
// OpenRouter ":free" endpoint capacity (account-wide limits)
// ---------------------------------------------------------------------------
const FE_MINUTE_KEY = "fe:minute";
const feDayKey = (at = new Date()) => `fe:day:${at.toISOString().slice(0, 10)}`; // OpenRouter resets daily (UTC)
const secondsUntilUtcMidnight = (at = new Date()) => {
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - at.getTime()) / 1000));
};

export interface FreeEndpointUsage {
  minute: number;
  day: number;
  perMinute: number;
  perDay: number;
}

export async function getFreeEndpointUsage(settings: RuntimeSettings): Promise<FreeEndpointUsage> {
  const store = getStore();
  const [minute, day] = await Promise.all([store.windowCount(FE_MINUTE_KEY, 60_000), store.get(feDayKey())]);
  return { minute, day, perMinute: settings.freeEndpointPerMinute, perDay: settings.freeEndpointPerDay };
}

/** Whether a request may use a ":free" endpoint right now. Free-plan users stop earlier (Pro priority). */
export async function canUseFreeEndpoint(openrouterId: string, isPro: boolean, settings: RuntimeSettings) {
  const store = getStore();
  if ((await store.get(`fe:cooldown:${openrouterId}`)) > 0) return { ok: false, reason: "cooling down after a rate limit" };
  const u = await getFreeEndpointUsage(settings);
  const ratio = isPro ? UNMETERED.freeEndpointSafetyRatio : UNMETERED.freeUserSafetyRatio;
  if (u.minute >= Math.floor(u.perMinute * ratio)) return { ok: false, reason: "per-minute free capacity reached" };
  if (u.day >= Math.floor(u.perDay * ratio)) return { ok: false, reason: "daily free capacity reached" };
  return { ok: true as const, reason: null };
}

export async function recordFreeEndpointUse() {
  const store = getStore();
  await Promise.all([store.windowAdd(FE_MINUTE_KEY, 60_000), store.incr(feDayKey(), secondsUntilUtcMidnight())]);
}

/** After a 429 from a free endpoint, avoid it for a minute. */
export async function coolDownFreeEndpoint(openrouterId: string, seconds = 60) {
  await getStore().incr(`fe:cooldown:${openrouterId}`, seconds);
}

// ---------------------------------------------------------------------------
// Per-user unmetered fair use
// ---------------------------------------------------------------------------
const fairUseKey = (userId: string) => `um:${userId}:${klDate()}`;

export async function getUnmeteredUsedToday(userId: string) {
  return getStore().get(fairUseKey(userId));
}

export async function incrementUnmeteredUse(userId: string) {
  return getStore().incr(fairUseKey(userId), secondsUntilKlMidnight());
}

// ---------------------------------------------------------------------------
// Global monthly spend cap (paid OpenRouter spend, USD)
// ---------------------------------------------------------------------------
const spendKey = () => `spend:${utcMonth()}`;
const SPEND_CACHE_SECONDS = 300;

export async function getMonthlySpend(): Promise<number> {
  const store = getStore();
  const cached = await store.getFloat(spendKey());
  if (cached != null) return cached;
  let spent = 0;
  try {
    const { data, error } = await createAdminClient().rpc("monthly_paid_spend");
    if (error) throw error;
    spent = Number(data ?? 0);
  } catch (e) {
    console.error("[spend] failed to load monthly spend", e);
  }
  await store.setFloat(spendKey(), spent, SPEND_CACHE_SECONDS);
  return spent;
}

export interface SpendState {
  spent: number;
  cap: number;
  ratio: number;
  frontierPaused: boolean;
  unmeteredPaidAllowed: boolean;
}

export function computeSpendState(spent: number, settings: Pick<RuntimeSettings, "spendCapUsd" | "frontierManuallyPaused">): SpendState {
  const cap = settings.spendCapUsd;
  const ratio = cap > 0 ? spent / cap : 1;
  return {
    spent,
    cap,
    ratio,
    frontierPaused: settings.frontierManuallyPaused || ratio >= 1,
    unmeteredPaidAllowed: ratio < SPEND_CAP.unmeteredHeadroomRatio,
  };
}

export async function getSpendState(settings: RuntimeSettings): Promise<SpendState> {
  return computeSpendState(await getMonthlySpend(), settings);
}

/** Record paid spend and fire the 80% / 100% alerts once per month. */
export async function recordPaidSpend(usd: number, settings: RuntimeSettings) {
  if (!(usd > 0)) return;
  const store = getStore();
  await getMonthlySpend(); // make sure the key is seeded from the DB
  const spent = await store.addFloat(spendKey(), usd, SPEND_CACHE_SECONDS);
  const cap = settings.spendCapUsd;
  if (cap <= 0) return;
  const month = utcMonth();
  if (spent >= cap && (await store.setNx(`spend-alert:${month}:100`, 40 * 86400))) {
    await sendAdminAlert(
      `Spending cap reached: frontier models paused`,
      `Paid OpenRouter spend this month is $${spent.toFixed(2)}, which has reached the cap of $${cap.toFixed(2)}.\n\nFrontier models are now disabled for all users. Unmetered models keep running. Raise the cap in Admin → Finance to re-enable.`,
    );
  } else if (spent >= cap * SPEND_CAP.alertAtRatio && (await store.setNx(`spend-alert:${month}:80`, 40 * 86400))) {
    await sendAdminAlert(
      `Spending at ${Math.round((spent / cap) * 100)}% of monthly cap`,
      `Paid OpenRouter spend this month is $${spent.toFixed(2)} of the $${cap.toFixed(2)} cap.\n\nAt 100%, frontier models will be paused automatically.`,
    );
  }
}
