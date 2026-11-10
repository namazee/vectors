import type { LlmEvent, LlmStreamer, StreamRequest, UpstreamError } from "@/lib/ai/provider";
import type { ModelRow } from "@/lib/types";

export interface Candidate {
  modelSlug: string;
  modelName: string;
  openrouterId: string;
  endpoint: "free" | "paid";
  inputPricePerM: number;
  outputPricePerM: number;
}

const MAX_CHAIN_MODELS = 4;

/**
 * Failover chain for an unmetered model:
 *   model:free → model (paid) → fallback:free → fallback (paid) → …
 * Only active unmetered models are used as fallbacks. Cycles are ignored.
 */
export function buildUnmeteredCandidates(model: ModelRow, all: ModelRow[]): Candidate[] {
  const bySlug = new Map(all.map((m) => [m.slug, m]));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let current: ModelRow | undefined = model;
  while (current && !seen.has(current.slug) && seen.size < MAX_CHAIN_MODELS) {
    seen.add(current.slug);
    const base = {
      modelSlug: current.slug,
      modelName: current.display_name,
      inputPricePerM: Number(current.input_price_per_m),
      outputPricePerM: Number(current.output_price_per_m),
    };
    if (current.free_openrouter_id) out.push({ ...base, openrouterId: current.free_openrouter_id, endpoint: "free" });
    out.push({ ...base, openrouterId: current.openrouter_id, endpoint: "paid" });
    const next: ModelRow | undefined = current.fallback_model_slug ? bySlug.get(current.fallback_model_slug) : undefined;
    current = next && next.active && next.tier === "unmetered" ? next : undefined;
  }
  return out;
}

export function buildFrontierCandidates(model: ModelRow): Candidate[] {
  return [
    {
      modelSlug: model.slug,
      modelName: model.display_name,
      openrouterId: model.openrouter_id,
      endpoint: "paid",
      inputPricePerM: Number(model.input_price_per_m),
      outputPricePerM: Number(model.output_price_per_m),
    },
  ];
}

export type RouterEvent =
  | Exclude<LlmEvent, { type: "error" }>
  | { type: "serving"; candidate: Candidate; skipped: { candidate: Candidate; reason: string }[] }
  | { type: "error"; error: UpstreamError; startedOutput: boolean };

export interface RouterDeps {
  streamer: LlmStreamer;
  canUseFree: (c: Candidate) => Promise<{ ok: boolean; reason: string | null }>;
  onFreeUse: (c: Candidate) => Promise<void>;
  onRateLimited: (c: Candidate) => Promise<void>;
  /** False once the spend cap headroom is used up: only free endpoints remain. */
  paidAllowed: boolean;
}

/**
 * Tries candidates in order. Fails over only while nothing has been streamed
 * to the user yet; once text flows, the answer is committed to that endpoint.
 */
export async function* streamWithFailover(
  candidates: Candidate[],
  req: Omit<StreamRequest, "openrouterId">,
  deps: RouterDeps,
): AsyncGenerator<RouterEvent> {
  const skipped: { candidate: Candidate; reason: string }[] = [];
  let lastError: UpstreamError = { status: 503, message: "No model is available right now.", retriable: true };

  for (const c of candidates) {
    if (req.abortSignal?.aborted) {
      yield { type: "aborted" };
      return;
    }
    if (c.endpoint === "free") {
      const check = await deps.canUseFree(c);
      if (!check.ok) {
        skipped.push({ candidate: c, reason: check.reason ?? "free capacity" });
        continue;
      }
      await deps.onFreeUse(c);
    } else if (!deps.paidAllowed) {
      skipped.push({ candidate: c, reason: "paid fallback paused (spend cap)" });
      continue;
    }

    let started = false;
    for await (const ev of deps.streamer({ ...req, openrouterId: c.openrouterId })) {
      if (!started) {
        if (ev.type === "error") {
          lastError = ev.error;
          if (ev.error.status === 429 && c.endpoint === "free") await deps.onRateLimited(c);
          skipped.push({ candidate: c, reason: ev.error.status === 429 ? "rate limited" : ev.error.message.slice(0, 120) });
          break; // try the next candidate
        }
        if (ev.type === "aborted") {
          yield ev;
          return;
        }
        // First real output (or a clean empty completion): commit to this candidate.
        started = true;
        yield { type: "serving", candidate: c, skipped };
      }
      if (ev.type === "error") {
        yield { type: "error", error: ev.error, startedOutput: true };
        return;
      }
      yield ev;
      if (ev.type === "done" || ev.type === "aborted") return;
    }
    if (started) return;
  }
  yield { type: "error", error: lastError, startedOutput: false };
}
