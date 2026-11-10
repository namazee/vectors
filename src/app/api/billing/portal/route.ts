import { errorResponse, HttpError, requireApiUser } from "@/lib/auth";
import { siteUrl } from "@/lib/env";
import { getStripe } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/** Opens the Stripe Customer Portal (manage card, cancel, invoices). */
export async function POST() {
  try {
    const { profile } = await requireApiUser();
    if (!profile.stripe_customer_id) throw new HttpError(400, "no_billing", "You don't have a billing account yet.");
    const session = await getStripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl()}/app/settings`,
    });
    return Response.json({ url: session.url });
  } catch (e) {
    return errorResponse(e);
  }
}
