import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Minimal key/value interface used by rate limiting and capacity counters.
 * Uses Upstash Redis when configured; otherwise an in-memory store (fine for
 * local dev, NOT for production with multiple serverless instances).
 */
export interface CounterStore {
  incr(key: string, ttlSeconds: number): Promise<number>;
  get(key: string): Promise<number>;
  /** Sliding window: add an event now and return the count within `windowMs`. */
  windowAdd(key: string, windowMs: number): Promise<number>;
  windowCount(key: string, windowMs: number): Promise<number>;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Set if not exists; returns true if this call set it. */
  setNx(key: string, ttlSeconds: number): Promise<boolean>;
  /** Add a float to a key (creating it with TTL) and return the new value. */
  addFloat(key: string, amount: number, ttlSeconds: number): Promise<number>;
  getFloat(key: string): Promise<number | null>;
  setFloat(key: string, value: number, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

class UpstashStore implements CounterStore {
  constructor(private redis: Redis) {}
  async incr(key: string, ttlSeconds: number) {
    const p = this.redis.pipeline();
    p.incr(key);
    p.expire(key, ttlSeconds, "NX");
    const [n] = (await p.exec()) as [number, number];
    return n;
  }
  async get(key: string) {
    return Number((await this.redis.get<number>(key)) ?? 0);
  }
  async windowAdd(key: string, windowMs: number) {
    const now = Date.now();
    const p = this.redis.pipeline();
    p.zremrangebyscore(key, 0, now - windowMs);
    p.zadd(key, { score: now, member: `${now}-${Math.random().toString(36).slice(2, 8)}` });
    p.zcard(key);
    p.pexpire(key, windowMs);
    const res = (await p.exec()) as unknown[];
    return Number(res[2]);
  }
  async windowCount(key: string, windowMs: number) {
    const now = Date.now();
    const p = this.redis.pipeline();
    p.zremrangebyscore(key, 0, now - windowMs);
    p.zcard(key);
    const res = (await p.exec()) as unknown[];
    return Number(res[1]);
  }
  async getJson<T>(key: string) {
    return (await this.redis.get<T>(key)) ?? null;
  }
  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }
  async setNx(key: string, ttlSeconds: number) {
    const r = await this.redis.set(key, "1", { nx: true, ex: ttlSeconds });
    return r === "OK";
  }
  async addFloat(key: string, amount: number, ttlSeconds: number) {
    const p = this.redis.pipeline();
    p.incrbyfloat(key, amount);
    p.expire(key, ttlSeconds, "NX");
    const [n] = (await p.exec()) as [number | string, number];
    return Number(n);
  }
  async getFloat(key: string) {
    const v = await this.redis.get<number | string>(key);
    return v == null ? null : Number(v);
  }
  async setFloat(key: string, value: number, ttlSeconds: number) {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }
  async del(key: string) {
    await this.redis.del(key);
  }
}

export class MemoryStore implements CounterStore {
  private values = new Map<string, { v: unknown; exp: number }>();
  private windows = new Map<string, number[]>();
  private live(key: string) {
    const e = this.values.get(key);
    if (e && e.exp < Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return e;
  }
  async incr(key: string, ttlSeconds: number) {
    const e = this.live(key);
    const n = Number(e?.v ?? 0) + 1;
    this.values.set(key, { v: n, exp: e?.exp ?? Date.now() + ttlSeconds * 1000 });
    return n;
  }
  async get(key: string) {
    return Number(this.live(key)?.v ?? 0);
  }
  async windowAdd(key: string, windowMs: number) {
    const now = Date.now();
    const arr = (this.windows.get(key) ?? []).filter((t) => t > now - windowMs);
    arr.push(now);
    this.windows.set(key, arr);
    return arr.length;
  }
  async windowCount(key: string, windowMs: number) {
    const now = Date.now();
    const arr = (this.windows.get(key) ?? []).filter((t) => t > now - windowMs);
    this.windows.set(key, arr);
    return arr.length;
  }
  async getJson<T>(key: string) {
    return (this.live(key)?.v as T) ?? null;
  }
  async setJson(key: string, value: unknown, ttlSeconds: number) {
    this.values.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }
  async setNx(key: string, ttlSeconds: number) {
    if (this.live(key)) return false;
    this.values.set(key, { v: "1", exp: Date.now() + ttlSeconds * 1000 });
    return true;
  }
  async addFloat(key: string, amount: number, ttlSeconds: number) {
    const e = this.live(key);
    const n = Number(e?.v ?? 0) + amount;
    this.values.set(key, { v: n, exp: e?.exp ?? Date.now() + ttlSeconds * 1000 });
    return n;
  }
  async getFloat(key: string) {
    const e = this.live(key);
    return e ? Number(e.v) : null;
  }
  async setFloat(key: string, value: number, ttlSeconds: number) {
    this.values.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }
  async del(key: string) {
    this.values.delete(key);
    this.windows.delete(key);
  }
}

let store: CounterStore | null = null;

export function getStore(): CounterStore {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    store = new UpstashStore(new Redis({ url, token }));
  } else {
    if (process.env.NODE_ENV === "production") {
      console.warn("[redis] UPSTASH_REDIS_* not set — using in-memory counters (not shared across instances).");
    }
    store = new MemoryStore();
  }
  return store;
}

/** For tests. */
export function setStore(s: CounterStore | null) {
  store = s;
}
