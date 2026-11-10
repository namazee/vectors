import { describe, expect, it, beforeEach } from "vitest";
import type Stripe from "stripe";
import { handleStripeEvent, toSubscriptionRecord, type BillingStore, type SubscriptionRecord } from "@/lib/billing/webhook-handlers";

/** In-memory BillingStore mirroring the real store's idempotency guarantees. */
function memoryStore() {
  const events = new Set<string>();
  const ledgerRefs = new Set<string>();
  const subs = new Map<string, SubscriptionRecord>();
  const plans = new Map<string, "free" | "pro">();
  const balances = new Map<string, number>();
  const topups = new Map<string, { id: string; userId: string; credits: number; status: string; pi: string | null }>();
  const payments = new Map<string, number>();
  const customers = new Map<string, string>([["cus_1", "user-1"]]);
  const remoteSubs = new Map<string, Stripe.Subscription>();

  const store: BillingStore = {
    async hasProcessedEvent(id) {
      return events.has(id);
    },
    async markEventProcessed(id) {
      events.add(id);
    },
    async findUserIdByCustomer(c) {
      return customers.get(c) ?? null;
    },
    async upsertSubscription(s) {
      subs.set(s.id, s);
    },
    async setPlanFromSubscriptions(userId) {
      const active = [...subs.values()].some((s) => s.userId === userId && ["active", "trialing", "past_due"].includes(s.status));
      plans.set(userId, active ? "pro" : "free");
      return active ? "pro" : "free";
    },
    async grantTopup(userId, credits, reference) {
      if (ledgerRefs.has(reference)) return false;
      ledgerRefs.add(reference);
      balances.set(userId, (balances.get(userId) ?? 0) + credits);
      return true;
    },
    async markTopup(sessionId, patch) {
      const t = topups.get(sessionId) ?? { id: sessionId, userId: "user-1", credits: 0, status: "pending", pi: null };
      topups.set(sessionId, { ...t, status: patch.status, pi: patch.paymentIntentId ?? t.pi });
    },
    async findTopupByPaymentIntent(pi) {
      const t = [...topups.values()].find((x) => x.pi === pi);
      return t ? { id: t.id, userId: t.userId, credits: t.credits, status: t.status } : null;
    },
    async refundTopup(id, userId, credits) {
      const t = [...topups.values()].find((x) => x.id === id)!;
      if (t.status === "refunded") return false;
      t.status = "refunded";
      balances.set(userId, Math.max(0, (balances.get(userId) ?? 0) - credits));
      return true;
    },
    async recordPayment(p) {
      if (!payments.has(p.id)) payments.set(p.id, p.amountMyr);
    },
    async retrieveSubscription(id) {
      return remoteSubs.get(id)!;
    },
  };
  return { store, plans, balances, topups, payments, remoteSubs, subs };
}

const evt = (id: string, type: string, object: unknown) => ({ id, type, data: { object } }) as unknown as Stripe.Event;

const topupSession = (id = "cs_1") => ({
  id,
  object: "checkout.session",
  mode: "payment",
  payment_status: "paid",
  customer: "cus_1",
  payment_intent: "pi_1",
  amount_total: 1000,
  currency: "myr",
  created: 1794300000,
  metadata: { userId: "user-1", kind: "topup", packId: "pack_small", credits: "1500" },
});

const subscription = (status: string) =>
  ({
    id: "sub_1",
    object: "subscription",
    status,
    customer: "cus_1",
    cancel_at_period_end: false,
    metadata: { userId: "user-1" },
    items: { data: [{ price: { id: "price_pro" }, current_period_start: 1794300000, current_period_end: 1796900000 }] },
  }) as unknown as Stripe.Subscription;

describe("Stripe webhook handling", () => {
  let m: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    m = memoryStore();
  });

  it("grants top-up credits exactly once, even on replays and duplicate events", async () => {
    const e = evt("evt_1", "checkout.session.completed", topupSession());
    expect((await handleStripeEvent(e, m.store)).status).toBe("processed");
    expect((await handleStripeEvent(e, m.store)).status).toBe("duplicate");
    // Same checkout session delivered under a different event id (e.g. async_payment_succeeded).
    await handleStripeEvent(evt("evt_2", "checkout.session.async_payment_succeeded", topupSession()), m.store);
    expect(m.balances.get("user-1")).toBe(1500);
    expect(m.payments.get("cs_1")).toBe(10);
  });

  it("does not grant credits for unpaid (async) checkouts", async () => {
    await handleStripeEvent(evt("evt_3", "checkout.session.completed", { ...topupSession("cs_2"), payment_status: "unpaid" }), m.store);
    expect(m.balances.get("user-1")).toBeUndefined();
  });

  it("subscription lifecycle switches the plan", async () => {
    await handleStripeEvent(evt("evt_s1", "customer.subscription.created", subscription("active")), m.store);
    expect(m.plans.get("user-1")).toBe("pro");
    await handleStripeEvent(evt("evt_s2", "customer.subscription.updated", subscription("past_due")), m.store);
    expect(m.plans.get("user-1")).toBe("pro"); // grace period while Stripe retries
    await handleStripeEvent(evt("evt_s3", "customer.subscription.deleted", subscription("canceled")), m.store);
    expect(m.plans.get("user-1")).toBe("free");
  });

  it("checkout for a subscription fetches and syncs it", async () => {
    m.remoteSubs.set("sub_1", subscription("active"));
    await handleStripeEvent(evt("evt_c", "checkout.session.completed", { id: "cs_sub", mode: "subscription", subscription: "sub_1", metadata: {} }), m.store);
    expect(m.plans.get("user-1")).toBe("pro");
    expect(m.subs.get("sub_1")?.currentPeriodEnd).toBe(new Date(1796900000 * 1000).toISOString());
  });

  it("records subscription revenue from paid invoices", async () => {
    await handleStripeEvent(evt("evt_i", "invoice.paid", { id: "in_1", amount_paid: 3900, currency: "myr", customer: "cus_1", created: 1794300000 }), m.store);
    expect(m.payments.get("in_1")).toBe(39);
  });

  it("refunding a top-up revokes its credits once", async () => {
    await handleStripeEvent(evt("evt_t", "checkout.session.completed", topupSession()), m.store);
    m.topups.get("cs_1")!.credits = 1500;
    const refund = evt("evt_r", "charge.refunded", { payment_intent: "pi_1", refunded: true });
    await handleStripeEvent(refund, m.store);
    await handleStripeEvent(evt("evt_r2", "charge.refunded", { payment_intent: "pi_1", refunded: true }), m.store);
    expect(m.balances.get("user-1")).toBe(0);
  });

  it("ignores unrelated events but records them", async () => {
    expect((await handleStripeEvent(evt("evt_x", "customer.created", {}), m.store)).status).toBe("ignored");
    expect((await handleStripeEvent(evt("evt_x", "customer.created", {}), m.store)).status).toBe("duplicate");
  });

  it("maps subscription periods from items (new API) and legacy fields", () => {
    const legacy = { ...subscription("active"), items: { data: [{ price: { id: "p" } }] }, current_period_end: 1796900000 } as unknown as Stripe.Subscription;
    expect(toSubscriptionRecord(legacy, "u").currentPeriodEnd).toBe(new Date(1796900000 * 1000).toISOString());
  });
});
