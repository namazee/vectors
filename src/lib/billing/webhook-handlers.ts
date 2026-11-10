import type Stripe from "stripe";
import { getTopupPack } from "@/config/plans";

/**
 * Stripe webhook business logic, written against a small `BillingStore`
 * interface so it can be unit-tested without Stripe or Supabase.
 *
 * Idempotency: every event id is recorded once processing succeeds; replays are
 * skipped. Credit grants are also keyed by a unique ledger reference, so even a
 * concurrent duplicate delivery can never grant credits twice.
 */

export interface SubscriptionRecord {
  id: string;
  userId: string;
  status: string;
  priceId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingStore {
  hasProcessedEvent(id: string): Promise<boolean>;
  markEventProcessed(id: string, type: string): Promise<void>;
  findUserIdByCustomer(customerId: string): Promise<string | null>;
  upsertSubscription(sub: SubscriptionRecord): Promise<void>;
  /** Recomputes the user's plan from all their subscriptions. */
  setPlanFromSubscriptions(userId: string): Promise<"free" | "pro">;
  /** Idempotent on `reference`. Returns true if credits were granted by this call. */
  grantTopup(userId: string, credits: number, reference: string, note: string): Promise<boolean>;
  markTopup(sessionId: string, patch: { status: "paid" | "failed" | "refunded"; paymentIntentId?: string | null }): Promise<void>;
  findTopupByPaymentIntent(paymentIntentId: string): Promise<{ userId: string; credits: number; id: string; status: string } | null>;
  /** Marks the top-up refunded and deducts up to `credits` from the top-up bucket (never below zero). Idempotent. */
  refundTopup(topupId: string, userId: string, credits: number, note: string): Promise<boolean>;
  /** Revenue record for the finance dashboard. Idempotent on id. */
  recordPayment(p: { id: string; userId: string | null; kind: "subscription" | "topup"; amountMyr: number; currency: string; createdAt: string }): Promise<void>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
}

export type HandleResult = { status: "processed" | "duplicate" | "ignored"; detail?: string };

function customerId(c: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

const ts = (n: number | null | undefined) => (n ? new Date(n * 1000).toISOString() : null);

export function toSubscriptionRecord(sub: Stripe.Subscription, userId: string): SubscriptionRecord {
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number }) | undefined;
  const legacy = sub as unknown as { current_period_start?: number; current_period_end?: number };
  return {
    id: sub.id,
    userId,
    status: sub.status,
    priceId: item?.price?.id ?? null,
    currentPeriodStart: ts(item?.current_period_start ?? legacy.current_period_start),
    currentPeriodEnd: ts(item?.current_period_end ?? legacy.current_period_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}

async function resolveUserId(store: BillingStore, metadataUserId: string | undefined | null, customer: string | null) {
  if (metadataUserId) return metadataUserId;
  if (customer) return store.findUserIdByCustomer(customer);
  return null;
}

async function syncSubscription(store: BillingStore, sub: Stripe.Subscription): Promise<string> {
  const userId = await resolveUserId(store, sub.metadata?.userId, customerId(sub.customer));
  if (!userId) return `no user for subscription ${sub.id}`;
  await store.upsertSubscription(toSubscriptionRecord(sub, userId));
  const plan = await store.setPlanFromSubscriptions(userId);
  return `user ${userId} plan=${plan} status=${sub.status}`;
}

async function fulfilTopup(store: BillingStore, session: Stripe.Checkout.Session): Promise<string> {
  const userId = await resolveUserId(store, session.metadata?.userId, customerId(session.customer));
  const pack = getTopupPack(session.metadata?.packId ?? "");
  const credits = Number(session.metadata?.credits ?? pack?.credits ?? 0);
  if (!userId || !(credits > 0)) return "top-up missing user or credits";
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const granted = await store.grantTopup(userId, credits, `topup:${session.id}`, `Top-up: ${pack?.name ?? session.metadata?.packId}`);
  await store.markTopup(session.id, { status: "paid", paymentIntentId });
  if (session.amount_total != null) {
    await store.recordPayment({
      id: session.id,
      userId,
      kind: "topup",
      amountMyr: session.amount_total / 100,
      currency: session.currency ?? "myr",
      createdAt: ts(session.created) ?? new Date().toISOString(),
    });
  }
  return granted ? `granted ${credits} credits to ${userId}` : "already granted";
}

export async function handleStripeEvent(event: Stripe.Event, store: BillingStore): Promise<HandleResult> {
  if (await store.hasProcessedEvent(event.id)) return { status: "duplicate" };

  let detail = "";
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "payment" && session.metadata?.kind === "topup") {
        if (session.payment_status === "paid") detail = await fulfilTopup(store, session);
        else detail = `top-up awaiting payment (${session.payment_status})`;
      } else if (session.mode === "subscription" && session.subscription) {
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        detail = await syncSubscription(store, await store.retrieveSubscription(subId));
      }
      break;
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.kind === "topup") await store.markTopup(session.id, { status: "failed" });
      detail = "top-up payment failed";
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed": {
      detail = await syncSubscription(store, event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.amount_paid > 0) {
        const userId = await resolveUserId(store, null, customerId(invoice.customer));
        await store.recordPayment({
          id: invoice.id ?? event.id,
          userId,
          kind: "subscription",
          amountMyr: invoice.amount_paid / 100,
          currency: invoice.currency,
          createdAt: ts(invoice.created) ?? new Date().toISOString(),
        });
      }
      detail = `invoice ${invoice.id} paid`;
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      const topup = pi ? await store.findTopupByPaymentIntent(pi) : null;
      if (topup && charge.refunded && topup.status !== "refunded") {
        const done = await store.refundTopup(topup.id, topup.userId, topup.credits, `Refund of top-up ${topup.id}`);
        detail = done ? `revoked top-up ${topup.id}` : "top-up already refunded";
      } else {
        detail = "refund not linked to a top-up";
      }
      break;
    }
    default:
      await store.markEventProcessed(event.id, event.type);
      return { status: "ignored" };
  }

  await store.markEventProcessed(event.id, event.type);
  return { status: "processed", detail };
}
