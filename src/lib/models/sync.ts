import type { SupabaseClient } from "@supabase/supabase-js";
import { seedCreditsPerRequest } from "@/lib/credits/pricing";

/** Shape of https://openrouter.ai/api/v1/models entries (fields we use). */
export interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number | null;
  pricing: { prompt: string; completion: string };
  top_provider?: { max_completion_tokens?: number | null } | null;
}

export interface SyncChange {
  slug: string;
  openrouterId: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface SyncResult {
  checked: number;
  updated: number;
  changes: SyncChange[];
  missing: { slug: string; openrouterId: string }[];
  missingFree: { slug: string; freeId: string }[];
}

export async function fetchOpenRouterModels(baseUrl = "https://openrouter.ai/api/v1"): Promise<OpenRouterModel[]> {
  const res = await fetch(`${baseUrl}/models`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OpenRouter models API returned ${res.status}`);
  const json = (await res.json()) as { data: OpenRouterModel[] };
  return json.data;
}

const perMillion = (perToken: string) => Math.round(Number(perToken) * 1_000_000 * 1e6) / 1e6;

/** Compares DB models against OpenRouter and (unless dryRun) writes price/context changes. */
export async function syncModelPrices(
  db: SupabaseClient,
  remote: OpenRouterModel[],
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult> {
  const byId = new Map(remote.map((m) => [m.id, m]));
  const { data: rows, error } = await db.from("models").select("*");
  if (error) throw error;

  const result: SyncResult = { checked: 0, updated: 0, changes: [], missing: [], missingFree: [] };
  for (const row of rows ?? []) {
    result.checked++;
    const r = byId.get(row.openrouter_id);
    if (!r) {
      result.missing.push({ slug: row.slug, openrouterId: row.openrouter_id });
      continue;
    }
    if (row.free_openrouter_id && !byId.has(row.free_openrouter_id)) {
      result.missingFree.push({ slug: row.slug, freeId: row.free_openrouter_id });
    }
    const next = {
      input_price_per_m: perMillion(r.pricing.prompt),
      output_price_per_m: perMillion(r.pricing.completion),
      context_length: r.context_length ?? row.context_length,
    };
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
      if (Number(row[k]) !== Number(v)) {
        patch[k] = v;
        result.changes.push({ slug: row.slug, openrouterId: row.openrouter_id, field: k, from: row[k], to: v });
      }
    }
    if (Object.keys(patch).length && row.tier === "frontier") {
      patch.est_credits_per_request = seedCreditsPerRequest({ ...row, ...patch });
    }
    if (!opts.dryRun) {
      const { error: upErr } = await db
        .from("models")
        .update({ ...patch, last_synced_at: new Date().toISOString() })
        .eq("id", row.id);
      if (upErr) throw upErr;
      if (Object.keys(patch).length) result.updated++;
    }
  }
  return result;
}
