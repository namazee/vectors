import { z } from "zod";
import { errorResponse, HttpError, requireApiAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSettings, SETTING_DB_KEYS } from "@/lib/settings";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    spend_cap_usd: z.number().min(0).max(1_000_000),
    unmetered_cap_free: z.number().int().min(0).max(100_000),
    unmetered_cap_pro: z.number().int().min(0).max(100_000),
    free_endpoint_per_minute: z.number().int().min(0).max(10_000),
    free_endpoint_per_day: z.number().int().min(0).max(1_000_000),
    frontier_paused: z.boolean(),
  })
  .partial();

/** Updates runtime overrides stored in app_settings (take effect within ~30s). */
export async function POST(req: Request) {
  try {
    await requireApiAdmin();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid settings.");
    const rows = Object.entries(parsed.data)
      .filter(([k]) => k in SETTING_DB_KEYS)
      .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    if (rows.length) {
      const { error } = await createAdminClient().from("app_settings").upsert(rows);
      if (error) throw error;
    }
    invalidateSettings();
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
