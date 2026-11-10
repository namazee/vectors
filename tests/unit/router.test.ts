import { describe, expect, it } from "vitest";
import { buildUnmeteredCandidates, streamWithFailover, type Candidate, type RouterEvent } from "@/lib/ai/router";
import type { LlmEvent, LlmStreamer } from "@/lib/ai/provider";
import type { ModelRow } from "@/lib/types";

const model = (slug: string, extra: Partial<ModelRow> = {}): ModelRow => ({
  id: slug,
  slug,
  display_name: slug.toUpperCase(),
  provider: "X",
  openrouter_id: `x/${slug}`,
  free_openrouter_id: `x/${slug}:free`,
  fallback_model_slug: null,
  tier: "unmetered",
  input_price_per_m: 0.1,
  output_price_per_m: 0.2,
  context_length: 1000,
  max_output_tokens: null,
  description: null,
  logo: null,
  active: true,
  sort_order: 1,
  est_credits_per_request: null,
  avg_credits_per_request: null,
  avg_sample_count: 0,
  margin_override: null,
  last_synced_at: null,
  ...extra,
});

function scripted(script: Record<string, LlmEvent[]>): { streamer: LlmStreamer; calls: string[] } {
  const calls: string[] = [];
  const streamer: LlmStreamer = async function* (req) {
    calls.push(req.openrouterId);
    for (const ev of script[req.openrouterId] ?? [{ type: "error", error: { status: 503, message: "down", retriable: true } }]) yield ev;
  };
  return { streamer, calls };
}

const ok = (text: string): LlmEvent[] => [
  { type: "text", text },
  { type: "done", inputTokens: 10, outputTokens: 5, costUsd: 0.0001, finishReason: "stop" },
];
const rateLimited: LlmEvent[] = [{ type: "error", error: { status: 429, message: "rate limited", retriable: true } }];

async function run(cands: Candidate[], streamer: LlmStreamer, opts: { freeOk?: boolean; paidAllowed?: boolean } = {}) {
  const events: RouterEvent[] = [];
  const cooled: string[] = [];
  for await (const ev of streamWithFailover(
    cands,
    { messages: [{ role: "user", content: "hi" }], maxOutputTokens: 100, priority: false, userId: "u" },
    {
      streamer,
      canUseFree: async () => ({ ok: opts.freeOk ?? true, reason: opts.freeOk === false ? "capacity" : null }),
      onFreeUse: async () => {},
      onRateLimited: async (c) => void cooled.push(c.openrouterId),
      paidAllowed: opts.paidAllowed ?? true,
    },
  ))
    events.push(ev);
  return { events, cooled, served: events.find((e) => e.type === "serving") as Extract<RouterEvent, { type: "serving" }> | undefined };
}

describe("unmetered failover", () => {
  const a = model("a", { fallback_model_slug: "b" });
  const b = model("b", { fallback_model_slug: "a", free_openrouter_id: null });

  it("builds free → paid → fallback chain without cycles", () => {
    expect(buildUnmeteredCandidates(a, [a, b]).map((c) => c.openrouterId)).toEqual(["x/a:free", "x/a", "x/b"]);
  });

  it("skips inactive or frontier fallbacks", () => {
    expect(buildUnmeteredCandidates(a, [a, { ...b, active: false }]).map((c) => c.openrouterId)).toEqual(["x/a:free", "x/a"]);
    expect(buildUnmeteredCandidates(a, [a, { ...b, tier: "frontier" }]).map((c) => c.openrouterId)).toEqual(["x/a:free", "x/a"]);
  });

  it("uses the free endpoint when it works", async () => {
    const { streamer } = scripted({ "x/a:free": ok("hello") });
    const r = await run(buildUnmeteredCandidates(a, [a, b]), streamer);
    expect(r.served?.candidate.endpoint).toBe("free");
  });

  it("on 429 fails over to the paid version of the same model and cools the free endpoint down", async () => {
    const { streamer, calls } = scripted({ "x/a:free": rateLimited, "x/a": ok("hello") });
    const r = await run(buildUnmeteredCandidates(a, [a, b]), streamer);
    expect(calls).toEqual(["x/a:free", "x/a"]);
    expect(r.served?.candidate.openrouterId).toBe("x/a");
    expect(r.served?.candidate.modelSlug).toBe("a");
    expect(r.cooled).toEqual(["x/a:free"]);
  });

  it("then fails over to another unmetered model", async () => {
    const { streamer } = scripted({ "x/a:free": rateLimited, "x/b": ok("from b") });
    const r = await run(buildUnmeteredCandidates(a, [a, b]), streamer);
    expect(r.served?.candidate.modelSlug).toBe("b");
    expect(r.events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text)).toEqual(["from b"]);
  });

  it("routes straight to paid when free capacity is near the account limit", async () => {
    const { streamer, calls } = scripted({ "x/a": ok("paid") });
    const r = await run(buildUnmeteredCandidates(a, [a, b]), streamer, { freeOk: false });
    expect(calls).toEqual(["x/a"]);
    expect(r.served?.skipped[0].reason).toBe("capacity");
  });

  it("uses free endpoints only once the spend cap blocks paid fallbacks", async () => {
    const { streamer, calls } = scripted({ "x/a:free": rateLimited });
    const r = await run(buildUnmeteredCandidates(a, [a, b]), streamer, { paidAllowed: false });
    expect(calls).toEqual(["x/a:free"]);
    expect(r.events.at(-1)).toMatchObject({ type: "error", startedOutput: false });
  });

  it("never switches models after output has started", async () => {
    const { streamer, calls } = scripted({
      "x/a:free": [
        { type: "text", text: "partial" },
        { type: "error", error: { status: 502, message: "broken", retriable: true } },
      ],
    });
    const r = await run(buildUnmeteredCandidates(a, [a, b]), streamer);
    expect(calls).toEqual(["x/a:free"]);
    expect(r.events.at(-1)).toMatchObject({ type: "error", startedOutput: true });
  });
});
