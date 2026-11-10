"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CreditCard, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { BRAND, PLANS, TOPUP_PACKS } from "@/config/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCredits, formatMyr } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Wallet } from "@/lib/types";

interface Props {
  email: string;
  displayName: string;
  plan: "free" | "pro";
  hasBillingAccount: boolean;
  subscription: { status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  topups: { id: string; credits: number; amountMyr: number; status: string; createdAt: string }[];
  wallet: Wallet;
  checkout?: string;
  highlightUpgrade?: boolean;
}

async function postJson(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? "Something went wrong.");
  return json;
}

export function SettingsView(p: Props) {
  const router = useRouter();
  const [name, setName] = useState(p.displayName);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (p.checkout === "pro-success") toast.success("Welcome to Pro! Your bigger allowance is active.");
    if (p.checkout === "topup-success") toast.success(`Payment received. Your ${BRAND.creditName} will appear in a moment.`);
    if (p.checkout === "cancelled") toast("Checkout cancelled.");
    if (p.checkout) router.replace("/app/settings", { scroll: false });
  }, [p.checkout, router]);

  async function go(key: string, url: string, body?: unknown) {
    setBusy(key);
    try {
      const { url: to } = await postJson(url, body);
      window.location.href = to;
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  const pastDue = p.subscription?.status === "past_due" || p.subscription?.status === "unpaid";
  const periodEnd = p.subscription?.currentPeriodEnd ? new Date(p.subscription.currentPeriodEnd).toLocaleDateString("en-MY", { dateStyle: "medium" }) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      {pastDue && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>
            We couldn&apos;t charge your card for Pro. Update your payment method to keep your Pro benefits.
            <Button size="sm" className="mt-2" onClick={() => go("portal", "/api/billing/portal")}>
              Update payment method
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{p.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("name");
              try {
                await postJson("/api/account", { displayName: name }, "PATCH");
                toast.success("Name updated.");
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
              setBusy(null);
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="name">Display name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <Button type="submit" variant="outline" disabled={busy === "name" || !name.trim() || name === p.displayName}>
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className={cn(p.highlightUpgrade && p.plan === "free" && "ring-2 ring-primary")}>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Plan</CardTitle>
            <Badge variant={p.plan === "pro" ? "default" : "secondary"}>{PLANS[p.plan].name}</Badge>
          </div>
          <CardDescription>
            {p.plan === "pro"
              ? p.subscription?.cancelAtPeriodEnd
                ? `Pro ends on ${periodEnd}. You won't be charged again.`
                : `Renews ${periodEnd ? `on ${periodEnd}` : "monthly"} at ${formatMyr(PLANS.pro.priceMyr)}.`
              : `You're on the Free plan with ${formatCredits(PLANS.free.dailyCredits)} ${BRAND.creditName} per day.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground">Today&apos;s allowance</div>
              <div className="text-lg font-semibold tabular-nums">
                {formatCredits(p.wallet.daily)} / {formatCredits(PLANS[p.plan].dailyCredits)}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground">Top-up balance</div>
              <div className="text-lg font-semibold tabular-nums">{formatCredits(p.wallet.topup)}</div>
            </div>
          </div>
          {p.plan === "free" && (
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <Sparkles className="size-4 text-primary" /> Pro · {formatMyr(PLANS.pro.priceMyr, 0)}/month
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{formatCredits(PLANS.pro.dailyCredits)} {BRAND.creditName} every day</li>
                {PLANS.pro.features.slice(1).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {p.plan === "free" ? (
            <Button onClick={() => go("pro", "/api/billing/checkout", { kind: "pro" })} disabled={busy === "pro"}>
              {busy === "pro" && <Loader2 className="animate-spin" />} Upgrade to Pro
            </Button>
          ) : null}
          {p.hasBillingAccount && (
            <Button variant="outline" onClick={() => go("portal", "/api/billing/portal")} disabled={busy === "portal"}>
              {busy === "portal" ? <Loader2 className="animate-spin" /> : <CreditCard />} Manage billing
            </Button>
          )}
        </CardFooter>
      </Card>

      <Card id="topup">
        <CardHeader>
          <CardTitle>Top up {BRAND.creditName}</CardTitle>
          <CardDescription>
            One-off packs. Purchased {BRAND.creditName} never expire and are used after your daily allowance runs out.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {TOPUP_PACKS.map((pack) => (
            <div key={pack.id} className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <div className="font-semibold">
                  {formatCredits(pack.credits)} {BRAND.creditName}
                </div>
                <div className="text-sm text-muted-foreground">{pack.name}</div>
              </div>
              <Button onClick={() => go(pack.id, "/api/billing/checkout", { kind: "topup", packId: pack.id })} disabled={busy === pack.id}>
                {busy === pack.id && <Loader2 className="animate-spin" />}
                {formatMyr(pack.priceMyr, 0)}
              </Button>
            </div>
          ))}
          {p.topups.length > 0 && (
            <div className="sm:col-span-2">
              <div className="mb-1 text-sm font-medium">Purchase history</div>
              <ul className="divide-y text-sm">
                {p.topups.map((t) => (
                  <li key={t.id} className="flex justify-between py-1.5">
                    <span>
                      {new Date(t.createdAt).toLocaleDateString("en-MY")} · {formatCredits(t.credits)} {BRAND.creditName}
                    </span>
                    <span className="text-muted-foreground">
                      {formatMyr(t.amountMyr)} · {t.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Permanently deletes your account, conversations and remaining {BRAND.creditName}. Active subscriptions are
            cancelled immediately. This can&apos;t be undone.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete my account
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>Type DELETE to confirm. All your data will be removed permanently.</DialogDescription>
          </DialogHeader>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirm !== "DELETE" || busy === "delete"}
              onClick={async () => {
                setBusy("delete");
                try {
                  await postJson("/api/account", { confirm }, "DELETE");
                  window.location.href = "/";
                } catch (e) {
                  toast.error((e as Error).message);
                  setBusy(null);
                }
              }}
            >
              {busy === "delete" && <Loader2 className="animate-spin" />} Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
