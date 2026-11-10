/**
 * Pricing & margin calculator — pure functions (no I/O), unit-tested.
 *
 * Notation (see README "Calculator formulas"):
 *   r   = USD value of 1 credit (creditRateUsd)
 *   m_j = margin multiplier for model j (global, or per-model override)
 *   w_j = share of frontier usage on model j (normalised)
 *   k   = USD AI cost per credit consumed = Σ w_j · r / m_j
 *   D   = days per month (30.4)
 *   A   = daily allowance (credits), U = utilisation (0..1)
 *   UF  = unmetered paid-fallback cost per user per month (USD) = q · f · cf · D
 */

export const DAYS_PER_MONTH = 30.4;

export interface CalcModel {
  slug: string;
  name: string;
  /** Share of frontier credit usage (any non-negative number; normalised). */
  weight: number;
  /** Average real USD cost per request on this model. */
  avgCostUsdPerRequest: number;
  marginOverride?: number | null;
}

export interface CalcInputs {
  usdToMyr: number;
  creditRateUsd: number;
  marginMultiplier: number;
  minChargePerRequest: number;
  proPriceMyr: number;
  proDailyCredits: number;
  freeDailyCredits: number;
  freeUsers: number;
  proUsers: number;
  utilFree: number; // 0..1
  utilPro: number; // 0..1
  worstCase: boolean;
  models: CalcModel[];
  /** Stress-test a single model (100% of frontier usage), or null for the mix. */
  stressModel: string | null;
  unmeteredRequestsPerUserPerDay: number;
  unmeteredPaidShare: number; // 0..1
  unmeteredCostPerFallbackUsd: number;
  feePercent: number; // e.g. 3 for 3%
  feeFixedMyr: number;
  fixedCostsMyr: { hosting: number; supabase: number; redis: number; domain: number; other: number };
  topupPacksPerMonth: number;
  topupPackPriceMyr: number;
  topupPackCredits: number;
}

export interface ModelRowResult {
  slug: string;
  name: string;
  share: number;
  margin: number;
  creditsPerRequest: number;
  requestsPerDayFree: number;
  requestsPerDayPro: number;
  belowCost: boolean;
}

