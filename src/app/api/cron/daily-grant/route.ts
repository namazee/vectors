import { getPlan } from "@/config/plans";
import { isAuthorizedCron, unauthorized } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { klDate } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs at 00:00 Asia/Kuala_Lumpur (16:00 UTC). Optional: allowances are also
 * granted lazily on first use, so this only pre-warms balances for users active
 * in the last 7 days (so their header shows the fresh allowance immediately).
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return unauthorized();
  const admin = createAdminClient();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: active } = await admin.from("usage_logs").select("user_id").gte("created_at", since).limit(10000);
  const ids = Array.from(new Set((active ?? []).map((r) => r.user_id as string)));
  if (!ids.length) return Response.json({ granted: 0 });

  const { data: profiles } = await admin.from("profiles").select("id, plan").in("id", ids);
  const today = klDate();
  let granted = 0;
  for (const p of profiles ?? []) {
    const { error } = await admin.rpc("get_wallet", {
      p_user: p.id,
      p_daily_amount: getPlan(p.plan).dailyCredits,
      p_today: today,
    });
    if (!error) granted++;
  }
  return Response.json({ granted, date: today });
}
