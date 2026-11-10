import { CREDITS, CURRENCY, FIXED_COSTS_MYR, PAYMENT_FEES, PLANS, TOPUP_PACKS } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllModels } from "@/lib/models/catalog";
import { tokenCostUsd } from "@/lib/credits/pricing";
import type { CalcInputs } from "@/lib/calculator/formulas";
import { Calculator, type ScenarioRow } from "@/components/admin/calculator";

export const dynamic = "force-dynamic";

interface UsageRow {
  model_slug: string;
  tier: "unmetered" | "frontier";
  requests: number;
  paid_requests: number;
  cost_usd: number;
  credits_charged: number;
}

export default async function CalculatorPage() {
  const db = createAdminClient();
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400_000);
  const [models, usage, byPlan, freeCount, proCount, scenarios] = await Promise.all([
    getAllModels({ activeOnly: true }),
    db.rpc("admin_usage_by_model", { p_from: from.toISOString(), p_to: to.toISOString() }),
    db.rpc("admin_usage_by_plan", { p_from: from.toISOString(), p_to: to.toISOString() }),
    db.from("profiles").select("id", { count: "exact", head: true }).eq("plan", "free"),
    db.from("profiles").select("id", { count: "exact", head: true }).eq("plan", "pro"),
    db.from("pricing_scenarios").select("id, name, inputs, outputs, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const rows = (usage.data ?? []) as UsageRow[];
  const byModel = new Map(rows.map((r) => [r.model_slug, r]));
  const seed = CREDITS.seedEstimate;

  // Frontier mix: real credit share when available, else an even split.
  const frontier = models.filter((m) => m.tier === "frontier");
  // Only trust the real mix once there is a meaningful sample (≥ 50 frontier requests in 30 days).
  const frontierRequests = frontier.reduce((s, m) => s + Number(byModel.get(m.slug)?.requests ?? 0), 0);
  const hasRealMix = frontierRequests >= 50;
  const calcModels = frontier.map((m) => {
    const u = byModel.get(m.slug);
    const realAvg = u && Number(u.requests) >= 5 ? Number(u.cost_usd) / Number(u.requests) : null;
    return {
      slug: m.slug,
      name: m.display_name,
      weight: hasRealMix ? Number(u?.credits_charged ?? 0) : 1,
      avgCostUsdPerRequest: realAvg ?? tokenCostUsd(m, seed.inputTokens, seed.outputTokens),
      marginOverride: m.margin_override == null ? null : Number(m.margin_override),
      source: realAvg != null ? "real" : "estimate",
    };
  });

  // Unmetered fallback defaults from real data when available.
  const unmeteredRows = rows.filter((r) => r.tier === "unmetered");
  const unmReq = unmeteredRows.reduce((s, r) => s + Number(r.requests), 0);
  const unmPaid = unmeteredRows.reduce((s, r) => s + Number(r.paid_requests), 0);
  const unmCost = unmeteredRows.reduce((s, r) => s + Number(r.cost_usd), 0);
  const activeUsers = ((byPlan.data ?? []) as { users: number }[]).reduce((s, r) => s + Number(r.users), 0);
  const unmetered = models.filter((m) => m.tier === "unmetered");
  const seedFallbackCost =
    unmetered.reduce((s, m) => s + tokenCostUsd(m, seed.inputTokens, seed.outputTokens), 0) / Math.max(1, unmetered.length);

  const defaults: CalcInputs = {
    usdToMyr: CURRENCY.usdToMyr,
    creditRateUsd: CREDITS.creditRateUsd,
    marginMultiplier: CREDITS.marginMultiplier,
    minChargePerRequest: CREDITS.minChargePerRequest,
    proPriceMyr: PLANS.pro.priceMyr,
    proDailyCredits: PLANS.pro.dailyCredits,
    freeDailyCredits: PLANS.free.dailyCredits,
    // Real user counts once the app has some traction; otherwise planning defaults.
    freeUsers: (freeCount.count ?? 0) >= 100 ? (freeCount.count ?? 0) : 1000,
    proUsers: (proCount.count ?? 0) >= 10 ? (proCount.count ?? 0) : 50,
    utilFree: 0.3,
    utilPro: 0.3,
    worstCase: false,
    models: calcModels.map((m) => ({ slug: m.slug, name: m.name, weight: m.weight, avgCostUsdPerRequest: m.avgCostUsdPerRequest, marginOverride: m.marginOverride })),
    stressModel: null,
    unmeteredRequestsPerUserPerDay: unmReq > 100 && activeUsers ? Number((unmReq / activeUsers / 30).toFixed(1)) : 10,
    unmeteredPaidShare: unmReq > 100 ? Number((unmPaid / unmReq).toFixed(2)) : 0.3,
    unmeteredCostPerFallbackUsd: unmPaid > 20 ? Number((unmCost / unmPaid).toFixed(6)) : Number(seedFallbackCost.toFixed(6)),
    feePercent: PAYMENT_FEES.percent,
    feeFixedMyr: PAYMENT_FEES.fixedMyr,
    fixedCostsMyr: { ...FIXED_COSTS_MYR },
    topupPacksPerMonth: 20,
    topupPackPriceMyr: TOPUP_PACKS[0]?.priceMyr ?? 10,
    topupPackCredits: TOPUP_PACKS[0]?.credits ?? 1500,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pricing & margin calculator</h1>
        <p className="text-sm text-muted-foreground">
          Defaults come from /config/plans.ts and live model prices{hasRealMix ? " with the model mix from the last 30 days of real usage" : " (even model mix: no usage data yet)"}.
          Nothing here changes production. Use &ldquo;Use these values&rdquo; to get a plans.ts snippet.
        </p>
      </div>
      <Calculator
        defaults={defaults}
        modelSources={Object.fromEntries(calcModels.map((m) => [m.slug, m.source]))}
        initialScenarios={(scenarios.data ?? []) as ScenarioRow[]}
      />
    </div>
  );
}
