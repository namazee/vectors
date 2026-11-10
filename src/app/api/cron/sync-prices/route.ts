import { isAuthorizedCron, unauthorized } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOpenRouterModels, syncModelPrices } from "@/lib/models/sync";
import { sendAdminAlert } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily: refresh model prices/context lengths from OpenRouter and warn about removed models. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return unauthorized();
  try {
    const remote = await fetchOpenRouterModels(process.env.OPENROUTER_BASE_URL || undefined);
    const result = await syncModelPrices(createAdminClient(), remote);
    if (result.missing.length) {
      await sendAdminAlert(
        "Models missing on OpenRouter",
        result.missing.map((m) => `${m.slug}: ${m.openrouterId}`).join("\n") +
          "\n\nUpdate or deactivate them in Admin → Models.",
      );
    }
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
