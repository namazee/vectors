import type Stripe from "stripe";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook-handlers";
import { supabaseBillingStore } from "@/lib/billing/supabase-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  // Signature verification needs the exact raw body.
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, env("STRIPE_WEBHOOK_SECRET"));
  } catch (e) {
    console.warn("[stripe] signature verification failed", (e as Error).message);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, supabaseBillingStore());
    if (result.status !== "ignored") console.info(`[stripe] ${event.type} ${event.id}: ${result.status} ${result.detail ?? ""}`);
    return Response.json({ received: true, ...result });
  } catch (e) {
    console.error(`[stripe] failed to handle ${event.type} ${event.id}`, e);
    // 500 → Stripe retries later. Handlers are idempotent.
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
}
