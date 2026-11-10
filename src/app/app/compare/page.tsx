import type { Metadata } from "next";
import Link from "next/link";
import { Columns3 } from "lucide-react";
import { getPlan, PLANS } from "@/config/plans";
import { requireUser } from "@/lib/auth";
import { loadConversation } from "@/lib/chat/conversations";
import { CompareView } from "@/components/chat/compare-view";
import { Button } from "@/components/ui/button";
import { formatMyr } from "@/lib/format";

export const metadata: Metadata = { title: "Compare models" };

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { userId, profile } = await requireUser();
  const plan = getPlan(profile.plan);
  if (!plan.compareMode) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <Columns3 className="size-10 text-primary" />
        <h1 className="text-2xl font-semibold">Compare models side by side</h1>
        <p className="text-muted-foreground">
          Send one prompt to up to {PLANS.pro.compareMaxModels} models at once and pick the best answer. Available on Pro
          ({formatMyr(PLANS.pro.priceMyr, 0)}/month).
        </p>
        <Button asChild>
          <Link href="/app/settings?upgrade=pro">Upgrade to Pro</Link>
        </Button>
      </div>
    );
  }

  const { c } = await searchParams;
  let initial = null;
  if (c && /^[0-9a-f-]{36}$/i.test(c)) {
    const res = await loadConversation(userId, profile.plan, c);
    if (res.ok && res.conversation.is_compare) initial = { conversation: res.conversation, messages: res.messages };
  }
  return <CompareView key={c ?? "new"} initial={initial} maxModels={plan.compareMaxModels} />;
}
