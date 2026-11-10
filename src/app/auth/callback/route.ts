import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Handles email verification, password recovery and OAuth redirects.
 * Supports both the PKCE `code` flow and the `token_hash` flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/app";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/app";

  const supabase = await createClient();
  let error: string | null = null;

  if (code) {
    const res = await supabase.auth.exchangeCodeForSession(code);
    error = res.error?.message ?? null;
  } else if (tokenHash && type) {
    const res = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    error = res.error?.message ?? null;
  } else {
    error = "Invalid or expired link.";
  }

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link is invalid or has expired.")}`);
  }
  const dest = type === "recovery" ? "/reset-password" : next;
  return NextResponse.redirect(`${origin}${dest}`);
}
