import { z } from "zod";
import { errorResponse, HttpError, requireApiAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApiAdmin();
    const { data, error } = await createAdminClient()
      .from("pricing_scenarios")
      .select("id, name, inputs, outputs, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json({ scenarios: data });
  } catch (e) {
    return errorResponse(e);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
});

export async function POST(req: Request) {
  try {
    const { userId } = await requireApiAdmin();
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Invalid scenario.");
    if (JSON.stringify(parsed.data).length > 200_000) throw new HttpError(400, "invalid_request", "Scenario too large.");
    const { data, error } = await createAdminClient()
      .from("pricing_scenarios")
      .insert({ ...parsed.data, created_by: userId })
      .select("id, name, inputs, outputs, created_at")
      .single();
    if (error) throw error;
    return Response.json({ scenario: data });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await requireApiAdmin();
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "invalid_request", "Invalid id.");
    const { error } = await createAdminClient().from("pricing_scenarios").delete().eq("id", id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
