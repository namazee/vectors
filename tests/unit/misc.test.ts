import { describe, expect, it } from "vitest";
import { klDate, nextKlMidnight, secondsUntilKlMidnight } from "@/lib/time";
import { buildHistory, titleFrom } from "@/lib/chat/history";
import { affordableMaxTokens, creditsForCost, maxCreditsForRequest, seedCreditsPerRequest } from "@/lib/credits/pricing";
import { computeSpendState } from "@/lib/capacity";
import { parseChatError } from "@/lib/chat/types";

describe("Kuala Lumpur day boundaries", () => {
  it("rolls over at 16:00 UTC", () => {
    expect(klDate(new Date("2026-03-01T15:59:59Z"))).toBe("2026-03-01");
    expect(klDate(new Date("2026-03-01T16:00:00Z"))).toBe("2026-03-02");
  });
  it("computes the next midnight", () => {
    expect(nextKlMidnight(new Date("2026-03-01T10:00:00Z")).toISOString()).toBe("2026-03-01T16:00:00.000Z");
    expect(nextKlMidnight(new Date("2026-03-01T17:00:00Z")).toISOString()).toBe("2026-03-02T16:00:00.000Z");
    expect(secondsUntilKlMidnight(new Date("2026-03-01T15:00:00Z"))).toBe(3600);
  });
});

describe("credit pricing", () => {
  const sonnet = { input_price_per_m: 2, output_price_per_m: 10, tier: "frontier" as const };
  it("charges cost / rate × margin with a minimum", () => {
    expect(creditsForCost(0.01, sonnet, { creditRateUsd: 0.001, marginMultiplier: 1.5, minChargePerRequest: 0.1 })).toBe(15);
    expect(creditsForCost(0.000001, sonnet, { creditRateUsd: 0.001, marginMultiplier: 1.5, minChargePerRequest: 0.1 })).toBe(0.1);
    expect(creditsForCost(0, sonnet)).toBe(0);
    expect(creditsForCost(1, { ...sonnet, tier: "unmetered" })).toBe(0);
  });
  it("respects per-model margin overrides", () => {
    expect(creditsForCost(0.01, { ...sonnet, margin_override: 2 }, { creditRateUsd: 0.001, marginMultiplier: 1.5, minChargePerRequest: 0 })).toBe(20);
  });
  it("affordable output budget never exceeds the balance", () => {
    const s = { creditRateUsd: 0.001, marginMultiplier: 1.5, minChargePerRequest: 0 };
    const tokens = affordableMaxTokens(sonnet, 1000, 10, 100_000, s);
    expect(maxCreditsForRequest(sonnet, 1000, tokens, s)).toBeLessThanOrEqual(10.0001);
    expect(affordableMaxTokens(sonnet, 1000, 10, 50, s)).toBe(50);
    expect(affordableMaxTokens(sonnet, 10_000_000, 1, 1000, s)).toBe(0);
  });
  it("seed estimate is positive for frontier models", () => {
    expect(seedCreditsPerRequest(sonnet)).toBeGreaterThan(0);
  });
});

describe("spend cap", () => {
  it("pauses frontier at 100% and keeps paid fallbacks until headroom", () => {
    const s = (spent: number) => computeSpendState(spent, { spendCapUsd: 100, frontierManuallyPaused: false });
    expect(s(79).frontierPaused).toBe(false);
    expect(s(100).frontierPaused).toBe(true);
    expect(s(100).unmeteredPaidAllowed).toBe(true);
    expect(s(111).unmeteredPaidAllowed).toBe(false);
    expect(computeSpendState(0, { spendCapUsd: 100, frontierManuallyPaused: true }).frontierPaused).toBe(true);
  });
});

describe("chat helpers", () => {
  it("trims history to the budget and starts with a user turn", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: "x".repeat(100),
      model_slug: "m",
      status: "complete" as const,
    }));
    const h = buildHistory(rows, { contextTokens: 1000, maxChars: 350 });
    expect(h.length).toBeLessThanOrEqual(4);
    expect(h[0].role).toBe("user");
  });
  it("compare history only includes the model's own replies", () => {
    const rows = [
      { role: "user" as const, content: "q", model_slug: null, status: "complete" as const },
      { role: "assistant" as const, content: "a1", model_slug: "a", status: "complete" as const },
      { role: "assistant" as const, content: "b1", model_slug: "b", status: "complete" as const },
    ];
    expect(buildHistory(rows, { contextTokens: 1000, compareModelSlug: "b" }).map((m) => m.content)).toEqual(["q", "b1"]);
  });
  it("titles are trimmed", () => {
    expect(titleFrom("  hello\n world ")).toBe("hello world");
    expect(titleFrom("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });
  it("parses API errors from useChat", () => {
    expect(parseChatError(new Error(JSON.stringify({ error: { code: "insufficient_credits", message: "x" } }))).code).toBe("insufficient_credits");
    expect(parseChatError(new Error('{"code":"capacity_busy","message":"busy"}')).code).toBe("capacity_busy");
    expect(parseChatError(new Error("boom")).code).toBe("server_error");
  });
});
