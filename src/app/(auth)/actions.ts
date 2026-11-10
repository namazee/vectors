"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, AUTH_LIMIT } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/env";

export interface AuthState {
  error?: string;
  message?: string;
}

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z.string().min(8, "Password must be at least 8 characters.").max(72, "Password is too long.");

function safeNext(next: unknown): string {
  const n = typeof next === "string" ? next : "";
  // Only allow same-site relative paths.
  return n.startsWith("/") && !n.startsWith("//") ? n : "/app";
}

async function limited(action: string): Promise<boolean> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const r = await rateLimit(`auth:${action}:${ip}`, AUTH_LIMIT.limit, AUTH_LIMIT.windowSeconds);
  return !r.ok;
}

const TOO_MANY = { error: "Too many attempts. Please wait a minute and try again." };

export async function signInAction(_: AuthState, formData: FormData): Promise<AuthState> {
  if (await limited("signin")) return TOO_MANY;
  const parsed = z.object({ email, password: z.string().min(1, "Enter your password.") }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Please verify your email first. Check your inbox." };
    return { error: "Incorrect email or password." };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(_: AuthState, formData: FormData): Promise<AuthState> {
  if (await limited("signup")) return TOO_MANY;
  const parsed = z
    .object({ email, password, name: z.string().trim().max(80).optional() })
    .safeParse({ email: formData.get("email"), password: formData.get("password"), name: formData.get("name") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const next = safeNext(formData.get("next"));
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
      data: parsed.data.name ? { full_name: parsed.data.name } : undefined,
    },
  });
  if (error) return { error: error.message };
  // Email confirmation disabled → session exists → go straight in.
  if (data.session) redirect(next);
  return { message: "Check your email for a verification link to finish signing up." };
}

export async function googleSignInAction(formData: FormData) {
  const supabase = await createClient();
  const next = safeNext(formData.get("next"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(`/login?error=${encodeURIComponent(error?.message ?? "Google sign-in failed")}`);
  redirect(data.url);
}

export async function forgotPasswordAction(_: AuthState, formData: FormData): Promise<AuthState> {
  if (await limited("forgot")) return TOO_MANY;
  const parsed = email.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  });
  // Same response whether or not the account exists (no user enumeration).
  return { message: "If an account exists for that email, we've sent a password reset link." };
}

export async function resetPasswordAction(_: AuthState, formData: FormData): Promise<AuthState> {
  if (await limited("reset")) return TOO_MANY;
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Passwords don't match." })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Your reset link has expired. Please request a new one." };
  redirect("/app");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
