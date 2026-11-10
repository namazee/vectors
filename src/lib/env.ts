import { z } from "zod";

/**
 * Server-side environment. Validated lazily so `next build` works without
 * secrets; anything missing throws a clear error the first time it's used.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_PRO_MONTHLY: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
  ADMIN_ALERT_EMAIL: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;

export function env<K extends keyof ServerEnv>(key: K): ServerEnv[K] {
  const shape = serverSchema.shape[key];
  const parsed = shape.safeParse(process.env[key]);
  if (!parsed.success) {
    throw new Error(`Missing or invalid environment variable ${String(key)}. See .env.example.`);
  }
  return parsed.data as ServerEnv[K];
}

export function optionalEnv(key: keyof ServerEnv): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

export const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
