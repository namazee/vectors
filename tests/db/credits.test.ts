import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser } from "../helpers/db";

/**
 * Exercises the real SQL credit functions (supabase/migrations) on an
 * in-process Postgres. Dates are passed explicitly to simulate days.
 */
let db: PGlite;
let user: string;
const DAY1 = "2026-03-01";
const DAY2 = "2026-03-02";

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}
const wallet = (daily = 30, day = DAY1) =>
  one<{ w: { daily: number; topup: number; held: number; available: number } }>(`select public.get_wallet($1, $2, $3::date) as w`, [user, daily, day]).then(
    (r) => ({ daily: Number(r.w.daily), topup: Number(r.w.topup), held: Number(r.w.held), available: Number(r.w.available) }),
  );
const reserve = (estimate: number, day = DAY1, daily = 30) =>
  one<{ r: { ok: boolean; usage_log_id?: string; available: number } }>(
    `select public.reserve_credits($1, $2, $3, 'claude-sonnet-5-5', 'free', null, $4::date) as r`,
    [user, daily, estimate, day],
  ).then((x) => x.r);
const settle = (logId: string, credits: number, day = DAY1, daily = 30) =>
  one<{ r: { charged: number; from_daily: number; from_topup: number } }>(
    `select public.settle_usage($1, $2, 0.01, 100, 50, 'anthropic/claude-sonnet-5.5', $3, 1000, $4::date) as r`,
    [logId, credits, daily, day],
  ).then((x) => ({ charged: Number(x.r.charged), fromDaily: Number(x.r.from_daily), fromTopup: Number(x.r.from_topup) }));
const ledgerSum = async (bucket: "daily" | "topup", day?: string) =>
  Number(
    (
      await one<{ s: string }>(
        `select coalesce(sum(amount),0) as s from credit_transactions where user_id=$1 and bucket=$2 ${day ? "and grant_date=$3::date" : ""}`,
        day ? [user, bucket, day] : [user, bucket],
      )
    ).s,
  );

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  user = await createUser(db);
  await db.query(
    `insert into public.models (slug, display_name, provider, openrouter_id, tier, input_price_per_m, output_price_per_m)
     values ('claude-sonnet-5-5', 'Sonnet', 'Anthropic', 'anthropic/claude-sonnet-5.5', 'frontier', 2, 10)
     on conflict (slug) do nothing`,
  );
});

describe("daily allowance", () => {
  it("grants the allowance once per day", async () => {
    expect((await wallet()).daily).toBe(30);
    expect((await wallet()).daily).toBe(30); // idempotent
    const grants = await one<{ n: number }>(`select count(*)::int as n from credit_transactions where user_id=$1 and kind='daily_grant'`, [user]);
    expect(grants.n).toBe(1);
  });

  it("resets at the next KL day with no rollover", async () => {
    const r = await reserve(5);
    await settle(r.usage_log_id!, 5);
    expect((await wallet()).daily).toBe(25);
    const next = await wallet(30, DAY2);
    expect(next.daily).toBe(30); // not 55
    expect(await ledgerSum("daily", DAY2)).toBe(30);
  });

  it("tops up the difference after a mid-day upgrade, never claws back on downgrade", async () => {
    const r = await reserve(10);
    await settle(r.usage_log_id!, 10);
    expect((await wallet(400)).daily).toBe(400 - 10);
    expect((await wallet(30)).daily).toBe(390); // downgrade later the same day: no clawback
  });

  it("kl_today() follows Asia/Kuala_Lumpur", async () => {
    const r = await one<{ d: string }>(`select (public.kl_today())::text as d`);
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
    expect(r.d).toBe(expected);
  });
});

