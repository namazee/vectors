import type { UIMessage } from "ai";
import { z } from "zod";
import type { Wallet } from "@/lib/types";

/** Metadata attached to each assistant message in the UI. */
export interface ChatMetadata {
  modelSlug?: string;
  modelName?: string;
  /** OpenRouter endpoint that actually answered. */
  servedModel?: string;
  /** Display name of the model that answered, when it differs from the one picked. */
  servedModelName?: string;
  credits?: number;
  status?: "complete" | "stopped" | "error";
  notice?: string;
  createdAt?: string;
}

export type ChatDataParts = {
  conversation: { id: string; title: string };
  wallet: Wallet;
};

export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataParts>;

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().nullish(),
  model: z.string().min(1).max(80),
  trigger: z.enum(["submit", "regenerate", "compare"]),
  text: z.string().trim().min(1, "Message can't be empty.").max(32_000, "Message is too long (max 32,000 characters).").optional(),
  compareGroup: z.string().uuid().optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type ChatErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "rate_limited"
  | "insufficient_credits"
  | "fair_use_limit"
  | "frontier_paused"
  | "model_unavailable"
  | "capacity_busy"
  | "pro_required"
  | "server_error";

export interface ChatErrorBody {
  code: ChatErrorCode;
  message: string;
  available?: number;
  required?: number;
  plan?: "free" | "pro";
}

/** Parses an error thrown by useChat (the response body as text) into our error shape. */
export function parseChatError(err: unknown): ChatErrorBody {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  try {
    const j = JSON.parse(raw);
    if (j?.error?.code) return j.error as ChatErrorBody;
    if (j?.code) return j as ChatErrorBody;
  } catch {
    /* not JSON */
  }
  if (/failed to fetch|network/i.test(raw)) return { code: "server_error", message: "Network error. Check your connection and try again." };
  return { code: "server_error", message: raw || "Something went wrong. Please try again." };
}
