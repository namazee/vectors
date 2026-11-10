import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Current user + profile, or null. Cached per request. */
export const getSession = cache(async (): Promise<{ userId: string; email: string | null; profile: Profile } | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Read the profile with the service role so a missing row can be repaired.
  const admin = createAdminClient();
  let { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) {
    const { data } = await admin
      .from("profiles")
      .upsert({ id: user.id, email: user.email, display_name: user.email?.split("@")[0] })
      .select("*")
      .single();
    await admin.from("credit_wallets").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
    profile = data;
  }
  return { userId: user.id, email: user.email ?? null, profile: profile as Profile };
});

/** Like getSession, but returns null (instead of throwing) when Supabase isn't configured. */
export async function getOptionalSession() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  try {
    return await getSession();
  } catch (e) {
    console.error("[auth] session lookup failed", e);
    return null;
  }
}

/** For pages: redirect to /login when signed out. */
export async function requireUser() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** For pages: 404-style redirect for non-admins. */
export async function requireAdminPage() {
  const s = await requireUser();
  if (s.profile.role !== "admin") redirect("/app");
  return s;
}

/** For API routes: throws HttpError instead of redirecting. */
export async function requireApiUser() {
  const s = await getSession();
  if (!s) throw new HttpError(401, "unauthorized", "Please sign in.");
  return s;
}

export async function requireApiAdmin() {
  const s = await requireApiUser();
  if (s.profile.role !== "admin") throw new HttpError(403, "forbidden", "Admins only.");
  return s;
}

/** Converts thrown errors into JSON responses for route handlers. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status });
  }
  console.error(e);
  return Response.json({ error: { code: "server_error", message: "Something went wrong. Please try again." } }, { status: 500 });
}
