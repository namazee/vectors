"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { BRAND } from "@/config/plans";
import { useAppData } from "@/components/app/app-data";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCredits } from "@/lib/format";

export function CreditIndicator() {
  const { wallet, status } = useAppData();
  if (!wallet || !status) return <Skeleton className="h-8 w-28" />;

  const pct = status.dailyAllowance > 0 ? Math.min(100, (wallet.daily / status.dailyAllowance) * 100) : 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 tabular-nums" aria-label={`${BRAND.creditName} balance`}>
          <Sparkles className="text-primary" />
          <span>{formatCredits(wallet.daily)}</span>
          {wallet.topup > 0 && <span className="text-muted-foreground">+ {formatCredits(wallet.topup)}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="font-medium">Today&apos;s allowance</span>
            <span className="tabular-nums">
              {formatCredits(wallet.daily)} / {formatCredits(status.dailyAllowance)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Resets at midnight (Malaysia time). No rollover.</p>
        </div>
        <div className="flex justify-between text-sm">
          <span className="font-medium">Top-up balance</span>
          <span className="tabular-nums">{formatCredits(wallet.topup)}</span>
        </div>
        <p className="text-xs text-muted-foreground">Top-up {BRAND.creditName} never expire and are used after your daily allowance.</p>
        <div className="flex justify-between text-sm">
          <span className="font-medium">Unmetered today</span>
          <span className="tabular-nums">
            {status.unmeteredUsedToday} / {status.unmeteredDailyCap} messages
          </span>
        </div>
        <div className="flex gap-2">
          {status.plan === "free" && (
            <Button asChild size="sm" className="flex-1">
              <Link href="/app/settings?upgrade=pro">Upgrade to Pro</Link>
            </Button>
          )}
          <Button asChild size="sm" variant="outline" className="flex-1">
            <Link href="/app/settings#topup">Top up</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
