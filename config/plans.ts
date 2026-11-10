/**
 * Central pricing & plan configuration.
 *
 * Every number that affects what users pay or receive lives here. Use the admin
 * calculator (/admin/calculator) to test changes, then paste the generated snippet
 * back into this file. Values are read on the server at request time; the
 * database `app_settings` table can override operational values (spend cap,
 * fair-use caps) without a redeploy.
 */

export const BRAND = {
  appName: "Vectors",
  tagline: "Every AI model. One place.",
  /** Display name of the credit currency. */
  creditName: "Sparks",
  creditNameSingular: "Spark",
  supportEmail: "support@example.com",
  company: "Vectors (placeholder company name)",
} as const;

export const CURRENCY = {
  code: "MYR",
  symbol: "RM",
  locale: "en-MY",
  /** Default USD→MYR rate used for display / calculator. Editable in the calculator. */
  usdToMyr: 4.2,
} as const;

export const TIMEZONE = "Asia/Kuala_Lumpur";

export const CREDITS = {
  /** USD value (at cost) of one credit. 0.001 → 1,000 credits = USD 1 of AI spend before margin. */
  creditRateUsd: 0.001,
  /** Multiplier applied to real OpenRouter cost. 1.5 = 50% markup. */
  marginMultiplier: 1.5,
  /** Credits are stored with 4 decimals; shown rounded to this many. */
  displayDecimals: 1,
  /** Minimum charge for any frontier request (avoids 0-credit rounding on tiny calls). */
  minChargePerRequest: 0.1,
  /** Token assumptions used to seed "~X credits/request" before real data exists. */
  seedEstimate: { inputTokens: 1500, outputTokens: 600 },
  /** Hard cap on output tokens per frontier request (also bounds the max-cost hold). */
  defaultMaxOutputTokens: 4096,
  /** Rolling average window (number of recent requests) for "~X credits/request". */
  rollingAverageWindow: 50,
  /** Pending holds older than this are released by the cleanup cron. */
  holdTtlMinutes: 10,
} as const;

export type PlanId = "free" | "pro";

export interface PlanConfig {
  id: PlanId;
  name: string;
  /** Monthly price in MYR (0 for free). */
  priceMyr: number;
  /** Credits granted every day at 00:00 Asia/Kuala_Lumpur. No rollover. */
  dailyCredits: number;
  /** Max unmetered requests per day (fair use). */
  unmeteredDailyCap: number;
  /** Number of most recent conversations kept visible (null = unlimited). */
  historyConversationLimit: number | null;
  compareMode: boolean;
  /** Max models in compare mode. */
  compareMaxModels: number;
  priorityRouting: boolean;
  /** Chat requests per minute (rate limit). */
  chatRequestsPerMinute: number;
  features: string[];
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    priceMyr: 0,
    dailyCredits: 30,
    unmeteredDailyCap: 100,
    historyConversationLimit: 50,
    compareMode: false,
    compareMaxModels: 0,
    priorityRouting: false,
    chatRequestsPerMinute: 10,
    features: [
      "All unmetered models, 0 credits",
      "Daily credit allowance for frontier models",
      "Last 50 conversations saved",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMyr: 39,
    dailyCredits: 400,
    unmeteredDailyCap: 300,
    historyConversationLimit: null,
    compareMode: true,
    compareMaxModels: 3,
    priorityRouting: true,
    chatRequestsPerMinute: 30,
    features: [
      "Large daily credit allowance",
      "Priority routing (faster providers)",
      "Unlimited chat history",
      "Side-by-side model comparison",
    ],
  },
};

export interface TopupPack {
  id: string;
  name: string;
  priceMyr: number;
  credits: number;
}

/** One-off packs. Purchased credits never expire and are used after the daily allowance. */
export const TOPUP_PACKS: TopupPack[] = [
  { id: "pack_small", name: "Starter pack", priceMyr: 10, credits: 1500 },
  { id: "pack_large", name: "Value pack", priceMyr: 30, credits: 5000 },
];

export const UNMETERED = {
  /** OpenRouter account-wide limits for ":free" endpoints. */
  freeEndpointPerMinute: 20,
  /** 1,000/day once the account has bought ≥ USD 10 credits (50/day otherwise). */
  freeEndpointPerDay: 1000,
  /** Route to paid fallbacks once usage reaches this share of either limit. */
  freeEndpointSafetyRatio: 0.9,
  /** Free-plan users move to paid fallbacks earlier, leaving headroom for Pro. */
  freeUserSafetyRatio: 0.7,
} as const;

export const SPEND_CAP = {
  /** Hard global monthly cap on paid OpenRouter spend (USD). */
  monthlyUsd: 200,
  alertAtRatio: 0.8,
  /** After the cap, unmetered paid fallbacks may continue until cap × this; then free endpoints only. */
  unmeteredHeadroomRatio: 1.1,
} as const;

export const PAYMENT_FEES = {
  /** Stripe Malaysia domestic card defaults; editable in the calculator. */
  percent: 3,
  fixedMyr: 1,
} as const;

export const FIXED_COSTS_MYR = {
  hosting: 85,
  supabase: 110,
  redis: 0,
  domain: 5,
  other: 0,
} as const;

export function getPlan(id: string | null | undefined): PlanConfig {
  return id === "pro" ? PLANS.pro : PLANS.free;
}

export function getTopupPack(id: string): TopupPack | undefined {
  return TOPUP_PACKS.find((p) => p.id === id);
}
