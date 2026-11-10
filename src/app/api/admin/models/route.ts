import { z } from "zod";
import { errorResponse, HttpError, requireApiAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOpenRouterModels, syncModelPrices } from "@/lib/models/sync";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      active: z.boolean(),
      tier: z.enum(["unmetered", "frontier"]),
      display_name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(300).nullable(),
      openrouter_id: z.string().trim().min(3).max(120),
      free_openrouter_id: z.string().trim().max(120).nullable(),
      fallback_model_slug: z.string().trim().max(80).nullable(),
      input_price_per_m: z.number().min(0).max(10_000),
      output_price_per_m: z.number().min(0).max(10_000),
      est_credits_per_request: z.number().min(0).max(1_000_000).nullable(),
      margin_override: z.number().min(0.1).max(100).nullable(),
      max_output_tokens: z.number().int().min(256).max(1_000_000).nullable(),
      sort_order: z.number().int().min(0).max(100_000),
    })
    .partial(),
});

export async function PATCH(req: Request) {
  try {
    await requireApiAdmin();
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Invalid update.");
    const patch = { ...parsed.data.patch };
    for (const k of ["free_openrouter_id", "fallback_model_slug", "description"] as const) {
      if (patch[k] === "") patch[k] = null;
    }
    const { data, error } = await createAdminClient().from("models").update(patch).eq("id", parsed.data.id).select("*").single();
    if (error) throw new HttpError(400, "invalid_request", error.message);
    return Response.json({ model: data });
  } catch (e) {
    return errorResponse(e);
  }
}

const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

/** Reorder: assigns sort_order 10, 20, 30… in the given order. */
export async function PUT(req: Request) {
  try {
    await requireApiAdmin();
    const parsed = reorderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Invalid order.");
    const db = createAdminClient();
    await Promise.all(parsed.data.ids.map((id, idx) => db.from("models").update({ sort_order: (idx + 1) * 10 }).eq("id", id)));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Sync prices from OpenRouter (?dry=1 for a preview). */
export async function POST(req: Request) {
  try {
    await requireApiAdmin();
    const dryRun = new URL(req.url).searchParams.get("dry") === "1";
    const remote = await fetchOpenRouterModels(process.env.OPENROUTER_BASE_URL || undefined).catch((e) => {
      throw new HttpError(502, "upstream_error", `Couldn't reach OpenRouter: ${(e as Error).message}`);
    });
    const result = await syncModelPrices(createAdminClient(), remote, { dryRun });
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
