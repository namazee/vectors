import type { ModelMessage } from "ai";
import type { MessageRow } from "@/lib/types";

/**
 * Builds the model context from stored messages, newest last, trimmed to a
 * character budget (≈4 chars/token). In compare conversations, each model only
 * sees its own previous replies.
 */
export function buildHistory(
  rows: Pick<MessageRow, "role" | "content" | "model_slug" | "status">[],
  opts: { contextTokens: number | null; maxChars?: number; compareModelSlug?: string },
): ModelMessage[] {
  const budget = Math.min(opts.maxChars ?? 200_000, Math.floor((opts.contextTokens ?? 32_000) * 4 * 0.6));
  const filtered = rows.filter((m) => {
    if (m.role === "system") return false;
    if (m.role === "assistant") {
      if (!m.content.trim()) return false;
      if (opts.compareModelSlug && m.model_slug !== opts.compareModelSlug) return false;
    }
    return true;
  });

  const out: ModelMessage[] = [];
  let used = 0;
  for (let i = filtered.length - 1; i >= 0; i--) {
    const m = filtered[i];
    const len = m.content.length;
    if (used + len > budget && out.length > 0) break;
    out.unshift({ role: m.role as "user" | "assistant", content: m.content });
    used += len;
  }
  // Conversations must start with a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export function systemPrompt(modelName: string, provider: string, appName: string): string {
  const today = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
  return [
    `You are ${modelName} (by ${provider}), answering inside ${appName}, a multi-model AI chat app.`,
    `Today's date is ${today}.`,
    "Be helpful, accurate and concise. Use Markdown for structure and fenced code blocks with a language tag for code.",
    "If the user writes in Malay, Chinese or another language, reply in that language.",
  ].join(" ");
}

export function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? oneLine.slice(0, 57).trimEnd() + "…" : oneLine || "New chat";
}
