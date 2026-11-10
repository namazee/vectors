import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayCreditsPerRequest } from "@/lib/credits/pricing";
import { SEED_MODELS } from "@/lib/models/seed-data";
import type { ModelRow, PublicModel } from "@/lib/types";

const isConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function seedRows(): ModelRow[] {
  return SEED_MODELS.map((m) => ({
    id: m.slug,
    slug: m.slug,
    display_name: m.display_name,
    provider: m.provider,
    openrouter_id: m.openrouter_id,
    free_openrouter_id: m.free_openrouter_id ?? null,
    fallback_model_slug: m.fallback_model_slug ?? null,
    tier: m.tier,
    input_price_per_m: m.input_price_per_m,
    output_price_per_m: m.output_price_per_m,
    context_length: m.context_length,
    max_output_tokens: m.max_output_tokens ?? null,
    description: m.description,
    logo: null,
    active: true,
    sort_order: m.sort_order,
    est_credits_per_request: null,
    avg_credits_per_request: null,
    avg_sample_count: 0,
    margin_override: null,
    last_synced_at: null,
  }));
}

/** All models (admin + routing). Falls back to seed data when the DB isn't configured. */
export async function getAllModels(opts: { activeOnly?: boolean } = {}): Promise<ModelRow[]> {
  if (!isConfigured()) return seedRows();
  let q = createAdminClient().from("models").select("*").order("tier", { ascending: false }).order("sort_order");
  if (opts.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    console.error("[models] load failed", error.message);
    return seedRows();
  }
  return (data ?? []) as ModelRow[];
}

export async function getModelBySlug(slug: string): Promise<ModelRow | null> {
  const all = await getAllModels();
  return all.find((m) => m.slug === slug) ?? null;
}

export function toPublicModel(m: ModelRow): PublicModel {
  return {
    slug: m.slug,
    name: m.display_name,
    provider: m.provider,
    tier: m.tier,
    description: m.description,
    contextLength: m.context_length,
    creditsPerRequest: displayCreditsPerRequest(m),
  };
}

export async function getPublicModels(): Promise<PublicModel[]> {
  const rows = await getAllModels({ activeOnly: true });
  return rows.map(toPublicModel);
}
