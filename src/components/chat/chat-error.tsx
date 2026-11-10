"use client";

import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";
import { BRAND } from "@/config/plans";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatCredits } from "@/lib/format";
import type { ChatErrorBody } from "@/lib/chat/types";

const TITLES: Record<string, string> = {
  insufficient_credits: `Not enough ${BRAND.creditName}`,
  fair_use_limit: "Daily fair-use limit reached",
  frontier_paused: "Frontier models paused",
  capacity_busy: "Model busy",
  model_unavailable: "Model unavailable",
  rate_limited: "Slow down a little",
  pro_required: "Pro feature",
  server_error: "Something went wrong",
};

export function ChatError({
  error,
  onRetry,
  onUseUnmetered,
}: {
  error: ChatErrorBody;
  onRetry?: () => void;
  onUseUnmetered?: () => void;
}) {
  return (
    <Alert variant={error.code === "server_error" || error.code === "model_unavailable" ? "destructive" : "warning"}>
      <AlertCircle />
      <AlertTitle>{TITLES[error.code] ?? "Error"}</AlertTitle>
      <AlertDescription>
        <p>{error.message}</p>
        {error.code === "insufficient_credits" && error.available != null && (
          <p className="text-xs">
            Available: {formatCredits(error.available)} · needed: ~{formatCredits(error.required ?? 0)}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {(error.code === "insufficient_credits" || error.code === "pro_required" || error.code === "fair_use_limit") &&
            error.plan !== "pro" && (
              <Button asChild size="sm">
                <Link href="/app/settings?upgrade=pro">Upgrade to Pro</Link>
              </Button>
            )}
          {error.code === "insufficient_credits" && (
            <Button asChild size="sm" variant="outline">
              <Link href="/app/settings#topup">Buy a top-up</Link>
            </Button>
          )}
          {(error.code === "insufficient_credits" || error.code === "frontier_paused") && onUseUnmetered && (
            <Button size="sm" variant="outline" onClick={onUseUnmetered}>
              Switch to a free model
            </Button>
          )}
          {(error.code === "capacity_busy" || error.code === "server_error" || error.code === "model_unavailable" || error.code === "rate_limited") &&
            onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw /> Try again
              </Button>
            )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
