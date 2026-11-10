import { CREDITS, CURRENCY, PAYMENT_FEES, FIXED_COSTS_MYR, PLANS } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { getFreeEndpointUsage, getSpendState } from "@/lib/capacity";
import { getAllModels } from "@/lib/models/catalog";
import { formatCredits, formatMyr, formatPct, formatUsd } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Meter, Stat } from "@/components/admin/stat";
import { DailySpendChart } from "@/components/admin/finance-charts";
import { SettingsForm } from "@/components/admin/settings-form";

export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v ?? 0);

export default async function FinancePage() {
  const db = createAdminClient();
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const to = new Date(now.getTime() + 60_000).toISOString();
  const settings = await getSettings();
  const fx = CURRENCY.usdToMyr;

  const [spend, freeUsage, models, byModel, byPlan, topUsers, daily, payments, proCount] = await Promise.all([
    getSpendState(settings),
    getFreeEndpointUsage(settings),
    getAllModels(),
    db.rpc("admin_usage_by_model", { p_from: from, p_to: to }),
    db.rpc("admin_usage_by_plan", { p_from: from, p_to: to }),
    db.rpc("admin_top_users", { p_from: from, p_to: to, p_limit: 20 }),
    db.rpc("admin_daily_spend", { p_days: 30 }),
    db.from("payments").select("kind, plan, amount_myr, status").gte("created_at", from),
    db.from("profiles").select("id", { count: "exact", head: true }).eq("plan", "pro"),
  ]);

  const names = Object.fromEntries(models.map((m) => [m.slug, m.display_name]));
  const paid = (payments.data ?? []).filter((p) => p.status === "paid");
  const revenueSubs = paid.filter((p) => p.kind === "subscription").reduce((s, p) => s + num(p.amount_myr), 0);
  const revenueTopups = paid.filter((p) => p.kind === "topup").reduce((s, p) => s + num(p.amount_myr), 0);
  const gross = revenueSubs + revenueTopups;
  const fees = gross * (PAYMENT_FEES.percent / 100) + paid.length * PAYMENT_FEES.fixedMyr;
  const aiCostUsd = (byModel.data ?? []).reduce((s: number, r: { cost_usd: number }) => s + num(r.cost_usd), 0);
  const aiCostMyr = aiCostUsd * fx;
  const fixed = Object.values(FIXED_COSTS_MYR).reduce<number>((a, b) => a + b, 0);
  const net = gross - fees - aiCostMyr - fixed;

  const revenueByPlan: Record<string, number> = { free: 0, pro: 0 };
  for (const p of paid) revenueByPlan[(p.plan as string) ?? "free"] = (revenueByPlan[(p.plan as string) ?? "free"] ?? 0) + num(p.amount_myr);

  const dailyData = (daily.data ?? []).map((d: { day: string; frontier_cost_usd: number; unmetered_cost_usd: number }) => ({
    day: d.day,
    frontier: num(d.frontier_cost_usd),
    unmetered: num(d.unmetered_cost_usd),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">
          This month (UTC) · AI cost from logged OpenRouter usage · revenue from Stripe webhooks · USD→MYR {fx}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue (gross)" value={formatMyr(gross)} sub={`Subs ${formatMyr(revenueSubs)} · Top-ups ${formatMyr(revenueTopups)}`} />
        <Stat label="OpenRouter spend" value={formatUsd(aiCostUsd)} sub={`≈ ${formatMyr(aiCostMyr)}`} />
        <Stat label="Net (after fees & fixed)" value={formatMyr(net)} tone={net >= 0 ? "good" : "bad"} sub={`Fees ≈ ${formatMyr(fees)} · fixed ${formatMyr(fixed)}`} />
        <Stat label="Pro subscribers" value={proCount.count ?? 0} sub={`Est. MRR ${formatMyr((proCount.count ?? 0) * PLANS.pro.priceMyr)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Daily OpenRouter spend</CardTitle>
            <CardDescription>Last 30 days, Malaysia time, USD</CardDescription>
          </CardHeader>
          <CardContent>
            <DailySpendChart data={dailyData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Capacity & caps</CardTitle>
            <CardDescription>Live</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Meter ratio={spend.ratio} label={`Monthly spend cap: ${formatUsd(spend.spent)} of ${formatUsd(spend.cap)}`} />
              {spend.frontierPaused ? (
                <Badge variant="destructive">Frontier paused</Badge>
              ) : spend.ratio >= 0.8 ? (
                <Badge variant="warning">Above 80%: alert sent</Badge>
              ) : (
                <Badge variant="success">Frontier live</Badge>
              )}
            </div>
            <Meter ratio={freeUsage.perDay ? freeUsage.day / freeUsage.perDay : 0} label={`Free endpoints today: ${freeUsage.day} / ${freeUsage.perDay}`} />
            <Meter ratio={freeUsage.perMinute ? freeUsage.minute / freeUsage.perMinute : 0} label={`Free endpoints this minute: ${freeUsage.minute} / ${freeUsage.perMinute}`} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Margin per model</CardTitle>
            <CardDescription>Credits charged (at {formatUsd(CREDITS.creditRateUsd, 4)}/credit) vs real cost</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Req.</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(byModel.data ?? []).map((r: { model_slug: string; tier: string; requests: number; cost_usd: number; credits_charged: number; fallback_requests: number }) => {
                  const billed = num(r.credits_charged) * CREDITS.creditRateUsd;
                  const cost = num(r.cost_usd);
                  const margin = r.tier === "frontier" && billed > 0 ? (billed - cost) / billed : null;
                  return (
                    <TableRow key={r.model_slug}>
                      <TableCell>
                        {names[r.model_slug] ?? r.model_slug}{" "}
                        <span className="text-xs text-muted-foreground">{r.tier === "unmetered" ? `· unmetered · ${r.fallback_requests} fallbacks` : ""}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.requests}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(cost, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCredits(r.credits_charged)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${margin != null && margin < 0 ? "text-destructive" : ""}`}>
                        {margin == null ? (r.tier === "unmetered" ? `−${formatUsd(cost, 4)}` : "—") : formatPct(margin)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!byModel.data?.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">No usage yet this month.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Margin per plan</CardTitle>
            <CardDescription>Stripe revenue vs AI cost of users on each plan (MYR)</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">AI cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["free", "pro"] as const).map((plan) => {
                  const row = (byPlan.data ?? []).find((r: { plan: string }) => r.plan === plan) as { users: number; cost_usd: number } | undefined;
                  const rev = revenueByPlan[plan] ?? 0;
                  const cost = num(row?.cost_usd) * fx;
                  return (
                    <TableRow key={plan}>
                      <TableCell className="capitalize">{plan}</TableCell>
                      <TableCell className="text-right tabular-nums">{row?.users ?? 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMyr(rev)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMyr(cost)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${rev - cost < -0.005 ? "text-destructive" : ""}`}>
                        {rev > 0 ? formatPct((rev - cost) / rev) : formatMyr(Math.abs(rev - cost) < 0.005 ? 0 : rev - cost)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top 20 heaviest users</CardTitle>
          <CardDescription>By real OpenRouter cost this month</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(topUsers.data ?? []).map((u: { user_id: string; email: string; plan: string; requests: number; credits_charged: number; cost_usd: number }) => (
                <TableRow key={u.user_id}>
                  <TableCell className="max-w-56 truncate">{u.email}</TableCell>
                  <TableCell className="capitalize">{u.plan}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.requests}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCredits(u.credits_charged)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(num(u.cost_usd), 4)}</TableCell>
                </TableRow>
              ))}
              {!topUsers.data?.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">No usage yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Operational settings</CardTitle>
          <CardDescription>
            Overrides for /config/plans.ts defaults. At 80% of the cap the admin gets an email; at 100% frontier models pause
            automatically and unmetered models keep running.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
