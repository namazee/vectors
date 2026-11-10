import { z } from "zod";
import { errorResponse, HttpError, requireApiUser } from "@/lib/auth";
import { listConversations } from "@/lib/chat/conversations";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlan } from "@/config/plans";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { userId, profile } = await requireApiUser();
    const q = new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? "";
    const conversations = await listConversations(userId, profile.plan, q);
    return Response.json({ conversations });
  } catch (e) {
    return errorResponse(e);
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  isCompare: z.boolean().default(false),
});

/** Creates an empty conversation (used by compare mode). */
export async function POST(req: Request) {
  try {
    const { userId, profile } = await requireApiUser();
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Invalid conversation.");
    if (parsed.data.isCompare && !getPlan(profile.plan).compareMode) {
      throw new HttpError(403, "pro_required", "Compare mode is a Pro feature.");
    }
    const { data, error } = await createAdminClient()
      .from("conversations")
      .insert({ user_id: userId, title: parsed.data.title, is_compare: parsed.data.isCompare })
      .select("id, title, model_slug, is_compare, created_at, updated_at")
      .single();
    if (error) throw error;
    return Response.json({ conversation: data });
  } catch (e) {
    return errorResponse(e);
  }
}
