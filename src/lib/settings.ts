import "server-only";
import { PLANS, SPEND_CAP, UNMETERED } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Operational settings: defaults from /config/plans.ts, overridable at runtime
 * via the `app_settings` table (edited from the admin area).
 */
export interface RuntimeSettings {
  spendCapUsd: number;
  unmeteredCapFree: number;
  unmeteredCapPro: number;
  freeEndpointPerMinute: number;
  freeEndpointPerDay: number;
  /** Admin kill-switch for frontier models. */
  frontierManuallyPaused: boolean;
}

export const DEFAULT_SETTINGS: RuntimeSettings = {
  spendCapUsd: SPEND_CAP.monthlyUsd,
  unmeteredCapFree: PLANS.free.unmeteredDailyCap,
  unmeteredCapPro: PLANS.pro.unmeteredDailyCap,
  freeEndpointPerMinute: UNMETERED.freeEndpointPerMinute,
  freeEndpointPerDay: UNMETERED.freeEndpointPerDay,
  frontierManuallyPaused: false,
};

const KEYS: Record<string, keyof RuntimeSettings> = {
  spend_cap_usd: "spendCapUsd",
  unmetered_cap_free: "unmeteredCapFree",
  unmetered_cap_pro: "unmeteredCapPro",
  free_endpoint_per_minute: "freeEndpointPerMinute",
  free_endpoint_per_day: "freeEndpointPerDay",
  frontier_paused: "frontierManuallyPaused",
};
export const SETTING_DB_KEYS = KEYS;

let cache: { at: number; value: RuntimeSettings } | null = null;

export async function getSettings(): Promise<RuntimeSettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = { ...DEFAULT_SETTINGS };
  try {
    const { data } = await createAdminClient().from("app_settings").select("key, value");
    for (const row of data ?? []) {
      const k = KEYS[row.key as string];
      if (k) (value as Record<string, unknown>)[k] = row.value;
    }
  } catch (e) {
    console.error("[settings] load failed, using defaults", e);
  }
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateSettings() {
  cache = null;
}
