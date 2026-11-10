import { z } from "zod";
import { errorResponse, HttpError, requireApiUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ displayName: z.string().trim().min(1).max(80) });

export async function PATCH(req: Request) {
  try {
    const { userId } = await requireApiUser();
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Name must be 1–80 characters.");
    // Column-level grant: users may only update display_name / avatar_url.
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update({ display_name: parsed.data.displayName }).eq("id", userId);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

const deleteSchema = z.object({ confirm: z.literal("DELETE") });

/** Permanently deletes the account: cancels Stripe subscriptions, then removes the auth user (cascades to all data). */
export async function DELETE(req: Request) {
  try {
    const { userId, profile } = await requireApiUser();
    if (!deleteSchema.safeParse(await req.json().catch(() => null)).success) {
      throw new HttpError(400, "invalid_request", 'Type "DELETE" to confirm.');
    }
    const admin = createAdminClient();
    if (profile.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
      const stripe = getStripe();
      const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: "all", limit: 20 });
      for (const s of subs.data) {
        if (!["canceled", "incomplete_expired"].includes(s.status)) await stripe.subscriptions.cancel(s.id);
      }
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
    const supabase = await createClient();
    await supabase.auth.signOut();
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
