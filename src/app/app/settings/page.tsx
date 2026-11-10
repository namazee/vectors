import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWallet } from "@/lib/credits/ledger";
import { getPlan } from "@/config/plans";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ checkout?: string; upgrade?: string }> }) {
  const { userId, email, profile } = await requireUser();
  const sp = await searchParams;
  const admin = createAdminClient();
  const [{ data: subs }, { data: topups }, wallet] = await Promise.all([
    admin.from("subscriptions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
    admin.from("topups").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    getWallet(userId, profile.plan),
  ]);
  const sub = (subs ?? [])[0] ?? null;
  return (
    <div className="h-full overflow-y-auto">
      <SettingsView
        email={email ?? ""}
        displayName={profile.display_name ?? ""}
        plan={getPlan(profile.plan).id}
        hasBillingAccount={!!profile.stripe_customer_id}
        subscription={
          sub
            ? {
                status: sub.status,
                currentPeriodEnd: sub.current_period_end,
                cancelAtPeriodEnd: sub.cancel_at_period_end,
              }
            : null
        }
        topups={(topups ?? []).map((t) => ({
          id: t.id,
          credits: Number(t.credits),
          amountMyr: Number(t.amount_myr),
          status: t.status,
          createdAt: t.created_at,
        }))}
        wallet={wallet}
        checkout={sp.checkout}
        highlightUpgrade={sp.upgrade === "pro"}
      />
    </div>
  );
}
