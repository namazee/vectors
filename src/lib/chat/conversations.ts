import "server-only";
import { getPlan } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Conversation, MessageRow, PlanId } from "@/lib/types";

const COLUMNS = "id, title, model_slug, is_compare, created_at, updated_at";

/** Most recent conversations visible on the user's plan (Free keeps the latest N). */
export async function listConversations(userId: string, planId: PlanId, search?: string): Promise<Conversation[]> {
  const limit = getPlan(planId).historyConversationLimit;
  const admin = createAdminClient();
  let visibleIds: string[] | null = null;
  if (limit != null && search) {
    // Search only within the visible window.
    const { data } = await admin
      .from("conversations")
      .select("id")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);
    visibleIds = (data ?? []).map((r) => r.id as string);
  }
  let q = admin.from("conversations").select(COLUMNS).eq("user_id", userId).order("updated_at", { ascending: false });
  if (search) {
    const term = search.replace(/[%_,()]/g, " ").trim();
    if (term) q = q.ilike("title", `%${term}%`);
    if (visibleIds) q = q.in("id", visibleIds.length ? visibleIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  q = q.limit(limit ?? 500);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export type ConversationAccess =
  | { ok: true; conversation: Conversation; messages: MessageRow[] }
  | { ok: false; reason: "not_found" | "locked" };

export async function loadConversation(userId: string, planId: PlanId, id: string): Promise<ConversationAccess> {
  const admin = createAdminClient();
  const { data: conversation } = await admin.from("conversations").select(COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (!conversation) return { ok: false, reason: "not_found" };

  const limit = getPlan(planId).historyConversationLimit;
  if (limit != null) {
    const { count } = await admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("updated_at", conversation.updated_at);
    if ((count ?? 0) >= limit) return { ok: false, reason: "locked" };
  }

  const { data: messages } = await admin
    .from("messages")
    .select("id, conversation_id, role, content, model_slug, served_model, credits_used, compare_group, status, notice, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(1000);
  return { ok: true, conversation: conversation as Conversation, messages: (messages ?? []) as MessageRow[] };
}
