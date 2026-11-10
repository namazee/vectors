import { z } from "zod";
import { errorResponse, HttpError, requireApiAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminAdjustCredits } from "@/lib/credits/ledger";

export const dynamic = "force-dynamic";

const schema = z.object({
  amount: z.number().refine((n) => n !== 0 && Math.abs(n) <= 1_000_000, "Amount must be non-zero."),
  bucket: z.enum(["daily", "topup"]),
  note: z.string().trim().min(3, "Add a short reason.").max(200),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId: adminId } = await requireApiAdmin();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) {
      throw new HttpError(400, "invalid_request", parsed.success ? "Invalid user." : parsed.error.issues[0].message);
    }
    const { data: profile } = await createAdminClient().from("profiles").select("plan").eq("id", id).maybeSingle();
    if (!profile) throw new HttpError(404, "not_found", "User not found.");
    const applied = await adminAdjustCredits({
      userId: id,
      plan: profile.plan,
      amount: parsed.data.amount,
      bucket: parsed.data.bucket,
      note: parsed.data.note,
      adminId,
    });
    return Response.json({ applied });
  } catch (e) {
    return errorResponse(e);
  }
}
