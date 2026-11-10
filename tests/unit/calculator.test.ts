import { describe, expect, it } from "vitest";
import {
  calculate,
  costPerCreditUsd,
  creditsPerRequest,
  DAYS_PER_MONTH,
  plansSnippet,
  profitCurve,
  toCsv,
  toCsvRows,
  unmeteredCostPerUserUsd,
  type CalcInputs,
} from "@/lib/calculator/formulas";
import { CREDITS, CURRENCY, PLANS, TOPUP_PACKS } from "@/config/plans";

function base(overrides: Partial<CalcInputs> = {}): CalcInputs {
  return {
    usdToMyr: 4,
    creditRateUsd: 0.001,
    marginMultiplier: 2,
    minChargePerRequest: 0.1,
    proPriceMyr: 40,
    proDailyCredits: 100,
    freeDailyCredits: 10,
    freeUsers: 100,
    proUsers: 10,
    utilFree: 0.5,
    utilPro: 0.5,
    worstCase: false,
    models: [
      { slug: "a", name: "A", weight: 1, avgCostUsdPerRequest: 0.01 },
      { slug: "b", name: "B", weight: 1, avgCostUsdPerRequest: 0.02 },
    ],
    stressModel: null,
    unmeteredRequestsPerUserPerDay: 0,
    unmeteredPaidShare: 0,
    unmeteredCostPerFallbackUsd: 0,
    feePercent: 0,
    feeFixedMyr: 0,
    fixedCostsMyr: { hosting: 0, supabase: 0, redis: 0, domain: 0, other: 0 },
    topupPacksPerMonth: 0,
    topupPackPriceMyr: 10,
    topupPackCredits: 1000,
    ...overrides,
  };
}

