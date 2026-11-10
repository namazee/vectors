import "server-only";
import { getPlan } from "@/config/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, ACTIVE_SUB_STATUSES } from "@/lib/billing/stripe";
import { klDate } from "@/lib/time";
import type { BillingStore } from "@/lib/billing/webhook-handlers";

export function supabaseBillingStore(): BillingStore {
  const db = createAdminClient();
  return {
    async hasProcessedEvent(id) {
      const { data } = await db.from("stripe_events").select("id").eq("id", id).maybeSingle();
      return !!data;
    },
    async markEventProcessed(id, type) {
      const { error } = await db.from("stripe_events").upsert({ id, type }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    },
    async findUserIdByCustomer(customerId) {
      const { data } = await db.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
      return (data?.id as string) ?? null;
    },
    async upsertSubscription(s) {
      const { error } = await db.from("subscriptions").upsert({
        id: s.id,
        user_id: s.userId,
        status: s.status,
        price_id: s.priceId,
        current_period_start: s.currentPeriodStart,
        current_period_end: s.currentPeriodEnd,
        cancel_at_period_end: s.cancelAtPeriodEnd,
      });
      if (error) throw error;
    },
    async setPlanFromSubscriptions(userId) {
      const { data } = await db.from("subscriptions").select("status").eq("user_id", userId);
      const plan = (data ?? []).some((s) => ACTIVE_SUB_STATUSES.has(s.status as string)) ? "pro" : "free";
      const { error } = await db.from("profiles").update({ plan }).eq("id", userId);
      if (error) throw error;
      // Apply the (larger) Pro allowance for today right away.
      if (plan === "pro") {
        await db.rpc("get_wallet", { p_user: userId, p_daily_amount: getPlan("pro").dailyCredits, p_today: klDate() });
      }
      return plan;
    },
    async grantTopup(userId, credits, reference, note) {
      const { data, error } = await db.rpc("grant_topup", { p_user: userId, p_credits: credits, p_reference: reference, p_note: note });
      if (error) throw error;
      return Boolean(data);
    },
    async markTopup(sessionId, patch) {
      const { error } = await db
        .from("topups")
        .update({
          status: patch.status,
          ...(patch.paymentIntentId ? { stripe_payment_intent_id: patch.paymentIntentId } : {}),
          ...(patch.status === "paid" ? { paid_at: new Date().toISOString() } : {}),
        })
        .eq("stripe_checkout_session_id", sessionId);
      if (error) throw error;
    },
    async findTopupByPaymentIntent(paymentIntentId) {
      const { data } = await db
        .from("topups")
        .select("id, user_id, credits, status")
        .eq("stripe_payment_intent_id", paymentIntentId)
        .maybeSingle();
      return data ? { id: data.id, userId: data.user_id, credits: Number(data.credits), status: data.status } : null;
    },
    async refundTopup(topupId, userId, credits, note) {
      const { data } = await db
        .from("topups")
        .update({ status: "refunded" })
        .eq("id", topupId)
        .neq("status", "refunded")
        .select("id");
      if (!data?.length) return false;
      const { data: profile } = await db.from("profiles").select("plan").eq("id", userId).single();
      const { error } = await db.rpc("admin_adjust_credits", {
        p_user: userId,
        p_amount: -credits,
        p_bucket: "topup",
        p_note: note,
        p_admin: null,
        p_daily_amount: getPlan(profile?.plan).dailyCredits,
        p_today: klDate(),
      });
      if (error) throw error;
      return true;
    },
    async retrieveSubscription(id) {
      return getStripe().subscriptions.retrieve(id);
    },
  };
}
