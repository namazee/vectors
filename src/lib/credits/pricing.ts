import { CREDITS } from "@/config/plans";

/** Pure pricing helpers shared by server, UI and tests. */

export interface PricedModel {
  input_price_per_m: number | string;
  output_price_per_m: number | string;
  margin_override?: number | string | null;
  tier?: "unmetered" | "frontier";
}

export interface CreditSettings {
  creditRateUsd: number;
  marginMultiplier: number;
  minChargePerRequest: number;
}

export const DEFAULT_CREDIT_SETTINGS: CreditSettings = {
  creditRateUsd: CREDITS.creditRateUsd,
  marginMultiplier: CREDITS.marginMultiplier,
  minChargePerRequest: CREDITS.minChargePerRequest,
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function marginFor(model: PricedModel, s: CreditSettings = DEFAULT_CREDIT_SETTINGS): number {
  const o = model.margin_override == null ? null : Number(model.margin_override);
  return o && o > 0 ? o : s.marginMultiplier;
}

/** USD cost for a token count at list price. */
export function tokenCostUsd(model: PricedModel, inputTokens: number, outputTokens: number): number {
  return (inputTokens * Number(model.input_price_per_m) + outputTokens * Number(model.output_price_per_m)) / 1_000_000;
}

/** Credits charged for a real USD cost: cost / creditRate × margin (min charge applies when cost > 0). */
export function creditsForCost(costUsd: number, model: PricedModel, s: CreditSettings = DEFAULT_CREDIT_SETTINGS): number {
  if (model.tier === "unmetered") return 0;
  if (!(costUsd > 0)) return 0;
  const raw = (costUsd / s.creditRateUsd) * marginFor(model, s);
  return round4(Math.max(raw, s.minChargePerRequest));
}

/** Seed estimate for "~X credits/request" before real data exists. */
export function seedCreditsPerRequest(
  model: PricedModel,
  s: CreditSettings = DEFAULT_CREDIT_SETTINGS,
  tokens = CREDITS.seedEstimate,
): number {
  return creditsForCost(tokenCostUsd(model, tokens.inputTokens, tokens.outputTokens), model, s);
}

/** Upper bound for a request: full prompt + maxOutputTokens. Used for the pre-request hold. */
export function maxCreditsForRequest(
  model: PricedModel,
  inputTokens: number,
  maxOutputTokens: number,
  s: CreditSettings = DEFAULT_CREDIT_SETTINGS,
): number {
  return creditsForCost(tokenCostUsd(model, inputTokens, maxOutputTokens), model, s);
}

/**
 * The largest output-token budget the user can afford, capped at `cap`.
 * Returns 0 if even the prompt alone isn't affordable.
 */
export function affordableMaxTokens(
  model: PricedModel,
  inputTokens: number,
  availableCredits: number,
  cap: number,
  s: CreditSettings = DEFAULT_CREDIT_SETTINGS,
): number {
  const m = marginFor(model, s);
  const usdAvailable = (availableCredits * s.creditRateUsd) / m;
  const inputUsd = (inputTokens * Number(model.input_price_per_m)) / 1_000_000;
  const remaining = usdAvailable - inputUsd;
  if (remaining <= 0) return 0;
  const outPrice = Number(model.output_price_per_m);
  if (outPrice <= 0) return cap;
  return Math.max(0, Math.min(cap, Math.floor((remaining * 1_000_000) / outPrice)));
}

/** Rough token estimate (≈4 chars/token) for the pre-request hold. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4) + 4;
}

/** Credits per request shown in the picker: rolling average, else seed estimate. */
export function displayCreditsPerRequest(
  model: PricedModel & { avg_credits_per_request?: number | string | null; est_credits_per_request?: number | string | null; avg_sample_count?: number },
  s: CreditSettings = DEFAULT_CREDIT_SETTINGS,
): number {
  if (model.tier === "unmetered") return 0;
  if (model.avg_credits_per_request != null && (model.avg_sample_count ?? 0) >= 3) return Number(model.avg_credits_per_request);
  if (model.est_credits_per_request != null) return Number(model.est_credits_per_request);
  return seedCreditsPerRequest(model, s);
}
