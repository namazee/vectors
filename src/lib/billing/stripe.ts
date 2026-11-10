import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) stripe = new Stripe(env("STRIPE_SECRET_KEY"), { appInfo: { name: "vectors" } });
  return stripe;
}

/** Returns the user's Stripe customer id, creating the customer on first use. */
export async function ensureCustomer(userId: string, email: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("stripe_customer_id").eq("id", userId).single();
  if (profile?.stripe_customer_id) return profile.stripe_customer_id as string;

  const customer = await getStripe().customers.create(
    { email: email ?? undefined, metadata: { userId } },
    { idempotencyKey: `customer:${userId}` },
  );
  await admin.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", userId);
  return customer.id;
}

export const ACTIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due"]);
