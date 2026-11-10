import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Spins up an in-process Postgres (PGlite) with a minimal Supabase-compatible
 * `auth` schema and the real migrations applied.
 */
export async function createTestDb() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    );
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

export async function createUser(db: PGlite, email = `u${Math.random().toString(36).slice(2)}@test.dev`) {
  const res = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
  return res.rows[0].id;
}
