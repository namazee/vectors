import { z } from "zod";
import { getPlan } from "@/config/plans";
import { errorResponse, HttpError, requireApiUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z.object({
  text: z.string().trim().min(1).max(32_000),
  compareGroup: z.string().uuid(),
});

/**
 * Compare mode: stores the shared user prompt once. The client then calls
 * /api/chat (trigger "compare") once per model with the same compareGroup.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, profile } = await requireApiUser();
    if (!getPlan(profile.plan).compareMode) throw new HttpError(403, "pro_required", "Compare mode is a Pro feature.");
    if (!(await rateLimit(`compare-prompt:${userId}`, 20, 60)).ok) throw new HttpError(429, "rate_limited", "Slow down a little.");
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) throw new HttpError(400, "invalid_request", "Invalid message.");

    const db = createAdminClient();
    const { data: conv } = await db.from("conversations").select("id, is_compare").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!conv?.is_compare) throw new HttpError(404, "not_found", "Compare conversation not found.");

    const { error } = await db.from("messages").insert({
      conversation_id: id,
      user_id: userId,
      role: "user",
      content: parsed.data.text,
      compare_group: parsed.data.compareGroup,
    });
    if (error) throw error;
    await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
