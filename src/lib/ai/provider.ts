import "server-only";
import { streamText, type ModelMessage } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { siteUrl } from "@/lib/env";
import { BRAND } from "@/config/plans";

/** Events emitted by one upstream attempt. */
export type LlmEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "done"; inputTokens: number; outputTokens: number; costUsd: number | null; finishReason: string }
  | { type: "aborted" }
  | { type: "error"; error: UpstreamError };

export interface UpstreamError {
  status: number | null;
  message: string;
  /** Capacity/rate-limit style errors where trying another endpoint makes sense. */
  retriable: boolean;
}

export interface StreamRequest {
  openrouterId: string;
  messages: ModelMessage[];
  instructions?: string;
  maxOutputTokens: number;
  priority: boolean;
  userId: string;
  abortSignal?: AbortSignal;
}

export type LlmStreamer = (req: StreamRequest) => AsyncIterable<LlmEvent>;

let openrouter: ReturnType<typeof createOpenRouter> | null = null;
function getOpenRouter() {
  if (!openrouter) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    openrouter = createOpenRouter({
      apiKey,
      baseURL: process.env.OPENROUTER_BASE_URL || undefined,
      headers: { "HTTP-Referer": siteUrl(), "X-Title": BRAND.appName },
    });
  }
  return openrouter;
}

export function classifyError(err: unknown): UpstreamError {
  const e = err as { statusCode?: number; status?: number; message?: string; responseBody?: string; cause?: unknown };
  const status = e?.statusCode ?? e?.status ?? null;
  const message = String(e?.message ?? err ?? "Unknown error");
  const body = String(e?.responseBody ?? "");
  const text = (message + " " + body).toLowerCase();
  const retriable =
    status === 429 ||
    status === 408 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (status !== null && status >= 500) ||
    /rate.?limit|capacity|overloaded|temporarily|no endpoints|unavailable|timeout|upstream/.test(text) ||
    // A model that was removed/renamed upstream: let failover pick another.
    status === 404;
  return { status, message, retriable };
}

/** Real OpenRouter streamer built on the Vercel AI SDK. */
export const openRouterStreamer: LlmStreamer = async function* (req) {
  let model;
  try {
    model = getOpenRouter()(req.openrouterId, {
      usage: { include: true },
      user: req.userId,
      ...(req.priority ? { provider: { sort: "throughput" } } : {}),
    });
  } catch (err) {
    yield { type: "error", error: { status: null, message: String((err as Error).message), retriable: false } };
    return;
  }

  const result = streamText({
    model,
    instructions: req.instructions,
    messages: req.messages,
    maxOutputTokens: req.maxOutputTokens,
    abortSignal: req.abortSignal,
    maxRetries: 0, // we fail over ourselves
  });

  let costUsd: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    for await (const part of result.stream) {
      switch (part.type) {
        case "text-delta":
          if (part.text) yield { type: "text", text: part.text };
          break;
        case "reasoning-delta":
          if (part.text) yield { type: "reasoning", text: part.text };
          break;
        case "finish-step": {
          const meta = part.providerMetadata?.openrouter as { usage?: { cost?: number } } | undefined;
          if (typeof meta?.usage?.cost === "number") costUsd = (costUsd ?? 0) + meta.usage.cost;
          inputTokens += part.usage.inputTokens ?? 0;
          outputTokens += part.usage.outputTokens ?? 0;
          break;
        }
        case "finish":
          yield { type: "done", inputTokens, outputTokens, costUsd, finishReason: part.finishReason };
          return;
        case "abort":
          yield { type: "aborted" };
          return;
        case "error":
          yield { type: "error", error: classifyError(part.error) };
          return;
      }
    }
  } catch (err) {
    if (req.abortSignal?.aborted) {
      yield { type: "aborted" };
      return;
    }
    yield { type: "error", error: classifyError(err) };
  }
};

/**
 * Deterministic mock used when MOCK_AI=1 (local demos, E2E tests, CI).
 * Streams a canned markdown answer and reports a synthetic cost.
 */
export const mockStreamer: LlmStreamer = async function* (req) {
  const last = req.messages.filter((m) => m.role === "user").at(-1);
  const prompt = typeof last?.content === "string" ? last.content : "your message";
  if (/\[fail\]/i.test(prompt) && req.openrouterId.endsWith(":free")) {
    yield { type: "error", error: { status: 429, message: "Rate limit exceeded (mock)", retriable: true } };
    return;
  }
  const answer =
    `**Mock reply from \`${req.openrouterId}\`**\n\nYou said: _${prompt.slice(0, 200)}_\n\n` +
    "Here is a code block:\n\n```ts\nconst greet = (name: string) => `Hello, ${name}!`;\n```\n\n- Set `MOCK_AI=0` and add an OpenRouter key for real answers.";
  const words = answer.split(/(\s+)/);
  for (const w of words) {
    if (req.abortSignal?.aborted) {
      yield { type: "aborted" };
      return;
    }
    await new Promise((r) => setTimeout(r, 8));
    yield { type: "text", text: w };
  }
  const inputTokens = Math.ceil(JSON.stringify(req.messages).length / 4);
  const outputTokens = Math.ceil(answer.length / 4);
  const free = req.openrouterId.endsWith(":free");
  yield { type: "done", inputTokens, outputTokens, costUsd: free ? 0 : (inputTokens * 2 + outputTokens * 10) / 1e6, finishReason: "stop" };
};

export function getStreamer(): LlmStreamer {
  return process.env.MOCK_AI === "1" ? mockStreamer : openRouterStreamer;
}