describe("credit deduction", () => {
  it("holds, then charges the actual cost and keeps the ledger consistent", async () => {
    const r = await reserve(20);
    expect(r.ok).toBe(true);
    expect((await wallet()).available).toBe(10); // 30 - 20 held
    const s = await settle(r.usage_log_id!, 3.5);
    expect(s.charged).toBe(3.5);
    const w = await wallet();
    expect(w.daily).toBe(26.5);
    expect(w.held).toBe(0);
    expect(await ledgerSum("daily", DAY1)).toBe(26.5);
  });

  it("rejects a request whose estimate exceeds the available balance", async () => {
    const r = await reserve(31);
    expect(r.ok).toBe(false);
    expect(Number(r.available)).toBe(30);
  });

  it("concurrent holds cannot overspend", async () => {
    const results = await Promise.all([reserve(20), reserve(20), reserve(20)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("uses the daily allowance first, then top-up credits", async () => {
    await db.query(`select public.grant_topup($1, 100, 'topup:test-1', 'test')`, [user]);
    const r = await reserve(50);
    const s = await settle(r.usage_log_id!, 50);
    expect(s.fromDaily).toBe(30);
    expect(s.fromTopup).toBe(20);
    const w = await wallet();
    expect(w.daily).toBe(0);
    expect(w.topup).toBe(80);
    expect(await ledgerSum("topup")).toBe(80);
  });

  it("never goes below zero when the actual cost exceeds the balance", async () => {
    const r = await reserve(30);
    const s = await settle(r.usage_log_id!, 45);
    expect(s.charged).toBe(30);
    expect((await wallet()).daily).toBe(0);
  });

  it("settling twice is a no-op", async () => {
    const r = await reserve(10);
    await settle(r.usage_log_id!, 5);
    await settle(r.usage_log_id!, 5);
    expect((await wallet()).daily).toBe(25);
  });

  it("updates the model's rolling average credits/request", async () => {
    await db.query(`update models set avg_credits_per_request = null, avg_sample_count = 0 where slug='claude-sonnet-5-5'`);
    for (const c of [2, 4]) {
      const r = await reserve(5);
      await settle(r.usage_log_id!, c);
    }
    const m = await one<{ a: string; n: number }>(`select avg_credits_per_request as a, avg_sample_count as n from models where slug='claude-sonnet-5-5'`);
    expect(Number(m.a)).toBeCloseTo(3, 4);
    expect(m.n).toBe(2);
  });
});

describe("refunds", () => {
  it("releasing a hold after a failed request charges nothing", async () => {
    const r = await reserve(25);
    await db.query(`select public.release_hold($1, 'upstream 503')`, [r.usage_log_id]);
    const w = await wallet();
    expect(w.available).toBe(30);
    expect(w.held).toBe(0);
    const tx = await one<{ n: number }>(`select count(*)::int as n from credit_transactions where user_id=$1 and kind='usage'`, [user]);
    expect(tx.n).toBe(0);
  });

  it("refund_usage reverses a settled charge into the same buckets, once", async () => {
    await db.query(`select public.grant_topup($1, 100, 'topup:test-2', 'test')`, [user]);
    const r = await reserve(40);
    await settle(r.usage_log_id!, 40); // 30 daily + 10 top-up
    await db.query(`select public.refund_usage($1, 30, 'test refund', $2::date)`, [r.usage_log_id, DAY1]);
    await db.query(`select public.refund_usage($1, 30, 'test refund', $2::date)`, [r.usage_log_id, DAY1]);
    const w = await wallet();
    expect(w.daily).toBe(30);
    expect(w.topup).toBe(100);
    const refunds = await one<{ n: number }>(`select count(*)::int as n from credit_transactions where user_id=$1 and kind='refund'`, [user]);
    expect(refunds.n).toBe(2); // one daily row + one top-up row
  });

  it("stale holds are released by the cleanup job", async () => {
    const r = await reserve(25);
    await db.query(`update usage_logs set created_at = now() - interval '1 hour' where id=$1`, [r.usage_log_id]);
    const n = await one<{ n: number }>(`select public.release_stale_holds(10) as n`);
    expect(n.n).toBe(1);
    expect((await wallet()).available).toBe(30);
  });
});

describe("top-ups and admin adjustments", () => {
  it("grant_topup is idempotent per reference", async () => {
    const a = await one<{ g: boolean }>(`select public.grant_topup($1, 1500, 'topup:cs_1') as g`, [user]);
    const b = await one<{ g: boolean }>(`select public.grant_topup($1, 1500, 'topup:cs_1') as g`, [user]);
    expect(a.g).toBe(true);
    expect(b.g).toBe(false);
    expect((await wallet()).topup).toBe(1500);
  });

  it("admin adjustments are ledgered and never go below zero", async () => {
    await db.query(`select public.admin_adjust_credits($1, 50, 'topup', 'goodwill', null, 30, $2::date)`, [user, DAY1]);
    const r = await one<{ r: { applied: number } }>(`select public.admin_adjust_credits($1, -500, 'topup', 'correction', null, 30, $2::date) as r`, [user, DAY1]);
    expect(Number(r.r.applied)).toBe(-50);
    expect((await wallet()).topup).toBe(0);
  });

  it("reconcile_wallet finds no drift after mixed operations", async () => {
    await db.query(`select public.grant_topup($1, 200, 'topup:cs_r')`, [user]);
    const r = await reserve(60);
    await settle(r.usage_log_id!, 60);
    await wallet();
    const rec = await one<{ r: { drift_daily: number; drift_topup: number } }>(`select public.reconcile_wallet($1) as r`, [user]);
    expect(Number(rec.r.drift_daily)).toBe(0);
    expect(Number(rec.r.drift_topup)).toBe(0);
  });
});

describe("row level security", () => {
  it("a user cannot read another user's ledger or write their own balance", async () => {
    const other = await createUser(db);
    await db.query(`select public.grant_topup($1, 10, 'topup:other')`, [other]);
    await db.exec(`grant usage on schema public to authenticated; grant select, update on all tables in schema public to authenticated;
                   revoke update on public.credit_wallets from authenticated;`);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
    try {
      const rows = await db.query(`select * from public.credit_transactions where user_id = '${other}'`);
      expect(rows.rows).toHaveLength(0);
      await expect(db.query(`update public.credit_wallets set topup_balance = 1e6 where user_id = '${user}'`)).rejects.toThrow();
    } finally {
      await db.exec(`reset role;`);
    }
  });
});