export interface CalcResult {
  k: number; // USD AI cost per consumed credit
  effectiveUtilFree: number;
  effectiveUtilPro: number;
  revenue: { subscriptions: number; topups: number; gross: number; fees: number; net: number };
  aiCost: {
    proFrontier: number;
    proUnmetered: number;
    freeFrontier: number;
    freeUnmetered: number;
    topups: number;
    total: number;
  };
  fixedCosts: number;
  netProfit: number;
  marginPct: number | null;
  perPro: { revenue: number; aiCost: number; aiCostAt100: number; profit: number; profitAt100: number };
  costPerFreeUser: number;
  breakEven: {
    minProPrice: number;
    minProPriceAt100: number;
    maxSafeProAllowance: number;
    maxSafeProAllowanceAt100: number;
    proUsersNeeded: number | null; // null = impossible (each Pro user loses money)
  };
  models: ModelRowResult[];
  warnings: string[];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function effectiveWeights(models: CalcModel[], stressModel: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (stressModel && models.some((m) => m.slug === stressModel)) {
    for (const m of models) out.set(m.slug, m.slug === stressModel ? 1 : 0);
    return out;
  }
  const total = models.reduce((s, m) => s + nonNeg(m.weight), 0);
  for (const m of models) out.set(m.slug, total > 0 ? nonNeg(m.weight) / total : models.length ? 1 / models.length : 0);
  return out;
}

export function marginOf(m: CalcModel, global: number): number {
  return m.marginOverride && m.marginOverride > 0 ? m.marginOverride : global;
}

/** USD of AI cost per credit consumed, for the given mix. */
export function costPerCreditUsd(i: Pick<CalcInputs, "models" | "stressModel" | "creditRateUsd" | "marginMultiplier">): number {
  const w = effectiveWeights(i.models, i.stressModel);
  if (!i.models.length) return i.creditRateUsd / i.marginMultiplier;
  return i.models.reduce((s, m) => s + (w.get(m.slug) ?? 0) * (i.creditRateUsd / marginOf(m, i.marginMultiplier)), 0);
}

export function creditsPerRequest(m: CalcModel, i: Pick<CalcInputs, "creditRateUsd" | "marginMultiplier" | "minChargePerRequest">): number {
  if (!(m.avgCostUsdPerRequest > 0)) return 0;
  return Math.max((m.avgCostUsdPerRequest / i.creditRateUsd) * marginOf(m, i.marginMultiplier), i.minChargePerRequest);
}

/** Unmetered paid-fallback cost per user per month, USD. */
export function unmeteredCostPerUserUsd(i: Pick<CalcInputs, "unmeteredRequestsPerUserPerDay" | "unmeteredPaidShare" | "unmeteredCostPerFallbackUsd">): number {
  return nonNeg(i.unmeteredRequestsPerUserPerDay) * clamp01(i.unmeteredPaidShare) * nonNeg(i.unmeteredCostPerFallbackUsd) * DAYS_PER_MONTH;
}

/** Monthly AI cost (MYR) of one user with daily allowance A at utilisation U. */
export function userMonthlyAiCostMyr(allowance: number, util: number, k: number, unmeteredUsd: number, fx: number) {
  const frontier = allowance * clamp01(util) * DAYS_PER_MONTH * k * fx;
  const unmetered = unmeteredUsd * fx;
  return { frontier, unmetered, total: frontier + unmetered };
}

export function calculate(i: CalcInputs): CalcResult {
  const fx = nonNeg(i.usdToMyr);
  const pct = nonNeg(i.feePercent) / 100;
  const feeFixed = nonNeg(i.feeFixedMyr);
  const k = costPerCreditUsd(i);
  const uf = unmeteredCostPerUserUsd(i);
  const uPro = i.worstCase ? 1 : clamp01(i.utilPro);
  const uFree = i.worstCase ? 1 : clamp01(i.utilFree);
  const nPro = nonNeg(i.proUsers);
  const nFree = nonNeg(i.freeUsers);
  const nTop = nonNeg(i.topupPacksPerMonth);

  // Revenue
  const subscriptions = nPro * nonNeg(i.proPriceMyr);
  const topups = nTop * nonNeg(i.topupPackPriceMyr);
  const gross = subscriptions + topups;
  const fees = gross * pct + (nPro + nTop) * feeFixed;
  const net = gross - fees;

  // AI cost
  const pro = userMonthlyAiCostMyr(i.proDailyCredits, uPro, k, uf, fx);
  const pro100 = userMonthlyAiCostMyr(i.proDailyCredits, 1, k, uf, fx);
  const free = userMonthlyAiCostMyr(i.freeDailyCredits, uFree, k, uf, fx);
  // Top-up credits are assumed to be fully consumed.
  const topupAi = nTop * nonNeg(i.topupPackCredits) * k * fx;
  const aiCost = {
    proFrontier: nPro * pro.frontier,
    proUnmetered: nPro * pro.unmetered,
    freeFrontier: nFree * free.frontier,
    freeUnmetered: nFree * free.unmetered,
    topups: topupAi,
    total: nPro * pro.total + nFree * free.total + topupAi,
  };

  const fc = i.fixedCostsMyr;
  const fixedCosts = nonNeg(fc.hosting) + nonNeg(fc.supabase) + nonNeg(fc.redis) + nonNeg(fc.domain) + nonNeg(fc.other);
  const netProfit = net - aiCost.total - fixedCosts;
  const marginPct = net > 0 ? netProfit / net : null;

  // Per Pro user
  const proRevenue = nonNeg(i.proPriceMyr) * (1 - pct) - feeFixed;
  const perPro = {
    revenue: proRevenue,
    aiCost: pro.total,
    aiCostAt100: pro100.total,
    profit: proRevenue - pro.total,
    profitAt100: proRevenue - pro100.total,
  };

  // Break-even
  const denom = 1 - pct;
  const minProPrice = denom > 0 ? (pro.total + feeFixed) / denom : Infinity;
  const minProPriceAt100 = denom > 0 ? (pro100.total + feeFixed) / denom : Infinity;
  const allowanceFor = (u: number) => {
    const perCreditMonthMyr = u * DAYS_PER_MONTH * k * fx;
    if (perCreditMonthMyr <= 0) return Infinity;
    return Math.max(0, (proRevenue - uf * fx) / perCreditMonthMyr);
  };
  const topupProfit = topups * (1 - pct) - nTop * feeFixed - topupAi;
  const toCover = fixedCosts + nFree * free.total - topupProfit;
  const proUsersNeeded = toCover <= 0 ? 0 : perPro.profit > 0 ? Math.ceil(toCover / perPro.profit) : null;

  // Per-model table
  const w = effectiveWeights(i.models, i.stressModel);
  const models: ModelRowResult[] = i.models.map((m) => {
    const c = creditsPerRequest(m, i);
    const margin = marginOf(m, i.marginMultiplier);
    return {
      slug: m.slug,
      name: m.name,
      share: w.get(m.slug) ?? 0,
      margin,
      creditsPerRequest: c,
      requestsPerDayFree: c > 0 ? Math.floor(i.freeDailyCredits / c) : 0,
      requestsPerDayPro: c > 0 ? Math.floor(i.proDailyCredits / c) : 0,
      belowCost: c * i.creditRateUsd < m.avgCostUsdPerRequest - 1e-12,
    };
  });

  // Warnings
  const warnings: string[] = [];
  if (perPro.profitAt100 < 0) {
    warnings.push(
      `At 100% utilisation each Pro user loses RM ${Math.abs(perPro.profitAt100).toFixed(2)}/month. Lower the Pro allowance to ≤ ${Math.floor(allowanceFor(1))} credits/day or raise the price to ≥ RM ${minProPriceAt100.toFixed(2)}.`,
    );
  }
  if (!i.worstCase) {
    const worst = calculate({ ...i, worstCase: true });
    if (worst.netProfit < 0) warnings.push(`Worst case (100% utilisation for everyone) is a monthly loss of RM ${Math.abs(worst.netProfit).toFixed(2)}.`);
  } else if (netProfit < 0) {
    warnings.push(`Worst case (100% utilisation for everyone) is a monthly loss of RM ${Math.abs(netProfit).toFixed(2)}.`);
  }
  for (const m of models) {
    if (m.belowCost) warnings.push(`${m.name}: credit price (${m.creditsPerRequest.toFixed(2)} credits ≈ $${(m.creditsPerRequest * i.creditRateUsd).toFixed(4)}) is below its real cost per request.`);
  }
  if (netProfit < 0 && !i.worstCase) warnings.push(`The current scenario loses RM ${Math.abs(netProfit).toFixed(2)} per month.`);

  return {
    k,
    effectiveUtilFree: uFree,
    effectiveUtilPro: uPro,
    revenue: { subscriptions, topups, gross, fees, net },
    aiCost,
    fixedCosts,
    netProfit,
    marginPct,
    perPro,
    costPerFreeUser: free.total,
    breakEven: {
      minProPrice,
      minProPriceAt100,
      maxSafeProAllowance: allowanceFor(uPro),
      maxSafeProAllowanceAt100: allowanceFor(1),
      proUsersNeeded,
    },
    models,
    warnings,
  };
}

/** Net profit as a function of Pro user count (for the line chart). */
export function profitCurve(i: CalcInputs, points = 21): { proUsers: number; profit: number }[] {
  const base = calculate(i);
  const target = Math.max(10, i.proUsers * 2, (base.breakEven.proUsersNeeded ?? 0) * 1.5);
  const step = Math.max(1, Math.ceil(target / (points - 1)));
  return Array.from({ length: points }, (_, n) => {
    const proUsers = n * step;
    return { proUsers, profit: calculate({ ...i, proUsers }).netProfit };
  });
}

/** Flat key/value rows for CSV export. */
export function toCsvRows(i: CalcInputs, r: CalcResult): [string, string | number][] {
  const rows: [string, string | number][] = [
    ["section", "value"],
    ["input.usd_to_myr", i.usdToMyr],
    ["input.credit_rate_usd", i.creditRateUsd],
    ["input.margin_multiplier", i.marginMultiplier],
    ["input.pro_price_myr", i.proPriceMyr],
    ["input.pro_daily_credits", i.proDailyCredits],
    ["input.free_daily_credits", i.freeDailyCredits],
    ["input.free_users", i.freeUsers],
    ["input.pro_users", i.proUsers],
    ["input.util_free", i.utilFree],
    ["input.util_pro", i.utilPro],
    ["input.worst_case", String(i.worstCase)],
    ["input.stress_model", i.stressModel ?? "mix"],
    ["input.unmetered_requests_per_user_day", i.unmeteredRequestsPerUserPerDay],
    ["input.unmetered_paid_share", i.unmeteredPaidShare],
    ["input.unmetered_cost_per_fallback_usd", i.unmeteredCostPerFallbackUsd],
    ["input.fee_percent", i.feePercent],
    ["input.fee_fixed_myr", i.feeFixedMyr],
    ...Object.entries(i.fixedCostsMyr).map(([k, v]) => [`input.fixed_${k}_myr`, v] as [string, number]),
    ["input.topup_packs_per_month", i.topupPacksPerMonth],
    ["input.topup_pack_price_myr", i.topupPackPriceMyr],
    ["input.topup_pack_credits", i.topupPackCredits],
    ...i.models.map((m) => [`input.mix.${m.slug}`, m.weight] as [string, number]),
    ["output.revenue_subscriptions_myr", r.revenue.subscriptions],
    ["output.revenue_topups_myr", r.revenue.topups],
    ["output.payment_fees_myr", r.revenue.fees],
    ["output.revenue_net_myr", r.revenue.net],
    ["output.ai_cost_pro_frontier_myr", r.aiCost.proFrontier],
    ["output.ai_cost_pro_unmetered_myr", r.aiCost.proUnmetered],
    ["output.ai_cost_free_frontier_myr", r.aiCost.freeFrontier],
    ["output.ai_cost_free_unmetered_myr", r.aiCost.freeUnmetered],
    ["output.ai_cost_topups_myr", r.aiCost.topups],
    ["output.ai_cost_total_myr", r.aiCost.total],
    ["output.fixed_costs_myr", r.fixedCosts],
    ["output.net_profit_myr", r.netProfit],
    ["output.margin_pct", r.marginPct ?? ""],
    ["output.per_pro_revenue_myr", r.perPro.revenue],
    ["output.per_pro_ai_cost_myr", r.perPro.aiCost],
    ["output.per_pro_ai_cost_at_100_myr", r.perPro.aiCostAt100],
    ["output.per_pro_profit_myr", r.perPro.profit],
    ["output.cost_per_free_user_myr", r.costPerFreeUser],
    ["output.min_pro_price_myr", r.breakEven.minProPrice],
    ["output.max_safe_pro_allowance", r.breakEven.maxSafeProAllowance],
    ["output.max_safe_pro_allowance_at_100", r.breakEven.maxSafeProAllowanceAt100],
    ["output.pro_users_needed", r.breakEven.proUsersNeeded ?? "impossible"],
    ...r.models.map((m) => [`output.credits_per_request.${m.slug}`, Number(m.creditsPerRequest.toFixed(4))] as [string, number]),
  ];
  return rows;
}

export function toCsv(rows: [string, string | number][]): string {
  const esc = (v: string | number) => {
    const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(6)) : v;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

/** Serialises a plain object as a TypeScript object literal. */
function tsLiteral(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((v) => inner + tsLiteral(v, indent + 1)).join(",\n")},\n${pad}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{\n${entries.map(([k, v]) => `${inner}${/^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${tsLiteral(v, indent + 1)}`).join(",\n")},\n${pad}}`;
  }
  return JSON.stringify(value);
}

/**
 * Full replacement blocks for /config/plans.ts, built from the current config
 * with the calculator's values applied. Never auto-applied: copy & review.
 */
export function plansSnippet(
  i: CalcInputs,
  current: {
    CURRENCY: object;
    CREDITS: object;
    PLANS: Record<"free" | "pro", object>;
    TOPUP_PACKS: { id: string; name: string; priceMyr: number; credits: number }[];
  },
): string {
  const currency = { ...current.CURRENCY, usdToMyr: i.usdToMyr };
  const credits = { ...current.CREDITS, creditRateUsd: i.creditRateUsd, marginMultiplier: i.marginMultiplier, minChargePerRequest: i.minChargePerRequest };
  const plans = {
    free: { ...current.PLANS.free, dailyCredits: Math.round(i.freeDailyCredits) },
    pro: { ...current.PLANS.pro, priceMyr: i.proPriceMyr, dailyCredits: Math.round(i.proDailyCredits) },
  };
  const packs = current.TOPUP_PACKS.map((p, idx) =>
    idx === 0 ? { ...p, priceMyr: i.topupPackPriceMyr, credits: Math.round(i.topupPackCredits) } : p,
  );
  return [
    `// Generated by /admin/calculator on ${new Date().toISOString().slice(0, 10)}.`,
    `// Review, then replace the matching blocks in config/plans.ts and redeploy.`,
    ``,
    `export const CURRENCY = ${tsLiteral(currency)} as const;`,
    ``,
    `export const CREDITS = ${tsLiteral(credits)} as const;`,
    ``,
    `export const PLANS: Record<PlanId, PlanConfig> = ${tsLiteral(plans)};`,
    ``,
    `export const TOPUP_PACKS: TopupPack[] = ${tsLiteral(packs)};`,
    ``,
    `export const PAYMENT_FEES = ${tsLiteral({ percent: i.feePercent, fixedMyr: i.feeFixedMyr })} as const;`,
    ``,
    `export const FIXED_COSTS_MYR = ${tsLiteral(i.fixedCostsMyr)} as const;`,
    ``,
  ].join("\n");
}
