import "server-only";
import { getStore } from "@/lib/redis";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Sliding-window rate limit: `limit` events per `windowSeconds` per key. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  try {
    const count = await getStore().windowAdd(`rl:${key}`, windowSeconds * 1000);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: windowSeconds };
  } catch (e) {
    // Fail open on Redis outages; the credit checks still protect paid usage.
    console.error("[ratelimit] store error", e);
    return { ok: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

export const AUTH_LIMIT = { limit: 10, windowSeconds: 60 };
