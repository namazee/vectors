import type { Metadata } from "next";
import { BRAND, getPlan } from "@/config/plans";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllModels } from "@/lib/models/catalog";
import { getWallet } from "@/lib/credits/ledger";
import { formatCredits } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UsageChart } from "@/components/usage/usage-chart";

export const metadata: Metadata = { title: "Usage" };
export const dynamic = "force-dynamic";

const MAX_SERIES = 7;

export default async function UsagePage() {
  const { userId, profile } = await requireUser();
  const db = createAdminClient();
  const [daily, logs, ledger, models, wallet] = await Promise.all([
    db.rpc("user_usage_daily", { p_user: userId, p_days: 30 }),
    db
      .from("usage_logs")
      .select("id, created_at, model_slug, served_model, tier, endpoint, input_tokens, output_tokens, credits_charged, credits_refunded, status, fallback_reason")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("credit_transactions").select("id, created_at, kind, bucket, amount, note").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    getAllModels(),
    getWallet(userId, profile.plan),
  ]);
  const names = Object.fromEntries(models.map((m) => [m.slug, m.display_name]));
  const rows = (daily.data ?? []) as { day: string; model_slug: string; requests: number; credits: number }[];

  // Top models by credits get their own series (fixed order); the rest fold into "Other".
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.model_slug, (totals.get(r.model_slug) ?? 0) + Number(r.credits));
  const top = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const series = top.slice(0, MAX_SERIES);
  const hasOther = top.length > MAX_SERIES;
  const days: Record<string, Record<string, number | string>> = {};
  for (let d = 29; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    days[day] = { day };
  }
  for (const r of rows) {
    const key = series.includes(r.model_slug) ? names[r.model_slug] ?? r.model_slug : "Other";
    const bucket = (days[r.day] ??= { day: r.day });
    bucket[key] = Number(bucket[key] ?? 0) + Number(r.credits);
  }
  const chartData = Object.values(days).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const seriesNames = [...series.map((s) => names[s] ?? s), ...(hasOther ? ["Other"] : [])];
  const total30 = [...totals.values()].reduce((a, b) => a + b, 0);
  const requests30 = rows.reduce((a, r) => a + Number(r.requests), 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">Today&apos;s allowance left</div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatCredits(wallet.daily)} <span className="text-sm font-normal text-muted-foreground">/ {formatCredits(getPlan(profile.plan).dailyCredits)}</span>
            </div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">Top-up balance</div>
            <div className="text-2xl font-semibold tabular-nums">{formatCredits(wallet.topup)}</div>
          </div>
          <div className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">Last 30 days</div>
            <div className="text-2xl font-semibold tabular-nums">{formatCredits(total30)}</div>
            <div className="text-xs text-muted-foreground">{BRAND.creditName} across {requests30} requests</div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{BRAND.creditName} spent per day</CardTitle>
            <CardDescription>By model, last 30 days (Malaysia time). Unmetered models cost 0 and aren&apos;t shown.</CardDescription>
          </CardHeader>
          <CardContent>
            <UsageChart data={chartData} series={seriesNames} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Request history</CardTitle>
            <CardDescription>Your 50 most recent requests</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Tokens in / out</TableHead>
                  <TableHead className="text-right">{BRAND.creditName}</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs.data ?? []).map((l) => {
                  const net = Number(l.credits_charged) - Number(l.credits_refunded);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(l.created_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short", timeStyle: "short" })}
                      </TableCell>
                      <TableCell>
                        {names[l.model_slug] ?? l.model_slug}
                        {l.fallback_reason && <span className="block text-xs text-muted-foreground">via fallback</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(l.input_tokens).toLocaleString()} / {Number(l.output_tokens).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.tier === "unmetered" ? "0" : formatCredits(net, 2)}</TableCell>
                      <TableCell>
                        <Badge variant={l.status === "settled" ? "secondary" : l.status === "pending" ? "outline" : "warning"}>
                          {l.status === "released" ? "not charged" : l.status === "settled" && Number(l.credits_refunded) > 0 ? "refunded" : l.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!logs.data?.length && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No requests yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credit ledger</CardTitle>
            <CardDescription>Every grant, charge, top-up and refund on your account</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ledger.data ?? []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(t.created_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short", timeStyle: "short" })}
                    </TableCell>
                    <TableCell>
                      {t.kind.replace("_", " ")}
                      {t.note && <span className="block text-xs text-muted-foreground">{t.note}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.bucket === "daily" ? "daily allowance" : "top-up"}</TableCell>
                    <TableCell className={`text-right tabular-nums ${Number(t.amount) < 0 ? "" : "text-success"}`}>
                      {Number(t.amount) > 0 ? "+" : ""}
                      {formatCredits(t.amount, 2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
