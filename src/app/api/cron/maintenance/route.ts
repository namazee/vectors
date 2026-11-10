import { CREDITS } from "@/config/plans";
import { isAuthorizedCron, unauthorized } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { getStore } from "@/lib/redis";
import { checkSpendAlerts, getSpendState } from "@/lib/capacity";
import { utcMonth } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Every 15 minutes:
 *  - release credit holds from requests that never settled (crashes, timeouts)
 *  - refresh the monthly spend from the database and fire cap alerts if needed
 */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return unauthorized();
  const admin = createAdminClient();
  const { data: released, error } = await admin.rpc("release_stale_holds", { p_ttl_minutes: CREDITS.holdTtlMinutes });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Force a reload from the DB (source of truth), then evaluate alerts.
  await getStore().del(`spend:${utcMonth()}`);
  const settings = await getSettings();
  const spend = await getSpendState(settings);
  await checkSpendAlerts(spend.spent, settings);

  return Response.json({ releasedHolds: released, spend });
}
