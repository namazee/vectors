"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Copy, Download, RotateCcw, Save, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BRAND, CREDITS, CURRENCY, PLANS, TOPUP_PACKS } from "@/config/plans";
import { calculate, plansSnippet, profitCurve, toCsv, toCsvRows, type CalcInputs, type CalcResult } from "@/lib/calculator/formulas";
import { axisProps, gridProps, legendProps, SERIES, tooltipProps } from "@/components/charts/chart-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCredits, formatMyr, formatPct, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ScenarioRow {
  id: string;
  name: string;
  inputs: CalcInputs;
  outputs: Pick<CalcResult, "netProfit" | "marginPct" | "revenue" | "aiCost" | "perPro" | "breakEven" | "costPerFreeUser">;
  created_at: string;
}

function Field({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  hint,
  min = 0,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
  hint?: string;
  min?: number;
  max?: number;
}) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          className={cn("h-8 tabular-nums", suffix && "pr-12")}
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Pct({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full accent-[var(--primary)] disabled:opacity-50"
        aria-label={label}
      />
    </div>
  );
}

function Out({ label, value, tone, sub }: { label: string; value: string; tone?: "good" | "bad"; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className={cn("font-medium tabular-nums", tone === "bad" && "text-destructive", tone === "good" && "text-success")}>{value}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}

const tone = (n: number) => (n < 0 ? "bad" : "good");

export function Calculator({
  defaults,
  modelSources,
  initialScenarios,
}: {
  defaults: CalcInputs;
  modelSources: Record<string, string>;
  initialScenarios: ScenarioRow[];
}) {
  const [i, setI] = useState<CalcInputs>(defaults);
  const [scenarios, setScenarios] = useState<ScenarioRow[]>(initialScenarios);
  const [compare, setCompare] = useState<string[]>([]);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const set = <K extends keyof CalcInputs>(k: K) => (v: CalcInputs[K]) => setI((p) => ({ ...p, [k]: v }));

  const r = useMemo(() => calculate(i), [i]);
  const curve = useMemo(() => profitCurve(i), [i]);
  const snippet = useMemo(() => plansSnippet(i, { CURRENCY, CREDITS, PLANS, TOPUP_PACKS }), [i]);

  const barData = [
    { name: "Revenue", Subscriptions: r.revenue.subscriptions, "Top-ups": r.revenue.topups },
    {
      name: "Costs",
      "AI · Pro": r.aiCost.proFrontier + r.aiCost.proUnmetered,
      "AI · Free": r.aiCost.freeFrontier + r.aiCost.freeUnmetered,
      "AI · Top-ups": r.aiCost.topups,
      "Fees + fixed": r.revenue.fees + r.fixedCosts,
    },
  ];

  async function saveScenario() {
    const name = window.prompt("Scenario name", `Pro RM${i.proPriceMyr} · ${i.proDailyCredits}/day`);
    if (!name) return;
    const outputs = {
      netProfit: r.netProfit,
      marginPct: r.marginPct,
      revenue: r.revenue,
      aiCost: r.aiCost,
      perPro: r.perPro,
      breakEven: r.breakEven,
      costPerFreeUser: r.costPerFreeUser,
    };
    const res = await fetch("/api/admin/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, inputs: i, outputs }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(json?.error?.message ?? "Couldn't save scenario");
    setScenarios((s) => [json.scenario, ...s]);
    toast.success("Scenario saved");
  }

  async function deleteScenario(id: string) {
    const res = await fetch(`/api/admin/scenarios?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setScenarios((s) => s.filter((x) => x.id !== id));
      setCompare((c) => c.filter((x) => x !== id));
    }
  }

  function exportCsv() {
    const blob = new Blob([toCsv(toCsvRows(i, r))], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pricing-scenario-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const compared = scenarios.filter((s) => compare.includes(s.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={saveScenario}>
          <Save /> Save as scenario
        </Button>
        <Button variant="outline" onClick={exportCsv}>
          <Download /> Export CSV
        </Button>
        <Button variant="outline" onClick={() => setSnippetOpen(true)}>
          <Wand2 /> Use these values
        </Button>
        <Button variant="ghost" onClick={() => setI(defaults)}>
          <RotateCcw /> Reset to defaults
        </Button>
      </div>

      {r.warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3" role="alert">
          {r.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* ------------------------------ Inputs ------------------------------ */}
        <div className="space-y-4">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="text-base">Credits & currency</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="USD → MYR" value={i.usdToMyr} onChange={set("usdToMyr")} step={0.01} />
              <Field label={`USD per ${BRAND.creditNameSingular}`} value={i.creditRateUsd} onChange={set("creditRateUsd")} step={0.0001} />
              <Field label="Margin multiplier" value={i.marginMultiplier} onChange={set("marginMultiplier")} step={0.05} suffix="×" />
              <Field label="Min charge / request" value={i.minChargePerRequest} onChange={set("minChargePerRequest")} step={0.1} />
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="text-base">Plans & users</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="Pro price" value={i.proPriceMyr} onChange={set("proPriceMyr")} suffix="RM/mo" />
              <Field label="Pro daily allowance" value={i.proDailyCredits} onChange={set("proDailyCredits")} step={10} />
              <Field label="Free daily allowance" value={i.freeDailyCredits} onChange={set("freeDailyCredits")} step={5} />
              <div />
              <Field label="Free users" value={i.freeUsers} onChange={set("freeUsers")} step={100} />
              <Field label="Pro users" value={i.proUsers} onChange={set("proUsers")} step={10} />
              <div className="col-span-2 space-y-3 pt-1">
                <Pct label="Free utilisation (share of allowance used)" value={i.utilFree} onChange={set("utilFree")} disabled={i.worstCase} />
                <Pct label="Pro utilisation" value={i.utilPro} onChange={set("utilPro")} disabled={i.worstCase} />
                <div className="flex items-center gap-2">
                  <Switch id="worst" checked={i.worstCase} onCheckedChange={set("worstCase")} />
                  <Label htmlFor="worst">Worst case: 100% utilisation</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="text-base">Frontier model mix</CardTitle>
              <CardDescription>Share of credit usage per model, or stress-test one model.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={i.stressModel ?? "mix"} onValueChange={(v) => set("stressModel")(v === "mix" ? null : v)}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mix">Use the mix below</SelectItem>
                  {i.models.map((m) => (
                    <SelectItem key={m.slug} value={m.slug}>
                      Stress-test: 100% {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className={cn("max-h-72 space-y-1 overflow-y-auto pr-1", i.stressModel && "opacity-50")}>
                {i.models.map((m, idx) => (
                  <div key={m.slug} className="grid grid-cols-[1fr_72px_88px] items-center gap-2 text-sm">
                    <span className="truncate" title={m.name}>
                      {m.name}
                      {modelSources[m.slug] === "real" && <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">real</Badge>}
                    </span>
                    <Input
                      type="number"
                      className="h-7 tabular-nums"
                      aria-label={`${m.name} weight`}
                      value={m.weight}
                      min={0}
                      disabled={!!i.stressModel}
                      onChange={(e) =>
                        set("models")(i.models.map((x, j) => (j === idx ? { ...x, weight: Number(e.target.value) } : x)))
                      }
                    />
                    <span className="text-right text-xs text-muted-foreground tabular-nums">{formatPct(r.models[idx]?.share ?? 0, 0)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="text-base">Unmetered usage</CardTitle>
              <CardDescription>Cost of paid fallbacks when free endpoints are busy.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="Requests / user / day" value={i.unmeteredRequestsPerUserPerDay} onChange={set("unmeteredRequestsPerUserPerDay")} step={1} />
              <Field label="Avg cost / fallback (USD)" value={i.unmeteredCostPerFallbackUsd} onChange={set("unmeteredCostPerFallbackUsd")} step={0.0001} />
              <div className="col-span-2">
                <Pct label="Served by paid fallback" value={i.unmeteredPaidShare} onChange={set("unmeteredPaidShare")} />
              </div>
            </CardContent>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="text-base">Fees, fixed costs & top-ups</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Field label="Payment fee %" value={i.feePercent} onChange={set("feePercent")} step={0.1} suffix="%" />
              <Field label="Payment fee fixed" value={i.feeFixedMyr} onChange={set("feeFixedMyr")} step={0.1} suffix="RM" />
              {(["hosting", "supabase", "redis", "domain", "other"] as const).map((k) => (
                <Field
                  key={k}
                  label={`${k[0].toUpperCase()}${k.slice(1)} / month`}
                  value={i.fixedCostsMyr[k]}
                  onChange={(v) => set("fixedCostsMyr")({ ...i.fixedCostsMyr, [k]: v })}
                  suffix="RM"
                />
              ))}
              <div />
              <Field label="Top-up packs / month" value={i.topupPacksPerMonth} onChange={set("topupPacksPerMonth")} />
              <Field label="Pack price" value={i.topupPackPriceMyr} onChange={set("topupPackPriceMyr")} suffix="RM" />
              <Field label={`${BRAND.creditName} per pack`} value={i.topupPackCredits} onChange={set("topupPackCredits")} step={100} />
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------ Outputs ------------------------------ */}
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs text-muted-foreground">Net profit / month</div>
              <div className={cn("text-2xl font-semibold tabular-nums", r.netProfit < 0 ? "text-destructive" : "text-success")}>{formatMyr(r.netProfit)}</div>
              <div className="text-xs text-muted-foreground">Margin {r.marginPct == null ? "—" : formatPct(r.marginPct)}</div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs text-muted-foreground">Profit per Pro user</div>
              <div className={cn("text-2xl font-semibold tabular-nums", r.perPro.profit < 0 && "text-destructive")}>{formatMyr(r.perPro.profit)}</div>
              <div className={cn("text-xs", r.perPro.profitAt100 < 0 ? "text-destructive" : "text-muted-foreground")}>
                {formatMyr(r.perPro.profitAt100)} at 100% use
              </div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-xs text-muted-foreground">Pro users to break even</div>
              <div className="text-2xl font-semibold tabular-nums">{r.breakEven.proUsersNeeded == null ? "∞" : r.breakEven.proUsersNeeded.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">covers fixed + Free-user costs</div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="gap-2">
              <CardHeader>
                <CardTitle className="text-base">Monthly P&amp;L (MYR)</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                <div className="pb-2">
                  <Out label="Subscriptions" value={formatMyr(r.revenue.subscriptions)} />
                  <Out label="Top-ups" value={formatMyr(r.revenue.topups)} />
                  <Out label="− Payment fees" value={formatMyr(-r.revenue.fees)} />
                  <Out label="Net revenue" value={formatMyr(r.revenue.net)} />
                </div>
                <div className="py-2">
                  <Out label="AI · Pro frontier" value={formatMyr(r.aiCost.proFrontier)} />
                  <Out label="AI · Pro unmetered fallback" value={formatMyr(r.aiCost.proUnmetered)} />
                  <Out label="AI · Free frontier" value={formatMyr(r.aiCost.freeFrontier)} />
                  <Out label="AI · Free unmetered fallback" value={formatMyr(r.aiCost.freeUnmetered)} />
                  <Out label="AI · Top-up credits" value={formatMyr(r.aiCost.topups)} />
                  <Out label="Total AI cost" value={formatMyr(r.aiCost.total)} />
                  <Out label="Fixed costs" value={formatMyr(r.fixedCosts)} />
                </div>
                <div className="pt-2">
                  <Out label="Net profit / loss" value={formatMyr(r.netProfit)} tone={tone(r.netProfit)} />
                </div>
              </CardContent>
            </Card>

            <Card className="gap-2">
              <CardHeader>
                <CardTitle className="text-base">Unit economics & break-even</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                <div className="pb-2">
                  <Out label="Revenue per Pro user" value={formatMyr(r.perPro.revenue)} sub="after payment fees" />
                  <Out label={`AI cost per Pro user (${Math.round(r.effectiveUtilPro * 100)}%)`} value={formatMyr(r.perPro.aiCost)} />
                  <Out label="AI cost per Pro user (100%)" value={formatMyr(r.perPro.aiCostAt100)} />
                  <Out label="Profit per Pro user" value={formatMyr(r.perPro.profit)} tone={tone(r.perPro.profit)} />
                  <Out label="Cost per Free user / month" value={formatMyr(r.costPerFreeUser)} sub="free-tier acquisition cost" />
                </div>
                <div className="pt-2">
                  <Out label="Min Pro price (break-even)" value={formatMyr(r.breakEven.minProPrice)} sub={`${formatMyr(r.breakEven.minProPriceAt100)} at 100%`} />
                  <Out
                    label="Max safe Pro allowance"
                    value={`${formatCredits(r.breakEven.maxSafeProAllowance)} / day`}
                    sub={`${formatCredits(r.breakEven.maxSafeProAllowanceAt100)} / day at 100%`}
                  />
                  <Out label="AI cost per credit used" value={formatUsd(r.k, 6)} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="gap-2">
              <CardHeader>
                <CardTitle className="text-base">Revenue vs cost</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis {...axisProps} width={56} tickFormatter={(v: number) => `RM${Math.round(v).toLocaleString()}`} />
                    <Tooltip {...tooltipProps} formatter={(v) => formatMyr(Number(v))} />
                    <Legend {...legendProps} />
                    <Bar dataKey="Subscriptions" stackId="a" fill={SERIES[0]} stroke="var(--card)" strokeWidth={2} />
                    <Bar dataKey="Top-ups" stackId="a" fill={SERIES[2]} stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="AI · Pro" stackId="a" fill={SERIES[1]} stroke="var(--card)" strokeWidth={2} />
                    <Bar dataKey="AI · Free" stackId="a" fill={SERIES[3]} stroke="var(--card)" strokeWidth={2} />
                    <Bar dataKey="AI · Top-ups" stackId="a" fill={SERIES[4]} stroke="var(--card)" strokeWidth={2} />
                    <Bar dataKey="Fees + fixed" stackId="a" fill={SERIES[6]} stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="gap-2">
              <CardHeader>
                <CardTitle className="text-base">Net profit vs number of Pro users</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curve} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="proUsers" {...axisProps} />
                    <YAxis {...axisProps} width={64} tickFormatter={(v: number) => `RM${Math.round(v).toLocaleString()}`} />
                    <Tooltip {...tooltipProps} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} labelFormatter={(l) => `${l} Pro users`} formatter={(v) => [formatMyr(Number(v)), "Net profit"]} />
                    <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                    <ReferenceLine x={i.proUsers} stroke="var(--border)" />
                    <Line type="monotone" dataKey="profit" stroke={SERIES[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="text-base">What the daily allowance buys</CardTitle>
              <CardDescription>Requests per day on each frontier model at the average cost per request.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">{BRAND.creditName}/req</TableHead>
                    <TableHead className="text-right">Free/day</TableHead>
                    <TableHead className="text-right">Pro/day</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.models.map((m) => (
                    <TableRow key={m.slug} className={m.belowCost ? "bg-destructive/5" : ""}>
                      <TableCell>{m.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCredits(m.creditsPerRequest, 2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.requestsPerDayFree}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.requestsPerDayPro}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", m.belowCost && "text-destructive")}>{m.margin.toFixed(2)}×</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="text-base">Saved scenarios</CardTitle>
              <CardDescription>Tick scenarios to compare them side by side.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {scenarios.length === 0 && <p className="text-sm text-muted-foreground">No saved scenarios yet.</p>}
              <ul className="divide-y text-sm">
                {scenarios.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Compare ${s.name}`}
                      checked={compare.includes(s.id)}
                      onChange={(e) => setCompare((c) => (e.target.checked ? [...c, s.id].slice(-4) : c.filter((x) => x !== s.id)))}
                    />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className={cn("tabular-nums", s.outputs.netProfit < 0 ? "text-destructive" : "text-muted-foreground")}>
                      {formatMyr(s.outputs.netProfit)}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setI({ ...defaults, ...s.inputs })}>
                      Load
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => deleteScenario(s.id)}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
              {compared.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead className="text-right">Current</TableHead>
                      {compared.map((s) => (
                        <TableHead key={s.id} className="text-right">
                          {s.name}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(
                      [
                        ["Pro price", (x: CalcInputs) => formatMyr(x.proPriceMyr)],
                        ["Pro allowance", (x: CalcInputs) => formatCredits(x.proDailyCredits)],
                        ["Free allowance", (x: CalcInputs) => formatCredits(x.freeDailyCredits)],
                        ["Margin ×", (x: CalcInputs) => String(x.marginMultiplier)],
                      ] as [string, (x: CalcInputs) => string][]
                    ).map(([label, f]) => (
                      <TableRow key={label}>
                        <TableCell className="text-muted-foreground">{label}</TableCell>
                        <TableCell className="text-right tabular-nums">{f(i)}</TableCell>
                        {compared.map((s) => (
                          <TableCell key={s.id} className="text-right tabular-nums">
                            {f(s.inputs)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    {(
                      [
                        ["Net revenue", (o: ScenarioRow["outputs"]) => formatMyr(o.revenue.net)],
                        ["AI cost", (o: ScenarioRow["outputs"]) => formatMyr(o.aiCost.total)],
                        ["Net profit", (o: ScenarioRow["outputs"]) => formatMyr(o.netProfit)],
                        ["Margin", (o: ScenarioRow["outputs"]) => (o.marginPct == null ? "—" : formatPct(o.marginPct))],
                        ["Profit / Pro user", (o: ScenarioRow["outputs"]) => formatMyr(o.perPro.profit)],
                        ["Pro users to break even", (o: ScenarioRow["outputs"]) => (o.breakEven.proUsersNeeded == null ? "∞" : String(o.breakEven.proUsersNeeded))],
                      ] as [string, (o: ScenarioRow["outputs"]) => string][]
                    ).map(([label, f]) => (
                      <TableRow key={label}>
                        <TableCell className="text-muted-foreground">{label}</TableCell>
                        <TableCell className="text-right tabular-nums">{f(r)}</TableCell>
                        {compared.map((s) => (
                          <TableCell key={s.id} className="text-right tabular-nums">
                            {f(s.outputs)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={snippetOpen} onOpenChange={setSnippetOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Updated config/plans.ts blocks</DialogTitle>
            <DialogDescription>
              Copy these blocks into config/plans.ts, review the diff, and deploy. Nothing is changed automatically.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60dvh] overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">{snippet}</pre>
          <Button
            onClick={async () => {
              await navigator.clipboard.writeText(snippet);
              toast.success("Copied to clipboard");
            }}
          >
            <Copy /> Copy snippet
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
