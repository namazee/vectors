"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Infinity as InfinityIcon, Sparkles, Zap } from "lucide-react";
import { BRAND, PLANS, TOPUP_PACKS } from "@/config/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderMark } from "@/components/models/provider-badge";
import { formatCredits, formatMyr } from "@/lib/format";
import type { PublicModel } from "@/lib/types";

export function PricingCards({ models, showTopups = true }: { models: PublicModel[]; showTopups?: boolean }) {
  const [plan, setPlan] = useState<"free" | "pro">("free");
  const allowance = PLANS[plan].dailyCredits;
  const frontier = models.filter((m) => m.tier === "frontier").sort((a, b) => b.creditsPerRequest - a.creditsPerRequest);
  const unmetered = models.filter((m) => m.tier === "unmetered");

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-3">
        <Tabs value={plan} onValueChange={(v) => setPlan(v as "free" | "pro")}>
          <TabsList aria-label="Show allowance for">
            <TabsTrigger value="free" className="px-5">Free account</TabsTrigger>
            <TabsTrigger value="pro" className="px-5">
              With Pro <Badge variant="secondary" className="ml-1">{formatMyr(PLANS.pro.priceMyr, 0)}/mo</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-sm text-muted-foreground">
          {plan === "free"
            ? "Sign up free. No card needed."
            : `Pro is ${formatMyr(PLANS.pro.priceMyr, 0)} per month. Cancel anytime.`}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="relative border-primary/40 shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="size-5 text-primary" /> Frontier models
              </CardTitle>
              <Badge className="text-sm" aria-live="polite">
                {formatCredits(allowance)} {BRAND.creditName}/day
              </Badge>
            </div>
            <CardDescription>
              The most capable models from OpenAI, Anthropic, Google, Alibaba and more. Paid with {BRAND.creditName},
              charged on actual usage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {frontier.slice(0, 9).map((m) => {
              const perDay = m.creditsPerRequest > 0 ? Math.floor(allowance / m.creditsPerRequest) : 0;
              return (
                <div key={m.slug} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm odd:bg-muted/50">
                  <span className="flex min-w-0 items-center gap-2">
                    <ProviderMark provider={m.provider} />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <span className="shrink-0 text-right text-muted-foreground tabular-nums">
                    ~{formatCredits(m.creditsPerRequest)} / request
                    <span className="hidden sm:inline"> · ~{perDay}/day</span>
                  </span>
                </div>
              );
            })}
            <p className="pt-2 text-xs text-muted-foreground">
              Estimates assume a typical request (~1,100 words of context in, ~450 words out). Long chats cost more; short ones less. Daily allowance resets at
              midnight (Malaysia time) and does not roll over.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild className="w-full">
              <Link href={plan === "pro" ? "/signup?plan=pro" : "/signup"}>
                {plan === "pro" ? "Get Pro" : "Start free"}
              </Link>
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Zap className="size-5 text-success" /> Unmetered models
              </CardTitle>
              <Badge variant="success" className="text-sm">0 {BRAND.creditName}</Badge>
            </div>
            <CardDescription>
              Fast, capable open models included with every account. No credits, just a generous fair-use limit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {unmetered.map((m) => (
              <div key={m.slug} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm odd:bg-muted/50">
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderMark provider={m.provider} />
                  <span className="truncate">{m.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                  <InfinityIcon className="size-4" /> free
                </span>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Fair use: up to {PLANS[plan].unmeteredDailyCap} messages/day on the {plan === "pro" ? "Pro" : "Free"} plan.
              Free endpoints may log prompts. See our <Link href="/privacy" className="underline">privacy notice</Link>.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/signup">Chat for free</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>

      <div className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
        {(["free", "pro"] as const).map((id) => (
          <div key={id} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="font-semibold">{PLANS[id].name}</h3>
              <span className="text-sm text-muted-foreground">
                {PLANS[id].priceMyr === 0 ? "RM 0" : `${formatMyr(PLANS[id].priceMyr, 0)}/month`}
              </span>
            </div>
            <ul className="space-y-1 text-sm">
              {PLANS[id].features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" /> {f}
                </li>
              ))}
              <li className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" /> {formatCredits(PLANS[id].dailyCredits)} {BRAND.creditName} every day
              </li>
            </ul>
          </div>
        ))}
      </div>

      {showTopups && (
        <div className="space-y-3 text-center">
          <h3 className="font-semibold">Need more? Top-up packs</h3>
          <div className="flex flex-wrap justify-center gap-3">
            {TOPUP_PACKS.map((p) => (
              <div key={p.id} className="rounded-lg border px-4 py-3 text-sm">
                <div className="font-medium">{formatCredits(p.credits)} {BRAND.creditName}</div>
                <div className="text-muted-foreground">{formatMyr(p.priceMyr, 0)} one-off</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Purchased {BRAND.creditName} never expire and are used only after your daily allowance runs out.
          </p>
        </div>
      )}
    </div>
  );
}
