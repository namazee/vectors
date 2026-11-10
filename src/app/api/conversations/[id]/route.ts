import { z } from "zod";
import { errorResponse, HttpError, requireApiUser } from "@/lib/auth";
import { loadConversation } from "@/lib/chat/conversations";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId, profile } = await requireApiUser();
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new HttpError(404, "not_found", "Conversation not found.");
    const res = await loadConversation(userId, profile.plan, id);
    if (!res.ok) {
      if (res.reason === "locked")
        throw new HttpError(403, "pro_required", "Older chats are available on Pro (unlimited history).");
      throw new HttpError(404, "not_found", "Conversation not found.");
    }
    return Response.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}

const patchSchema = z.object({ title: z.string().trim().min(1).max(120) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!idSchema.safeParse(id).success || !parsed.success) throw new HttpError(400, "invalid_request", "Invalid title.");
    // RLS restricts this to the user's own conversation.
    const supabase = await createClient();
    const { data, error } = await supabase.from("conversations").update({ title: parsed.data.title }).eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new HttpError(404, "not_found", "Conversation not found.");
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser();
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new HttpError(400, "invalid_request", "Invalid id.");
    const supabase = await createClient();
    const { data, error } = await supabase.from("conversations").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new HttpError(404, "not_found", "Conversation not found.");
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
