import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS — server only, never expose to the browser. */
export function createAdminClient(): SupabaseClient {
  if (!admin) {
    admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
