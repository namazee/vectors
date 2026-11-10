import { z } from "zod";
import { errorResponse, HttpError, requireApiUser } from "@/lib/auth";
import { env, siteUrl } from "@/lib/env";
import { ensureCustomer, getStripe, ACTIVE_SUB_STATUSES } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { getTopupPack, BRAND, CURRENCY } from "@/config/plans";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pro") }),
  z.object({ kind: z.literal("topup"), packId: z.string().min(1).max(40) }),
]);

/** Creates a Stripe Checkout session for Pro or a top-up pack and returns its URL. */
export async function POST(req: Request) {
  try {
    const { userId, email } = await requireApiUser();
    if (!(await rateLimit(`checkout:${userId}`, 10, 60)).ok) throw new HttpError(429, "rate_limited", "Too many attempts.");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Invalid checkout request.");

    const stripe = getStripe();
    const customer = await ensureCustomer(userId, email);
    const base = siteUrl();

    if (parsed.data.kind === "pro") {
      const { data: subs } = await createAdminClient().from("subscriptions").select("status").eq("user_id", userId);
      if ((subs ?? []).some((s) => ACTIVE_SUB_STATUSES.has(s.status as string))) {
        throw new HttpError(409, "already_subscribed", "You already have Pro. Manage it from billing settings.");
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: userId,
        line_items: [{ price: env("STRIPE_PRICE_PRO_MONTHLY"), quantity: 1 }],
        metadata: { userId, kind: "pro" },
        subscription_data: { metadata: { userId } },
        allow_promotion_codes: true,
        success_url: `${base}/app/settings?checkout=pro-success`,
        cancel_url: `${base}/app/settings?checkout=cancelled`,
      });
      return Response.json({ url: session.url });
    }

    const pack = getTopupPack(parsed.data.packId);
    if (!pack) throw new HttpError(400, "invalid_request", "Unknown top-up pack.");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer,
      client_reference_id: userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY.code.toLowerCase(),
            unit_amount: Math.round(pack.priceMyr * 100),
            product_data: { name: `${pack.credits.toLocaleString()} ${BRAND.creditName} (${pack.name})` },
          },
        },
      ],
      // Card, FPX and GrabPay are offered automatically if enabled in the Stripe Dashboard.
      metadata: { userId, kind: "topup", packId: pack.id, credits: String(pack.credits) },
      payment_intent_data: { metadata: { userId, kind: "topup", packId: pack.id } },
      success_url: `${base}/app/settings?checkout=topup-success`,
      cancel_url: `${base}/app/settings?checkout=cancelled`,
    });
    await createAdminClient().from("topups").insert({
      user_id: userId,
      stripe_checkout_session_id: session.id,
      pack_id: pack.id,
      credits: pack.credits,
      amount_myr: pack.priceMyr,
      status: "pending",
    });
    return Response.json({ url: session.url });
  } catch (e) {
    return errorResponse(e);
  }
}