describe("calculator formulas", () => {
  it("cost per consumed credit is rate / margin", () => {
    expect(costPerCreditUsd(base())).toBeCloseTo(0.0005, 10);
  });

  it("per-model margin overrides change the blended cost per credit", () => {
    const i = base({ models: [
      { slug: "a", name: "A", weight: 1, avgCostUsdPerRequest: 0.01, marginOverride: 1 },
      { slug: "b", name: "B", weight: 1, avgCostUsdPerRequest: 0.01 },
    ] });
    // (0.001/1 + 0.001/2) / 2
    expect(costPerCreditUsd(i)).toBeCloseTo(0.00075, 10);
    expect(costPerCreditUsd({ ...i, stressModel: "a" })).toBeCloseTo(0.001, 10);
  });

  it("credits per request = cost / rate × margin, with a minimum charge", () => {
    const i = base();
    expect(creditsPerRequest(i.models[0], i)).toBeCloseTo(20, 6);
    expect(creditsPerRequest({ slug: "x", name: "x", weight: 1, avgCostUsdPerRequest: 0.00001 }, i)).toBe(0.1);
  });

  it("revenue, AI cost and profit add up", () => {
    const r = calculate(base());
    // Pro: 100 credits × 0.5 × 30.4 × 0.0005 USD × 4 = 3.04 MYR/user
    expect(r.perPro.aiCost).toBeCloseTo(100 * 0.5 * DAYS_PER_MONTH * 0.0005 * 4, 6);
    expect(r.revenue.subscriptions).toBe(400);
    expect(r.aiCost.proFrontier).toBeCloseTo(10 * 3.04, 6);
    expect(r.aiCost.freeFrontier).toBeCloseTo(100 * 10 * 0.5 * 30.4 * 0.0005 * 4, 6);
    expect(r.netProfit).toBeCloseTo(r.revenue.net - r.aiCost.total - r.fixedCosts, 6);
    expect(r.marginPct).toBeCloseTo(r.netProfit / r.revenue.net, 6);
  });

  it("payment fees apply per transaction and as a percentage", () => {
    const r = calculate(base({ feePercent: 3, feeFixedMyr: 1, topupPacksPerMonth: 5 }));
    expect(r.revenue.gross).toBe(400 + 50);
    expect(r.revenue.fees).toBeCloseTo(450 * 0.03 + 15 * 1, 6);
    expect(r.perPro.revenue).toBeCloseTo(40 * 0.97 - 1, 6);
  });

  it("worst case uses 100% utilisation", () => {
    const r = calculate(base({ worstCase: true }));
    expect(r.effectiveUtilPro).toBe(1);
    expect(r.perPro.aiCost).toBeCloseTo(r.perPro.aiCostAt100, 6);
  });

  it("break-even price makes per-user profit zero", () => {
    const i = base({ feePercent: 3, feeFixedMyr: 1 });
    const r = calculate(i);
    const atBreakEven = calculate({ ...i, proPriceMyr: r.breakEven.minProPrice });
    expect(atBreakEven.perPro.profit).toBeCloseTo(0, 6);
  });

  it("max safe allowance makes per-user profit zero at that utilisation", () => {
    const i = base({ feePercent: 3, feeFixedMyr: 1 });
    const r = calculate(i);
    const at = calculate({ ...i, proDailyCredits: r.breakEven.maxSafeProAllowanceAt100, worstCase: true });
    expect(at.perPro.profit).toBeCloseTo(0, 6);
  });

  it("pro users needed covers fixed + free-user costs", () => {
    const i = base({ fixedCostsMyr: { hosting: 100, supabase: 0, redis: 0, domain: 0, other: 0 } });
    const r = calculate(i);
    const needed = r.breakEven.proUsersNeeded!;
    expect(calculate({ ...i, proUsers: needed }).netProfit).toBeGreaterThanOrEqual(-1e-9);
    expect(calculate({ ...i, proUsers: needed - 1 }).netProfit).toBeLessThan(0);
  });

  it("returns null pro users needed when each Pro user loses money", () => {
    const r = calculate(base({ proPriceMyr: 1, fixedCostsMyr: { hosting: 100, supabase: 0, redis: 0, domain: 0, other: 0 } }));
    expect(r.breakEven.proUsersNeeded).toBeNull();
  });

  it("unmetered fallback cost = q × f × cf × D", () => {
    expect(unmeteredCostPerUserUsd({ unmeteredRequestsPerUserPerDay: 10, unmeteredPaidShare: 0.5, unmeteredCostPerFallbackUsd: 0.001 })).toBeCloseTo(
      10 * 0.5 * 0.001 * DAYS_PER_MONTH,
      10,
    );
  });

  it("warns when worst case loses money and when a model is priced below cost", () => {
    const r = calculate(base({ proPriceMyr: 20, models: [{ slug: "a", name: "A", weight: 1, avgCostUsdPerRequest: 0.01, marginOverride: 0.8 }] }));
    expect(r.warnings.some((w) => w.includes("100% utilisation"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("below its real cost"))).toBe(true);
    expect(r.models[0].belowCost).toBe(true);
  });

  it("requests per day translation", () => {
    const r = calculate(base());
    expect(r.models[0].requestsPerDayPro).toBe(5); // 100 / 20
    expect(r.models[1].requestsPerDayPro).toBe(2); // 100 / 40
  });

  it("profit grows with Pro users when each Pro user is profitable", () => {
    const curve = profitCurve(base({ proPriceMyr: 60 }));
    expect(curve[curve.length - 1].profit).toBeGreaterThan(curve[0].profit);
  });

  it("exports CSV and a plans.ts snippet", () => {
    const i = base();
    const csv = toCsv(toCsvRows(i, calculate(i)));
    expect(csv.split("\n")[0]).toBe("section,value");
    expect(csv).toContain("output.net_profit_myr");
    const snippet = plansSnippet(i, { CURRENCY, CREDITS, PLANS, TOPUP_PACKS });
    expect(snippet).toContain("priceMyr: 40");
    expect(snippet).toContain("creditRateUsd: 0.001");
    expect(snippet).toContain("export const PLANS");
  });
});
