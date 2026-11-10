import "server-only";
import { CREDITS, getPlan } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { klDate } from "@/lib/time";
import type { PlanId, Wallet } from "@/lib/types";

/** Thin wrappers over the SQL credit functions (see supabase/migrations/*_credit_functions.sql). */

const dailyAmount = (plan: PlanId) => getPlan(plan).dailyCredits;

function rpcError(fn: string, error: { message: string } | null) {
  if (error) throw new Error(`${fn} failed: ${error.message}`);
}

export async function getWallet(userId: string, plan: PlanId): Promise<Wallet> {
  const { data, error } = await createAdminClient().rpc("get_wallet", {
    p_user: userId,
    p_daily_amount: dailyAmount(plan),
    p_today: klDate(),
    p_hold_ttl_minutes: CREDITS.holdTtlMinutes,
  });
  rpcError("get_wallet", error);
  return {
    daily: Number(data.daily),
    topup: Number(data.topup),
    held: Number(data.held),
    available: Number(data.available),
    daily_date: data.daily_date,
  };
}

export async function reserveCredits(args: {
  userId: string;
  plan: PlanId;
  estimate: number;
  modelSlug: string;
  conversationId: string | null;
}): Promise<{ ok: true; usageLogId: string } | { ok: false; available: number; required: number }> {
  const { data, error } = await createAdminClient().rpc("reserve_credits", {
    p_user: args.userId,
    p_daily_amount: dailyAmount(args.plan),
    p_estimate: args.estimate,
    p_model_slug: args.modelSlug,
    p_plan: args.plan,
    p_conversation_id: args.conversationId,
    p_today: klDate(),
    p_hold_ttl_minutes: CREDITS.holdTtlMinutes,
  });
  rpcError("reserve_credits", error);
  if (!data.ok) return { ok: false, available: Number(data.available), required: Number(data.required) };
  return { ok: true, usageLogId: data.usage_log_id };
}

export async function settleUsage(args: {
  usageLogId: string;
  plan: PlanId;
  credits: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  servedModel: string;
  latencyMs: number;
}): Promise<{ charged: number }> {
  const { data, error } = await createAdminClient().rpc("settle_usage", {
    p_log_id: args.usageLogId,
    p_credits: args.credits,
    p_cost_usd: args.costUsd,
    p_input_tokens: args.inputTokens,
    p_output_tokens: args.outputTokens,
    p_served_model: args.servedModel,
    p_daily_amount: dailyAmount(args.plan),
    p_latency_ms: args.latencyMs,
    p_today: klDate(),
    p_avg_window: CREDITS.rollingAverageWindow,
  });
  rpcError("settle_usage", error);
  return { charged: Number(data.charged) };
}

export async function releaseHold(usageLogId: string, reason: string, costUsd = 0) {
  const { error } = await createAdminClient().rpc("release_hold", {
    p_log_id: usageLogId,
    p_error: reason.slice(0, 500),
    p_cost_usd: costUsd,
  });
  rpcError("release_hold", error);
}

export async function refundUsage(usageLogId: string, plan: PlanId, reason: string) {
  const { data, error } = await createAdminClient().rpc("refund_usage", {
    p_log_id: usageLogId,
    p_daily_amount: dailyAmount(plan),
    p_reason: reason,
    p_today: klDate(),
  });
  rpcError("refund_usage", error);
  return Number(data.refunded);
}

export async function logUnmeteredUsage(args: {
  userId: string;
  conversationId: string | null;
  modelSlug: string;
  servedModel: string | null;
  plan: PlanId;
  endpoint: "free" | "paid" | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  fallbackReason: string | null;
  latencyMs: number;
  status: "settled" | "failed";
  error?: string | null;
}): Promise<string> {
  const { data, error } = await createAdminClient().rpc("log_unmetered_usage", {
    p_user: args.userId,
    p_conversation_id: args.conversationId,
    p_model_slug: args.modelSlug,
    p_served_model: args.servedModel,
    p_plan: args.plan,
    p_endpoint: args.endpoint,
    p_input_tokens: args.inputTokens,
    p_output_tokens: args.outputTokens,
    p_cost_usd: args.costUsd,
    p_fallback_reason: args.fallbackReason,
    p_latency_ms: args.latencyMs,
    p_status: args.status,
    p_error: args.error ?? null,
  });
  rpcError("log_unmetered_usage", error);
  return data as string;
}

export async function grantTopup(userId: string, credits: number, reference: string, note?: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("grant_topup", {
    p_user: userId,
    p_credits: credits,
    p_reference: reference,
    p_note: note ?? "Top-up purchase",
  });
  rpcError("grant_topup", error);
  return Boolean(data);
}

export async function adminAdjustCredits(args: {
  userId: string;
  plan: PlanId;
  amount: number;
  bucket: "daily" | "topup";
  note: string;
  adminId: string;
}) {
  const { data, error } = await createAdminClient().rpc("admin_adjust_credits", {
    p_user: args.userId,
    p_amount: args.amount,
    p_bucket: args.bucket,
    p_note: args.note,
    p_admin: args.adminId,
    p_daily_amount: dailyAmount(args.plan),
    p_today: klDate(),
  });
  rpcError("admin_adjust_credits", error);
  return Number(data.applied);
}
