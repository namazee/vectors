import { after } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { BRAND, CREDITS, getPlan } from "@/config/plans";
import { errorResponse, HttpError, requireApiUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import { getAllModels } from "@/lib/models/catalog";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildHistory, systemPrompt, titleFrom } from "@/lib/chat/history";
import { chatRequestSchema, type ChatErrorBody, type ChatUIMessage } from "@/lib/chat/types";
import {
  affordableMaxTokens,
  creditsForCost,
  estimateTokens,
  maxCreditsForRequest,
  tokenCostUsd,
} from "@/lib/credits/pricing";
import { getWallet, logUnmeteredUsage, releaseHold, reserveCredits, settleUsage } from "@/lib/credits/ledger";
import {
  canUseFreeEndpoint,
  coolDownFreeEndpoint,
  getSpendState,
  getUnmeteredUsedToday,
  incrementUnmeteredUse,
  recordFreeEndpointUse,
  recordPaidSpend,
} from "@/lib/capacity";
import { buildFrontierCandidates, buildUnmeteredCandidates, streamWithFailover, type Candidate } from "@/lib/ai/router";
import { getStreamer } from "@/lib/ai/provider";
import type { MessageRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Smallest output budget we accept before telling the user they're out of credits. */
const MIN_OUTPUT_TOKENS = 256;

function chatError(status: number, body: ChatErrorBody): never {
  const { code, message, ...extra } = body;
  throw new HttpError(status, code, message, extra);
}

export async function POST(req: Request) {
  try {
    const { userId, profile } = await requireApiUser();
    const plan = getPlan(profile.plan);

    const rl = await rateLimit(`chat:${userId}`, plan.chatRequestsPerMinute, 60);
    if (!rl.ok) chatError(429, { code: "rate_limited", message: "You're sending messages too quickly. Please wait a moment." });

    const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) chatError(400, { code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid request." });
    const input = parsed.data;
    if (input.trigger === "submit" && !input.text) chatError(400, { code: "invalid_request", message: "Message can't be empty." });
    if (input.trigger === "compare") {
      if (!plan.compareMode) chatError(403, { code: "pro_required", message: "Compare mode is a Pro feature.", plan: plan.id });
      if (!input.conversationId || !input.compareGroup)
        chatError(400, { code: "invalid_request", message: "Missing compare conversation." });
    }

    const [settings, models] = await Promise.all([getSettings(), getAllModels()]);
    const model = models.find((m) => m.slug === input.model && m.active);
    if (!model) chatError(404, { code: "model_unavailable", message: "That model isn't available right now. Please pick another." });
    const isFrontier = model.tier === "frontier";

    const admin = createAdminClient();

    // ---- Conversation ---------------------------------------------------------------
    let conversation: { id: string; title: string; is_compare: boolean } | null = null;
    let isNewConversation = false;
    if (input.conversationId) {
      const { data } = await admin
        .from("conversations")
        .select("id, title, is_compare")
        .eq("id", input.conversationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) chatError(404, { code: "invalid_request", message: "Conversation not found." });
      conversation = data;
    } else if (input.trigger !== "submit") {
      chatError(400, { code: "invalid_request", message: "Nothing to regenerate." });
    }

    // ---- Gates (before anything is written) -----------------------------------------
    const spend = await getSpendState(settings);
    if (isFrontier && spend.frontierPaused) {
      chatError(503, {
        code: "frontier_paused",
        message: "Frontier models are taking a short break due to high demand. Unmetered models are still available.",
      });
    }
    if (!isFrontier) {
      const cap = plan.id === "pro" ? settings.unmeteredCapPro : settings.unmeteredCapFree;
      const used = await getUnmeteredUsedToday(userId);
      if (used >= cap) {
        chatError(429, {
          code: "fair_use_limit",
          message: `You've reached today's fair-use limit of ${cap} messages on unmetered models. It resets at midnight (Malaysia time).`,
          plan: plan.id,
        });
      }
    }

    // ---- History ---------------------------------------------------------------------
    let rows: Pick<MessageRow, "id" | "role" | "content" | "model_slug" | "status" | "compare_group">[] = [];
    if (conversation) {
      const { data } = await admin
        .from("messages")
        .select("id, role, content, model_slug, status, compare_group, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(200);
      rows = (data ?? []).reverse();
    }

    const toDelete: string[] = [];
    if (input.trigger === "regenerate") {
      while (rows.length && rows[rows.length - 1].role === "assistant") toDelete.push(rows.pop()!.id);
      if (!rows.length) chatError(400, { code: "invalid_request", message: "Nothing to regenerate." });
    }
    if (input.trigger === "compare") {
      // Drop any earlier reply from this model to the same prompt (re-run).
      rows = rows.filter((r) => {
        const stale = r.role === "assistant" && r.compare_group === input.compareGroup && r.model_slug === model.slug;
        if (stale) toDelete.push(r.id);
        return !stale;
      });
    }
    const pendingUserText = input.trigger === "submit" ? input.text! : null;
    const historyRows = pendingUserText
      ? [...rows, { id: "pending", role: "user" as const, content: pendingUserText, model_slug: null, status: "complete" as const, compare_group: null }]
      : rows;

    const history = buildHistory(historyRows, {
      contextTokens: model.context_length,
      compareModelSlug: input.trigger === "compare" ? model.slug : undefined,
    });
    if (!history.length) chatError(400, { code: "invalid_request", message: "Nothing to send." });
    const instructions = systemPrompt(model.display_name, model.provider, BRAND.appName);
    const inputTokensEst = estimateTokens(instructions + history.map((m) => String(m.content)).join("\n"));
    const modelMaxOut = model.max_output_tokens ?? CREDITS.defaultMaxOutputTokens;

    // ---- Credit hold (frontier) ---------------------------------------------------------
    let usageLogId: string | null = null;
    let maxOutputTokens = modelMaxOut;
    if (isFrontier) {
      const wallet = await getWallet(userId, plan.id);
      maxOutputTokens = affordableMaxTokens(model, inputTokensEst, wallet.available, modelMaxOut);
      if (maxOutputTokens < MIN_OUTPUT_TOKENS) {
        chatError(402, {
          code: "insufficient_credits",
          message: `Not enough ${BRAND.creditName} for ${model.display_name}. Top up, upgrade to Pro, or use an unmetered model.`,
          available: wallet.available,
          required: maxCreditsForRequest(model, inputTokensEst, MIN_OUTPUT_TOKENS),
          plan: plan.id,
        });
      }
      const estimate = maxCreditsForRequest(model, inputTokensEst, maxOutputTokens);
      const hold = await reserveCredits({
        userId,
        plan: plan.id,
        estimate,
        modelSlug: model.slug,
        conversationId: conversation?.id ?? null,
      });
      if (!hold.ok) {
        chatError(402, {
          code: "insufficient_credits",
          message: `Not enough ${BRAND.creditName} for ${model.display_name}. Top up, upgrade to Pro, or use an unmetered model.`,
          available: hold.available,
          required: hold.required,
          plan: plan.id,
        });
      }
      usageLogId = hold.usageLogId;
    } else {
      await incrementUnmeteredUse(userId);
    }

    // ---- Persist the turn ------------------------------------------------------------------
    if (!conversation) {
      const { data, error } = await admin
        .from("conversations")
        .insert({ user_id: userId, title: titleFrom(pendingUserText!), model_slug: model.slug })
        .select("id, title, is_compare")
        .single();
      if (error) {
        if (usageLogId) await releaseHold(usageLogId, "conversation insert failed");
        throw error;
      }
      conversation = data;
      isNewConversation = true;
      if (usageLogId) await admin.from("usage_logs").update({ conversation_id: data.id }).eq("id", usageLogId);
    }
    const conv = conversation!;
    if (toDelete.length) await admin.from("messages").delete().in("id", toDelete).eq("user_id", userId);
    if (pendingUserText) {
      await admin.from("messages").insert({ conversation_id: conv.id, user_id: userId, role: "user", content: pendingUserText });
    }
    await admin.from("conversations").update({ updated_at: new Date().toISOString(), model_slug: model.slug }).eq("id", conv.id);

    // ---- Stream ------------------------------------------------------------------------------
    const candidates: Candidate[] = isFrontier ? buildFrontierCandidates(model) : buildUnmeteredCandidates(model, models);
    const startedAt = Date.now();
    let finished!: () => void;
    const finishedPromise = new Promise<void>((r) => (finished = r));
    // Keep the function alive until credits are settled, even if the client disconnects.
    after(() => finishedPromise);

    const stream = createUIMessageStream<ChatUIMessage>({
      onError: () => JSON.stringify({ code: "server_error", message: "Something went wrong. Please try again." }),
      execute: async ({ writer }) => {
        const write = (chunk: Parameters<typeof writer.write>[0]) => {
          try {
            writer.write(chunk);
          } catch {
            /* client went away */
          }
        };

        let text = "";
        let served: Candidate | null = null;
        let notice: string | undefined;
        let fallbackReason: string | null = null;
        let done: { inputTokens: number; outputTokens: number; costUsd: number | null } | null = null;
        let aborted = false;
        let upstreamError: { message: string; status: number | null } | null = null;
        let textOpen = false;

        try {
          write({
            type: "start",
            messageMetadata: { modelSlug: model.slug, modelName: model.display_name, createdAt: new Date().toISOString() },
          });
          if (isNewConversation) write({ type: "data-conversation", data: { id: conv.id, title: conv.title }, transient: true });

          const events = streamWithFailover(
            candidates,
            { messages: history, instructions, maxOutputTokens, priority: plan.priorityRouting, userId, abortSignal: req.signal },
            {
              streamer: getStreamer(),
              canUseFree: (c) => canUseFreeEndpoint(c.openrouterId, plan.id === "pro", settings),
              onFreeUse: () => recordFreeEndpointUse(),
              onRateLimited: (c) => coolDownFreeEndpoint(c.openrouterId),
              paidAllowed: isFrontier || spend.unmeteredPaidAllowed,
            },
          );

          for await (const ev of events) {
            if (ev.type === "serving") {
              served = ev.candidate;
              if (ev.skipped.length) fallbackReason = ev.skipped.map((s) => `${s.candidate.openrouterId}: ${s.reason}`).join("; ");
              if (served.modelSlug !== model.slug) {
                notice = `${model.display_name} is busy right now, so ${served.modelName} answered instead.`;
                write({ type: "message-metadata", messageMetadata: { notice, servedModelName: served.modelName } });
              }
            } else if (ev.type === "text") {
              if (!textOpen) {
                write({ type: "text-start", id: "t1" });
                textOpen = true;
              }
              text += ev.text;
              write({ type: "text-delta", id: "t1", delta: ev.text });
            } else if (ev.type === "done") {
              done = ev;
            } else if (ev.type === "aborted") {
              aborted = true;
            } else if (ev.type === "error") {
              upstreamError = { message: ev.error.message, status: ev.error.status };
            }
          }
        } catch (e) {
          upstreamError = { message: String((e as Error)?.message ?? e), status: null };
        }
        if (textOpen) write({ type: "text-end", id: "t1" });

        // ---- Settle --------------------------------------------------------------------------
        try {
          const latencyMs = Date.now() - startedAt;
          const outputTokens = done?.outputTokens || estimateTokens(text);
          const inputTokens = done?.inputTokens || inputTokensEst;
          const s = served as Candidate | null;
          const costUsd =
            s?.endpoint === "free"
              ? 0
              : (done?.costUsd ??
                (s ? tokenCostUsd({ input_price_per_m: s.inputPricePerM, output_price_per_m: s.outputPricePerM }, inputTokens, text ? outputTokens : 0) : 0));
          const status: "complete" | "stopped" | "error" = upstreamError ? "error" : aborted ? "stopped" : "complete";
          // Charge only for answers the user actually received (complete or stopped by them).
          const chargeable = text.length > 0 && !upstreamError;

          let credits = 0;
          let logId = usageLogId;
          if (isFrontier && usageLogId) {
            if (chargeable) {
              credits = creditsForCost(costUsd, model);
              const r = await settleUsage({
                usageLogId,
                plan: plan.id,
                credits,
                costUsd,
                inputTokens,
                outputTokens,
                servedModel: s?.openrouterId ?? model.openrouter_id,
                latencyMs,
              });
              credits = r.charged;
            } else {
              await releaseHold(usageLogId, upstreamError?.message ?? (aborted ? "Stopped before any output" : "No output"), costUsd);
            }
          } else if (!isFrontier) {
            logId = await logUnmeteredUsage({
              userId,
              conversationId: conv.id,
              modelSlug: model.slug,
              servedModel: s?.openrouterId ?? null,
              plan: plan.id,
              endpoint: s?.endpoint ?? null,
              inputTokens,
              outputTokens,
              costUsd,
              fallbackReason,
              latencyMs,
              status: chargeable || aborted ? "settled" : "failed",
              error: upstreamError?.message ?? null,
            });
          }
          if (s?.endpoint === "paid" && costUsd > 0) await recordPaidSpend(costUsd, settings);

          if (text.length > 0) {
            await admin.from("messages").insert({
              conversation_id: conv.id,
              user_id: userId,
              role: "assistant",
              content: text,
              model_slug: s?.modelSlug ?? model.slug,
              served_model: s?.openrouterId ?? null,
              credits_used: credits,
              usage_log_id: logId,
              compare_group: input.compareGroup ?? null,
              status,
              notice: notice ?? null,
            });
          }

          write({
            type: "message-metadata",
            messageMetadata: { credits, status, servedModel: s?.openrouterId, notice },
          });
          if (isFrontier) write({ type: "data-wallet", data: await getWallet(userId, plan.id), transient: true });

          if (upstreamError && !text) {
            const busy = upstreamError.status === 429 || (upstreamError.status ?? 0) >= 500 || upstreamError.status === null;
            write({
              type: "error",
              errorText: JSON.stringify({
                code: busy ? "capacity_busy" : "model_unavailable",
                message: busy
                  ? `${model.display_name} is busy right now. Your ${BRAND.creditName} were not charged. Please try again or pick another model.`
                  : `${model.display_name} couldn't answer this request. Your ${BRAND.creditName} were not charged.`,
              } satisfies ChatErrorBody),
            });
          } else if (upstreamError) {
            write({
              type: "error",
              errorText: JSON.stringify({
                code: "model_unavailable",
                message: `The answer was cut off by a provider error. You weren't charged for it. Try regenerating.`,
              } satisfies ChatErrorBody),
            });
          }
          write({ type: "finish" });
        } catch (e) {
          console.error("[chat] settle failed", e);
          // Never leave a hold dangling: release it (stale-hold cron is the last resort).
          if (usageLogId) await releaseHold(usageLogId, "settle failed").catch(() => {});
          write({ type: "error", errorText: JSON.stringify({ code: "server_error", message: "Something went wrong saving this reply." }) });
        } finally {
          finished();
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (e) {
    return errorResponse(e);
  }
}
