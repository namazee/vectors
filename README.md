# Vectors — every AI model under one roof

A multi-model AI chat app: one login, one interface, many models, saved history.

- **Unmetered models** (0 credits, every account): fast open models served through OpenRouter `:free` endpoints, with automatic failover to the paid version of the same model and then to another unmetered model.
- **Frontier models** (GPT, Claude, Gemini, Grok, Qwen, Kimi, GLM, …) paid with credits (**Sparks**, configurable), charged on real usage.
- **Freemium**: Free accounts get a small daily allowance; **Pro** (monthly, MYR, Stripe) gets a large daily allowance, priority routing, unlimited history and side-by-side comparison. Optional one-off top-up packs never expire.
- **Admin**: model management, users and credit adjustments, finance dashboard (OpenRouter spend vs Stripe revenue), hard monthly spend cap, and a **pricing & margin calculator**.

Stack: Next.js 15 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Supabase (Auth + Postgres) · Vercel AI SDK v7 + OpenRouter · Stripe Billing · Upstash Redis · Vercel.

---

## Contents

1. [Quick start (local)](#1-quick-start-local)
2. [Supabase](#2-supabase)
3. [OpenRouter](#3-openrouter)
4. [Stripe](#4-stripe)
5. [Upstash Redis](#5-upstash-redis)
6. [Admin alerts (Resend)](#6-admin-alerts-resend)
7. [Deploy to Vercel](#7-deploy-to-vercel)
8. [Make your account an admin](#8-make-your-account-an-admin)
9. [Changing prices and plans](#9-changing-prices-and-plans)
10. [How credits work](#10-how-credits-work)
11. [Calculator formulas](#11-calculator-formulas)
12. [Project structure](#12-project-structure)
13. [Tests](#13-tests)
14. [Security notes](#14-security-notes)

---

## 1. Quick start (local)

Requirements: Node 20.9+, Docker (for local Supabase), optionally the [Stripe CLI](https://docs.stripe.com/stripe-cli).

```bash
npm install
npm run db:start                 # local Supabase (Postgres + Auth + REST) — applies migrations + seed.sql
npx supabase status              # shows API URL, anon key and service_role key
cp .env.example .env.local       # fill in the Supabase values from `supabase status`
#   For a no-cost demo set MOCK_AI=1 (built-in mock model, no OpenRouter calls)
npm run seed                     # models + demo admin (prints the password if DEMO_ADMIN_PASSWORD is empty)
npm run dev                      # http://localhost:3000
```

Log in with `DEMO_ADMIN_EMAIL` / the printed password. Local Supabase has email confirmation off, so new sign-ups go straight in. Emails (password reset etc.) are captured by Mailpit at http://127.0.0.1:54324.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit + database tests (Vitest, PGlite) |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm run seed` | Upsert the model catalogue + create the demo admin |
| `npm run seed:sql` | Regenerate `supabase/seed.sql` from `src/lib/models/seed-data.ts` |
| `npm run sync:prices [-- --dry]` | Pull current prices/context lengths from the OpenRouter models API |
| `npm run db:start` / `db:reset` / `db:push` | Supabase CLI helpers |
| `npm run stripe:listen` | Forward Stripe webhooks to localhost |

---

## 2. Supabase

1. Create a project at [supabase.com](https://supabase.com) (region: Singapore is closest to Malaysia).
2. **Apply the migrations**:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push            # applies supabase/migrations/*.sql
   ```
   Or paste each file in `supabase/migrations/` (in order) into the SQL editor.
3. **Seed** the models and a demo admin: put the project's URL and `service_role` key in `.env.local`, then `npm run seed`.
4. **Auth → URL Configuration**:
   - Site URL: `https://your-domain.com`
   - Redirect URLs: `https://your-domain.com/auth/callback`, `http://localhost:3000/auth/callback`
5. **Auth → Providers → Email**: keep *Confirm email* **on** in production (sign-up shows "check your inbox"). Set up custom SMTP (e.g. Resend) for reliable delivery — Supabase's built-in mailer is rate-limited.
6. **Auth → Providers → Google**: create an OAuth client in Google Cloud Console (type *Web application*), authorised redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, then paste the client ID/secret into Supabase.
7. Copy **Project Settings → API**: URL, `anon` key → `NEXT_PUBLIC_SUPABASE_*`; `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only).

The email links (verification, password reset) go to `/auth/callback`, which supports both the PKCE `code` flow and `token_hash` links.

---

## 3. OpenRouter

1. Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys) → `OPENROUTER_API_KEY`.
2. **Buy at least USD 10 of credits once.** Free (`:free`) model endpoints are limited to 50 requests/day account-wide until the account has purchased ≥ $10, after which the limit is 1,000/day (20/min). The app tracks these limits in Redis (`UNMETERED.freeEndpointPerDay` / `PerMinute` in `config/plans.ts`, overridable in Admin → Finance) and routes to paid fallbacks before hitting them.
3. In OpenRouter **Settings → Privacy**, allow the free endpoints you want to use. Several free providers log or train on prompts — that's why the app shows a notice on unmetered models and on the [privacy page](src/app/(marketing)/privacy/page.tsx).
4. Model IDs and prices in `src/lib/models/seed-data.ts` were taken from `https://openrouter.ai/api/v1/models` on 2026-11-10. Models change often:
   - `npm run sync:prices` (or Admin → Models → *Sync prices*) refreshes prices and context lengths and lists models that no longer exist.
   - A daily Vercel cron (`/api/cron/sync-prices`) does the same and emails the admin about missing models.
5. Real per-request cost comes from OpenRouter's usage accounting (`usage: { include: true }`), so frontier charges match what OpenRouter bills you.

> Note: at the time of writing, OpenRouter offers free endpoints for Google Gemma 4 and NVIDIA Nemotron, but **not** for DeepSeek, Qwen, GLM, MiniMax or Mistral. Those are included as unmetered models on their cheapest paid endpoint (≈ USD 0.0002–0.0005 per request), covered by the per-user fair-use cap and the global spend cap.

---

## 4. Stripe

1. **Currency**: the Stripe account must be able to charge in MYR (a Malaysian Stripe account).
2. **Pro product**: Products → *Add product* → "Pro", recurring price **RM 39 / month** (or your price). Copy the price ID → `STRIPE_PRICE_PRO_MONTHLY`. Keep the amount in sync with `PLANS.pro.priceMyr` (that value is only used for display and the calculator).
3. **Top-ups** need no products: Checkout uses inline `price_data` from `TOPUP_PACKS` in `config/plans.ts`.
4. **Payment methods** (Settings → Payment methods): enable Cards, and optionally **FPX** and **GrabPay** — Checkout offers them automatically for one-off top-ups (subscriptions are card-only because FPX/GrabPay don't support recurring charges).
5. **Customer Portal** (Settings → Billing → Customer portal): enable *Cancel subscription*, *Update payment method* and *Invoice history*.
6. **Webhook** (Developers → Webhooks → *Add endpoint*): `https://your-domain.com/api/webhooks/stripe` with events:
   ```
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   customer.subscription.paused
   customer.subscription.resumed
   invoice.paid
   charge.refunded
   ```
   Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
7. **Keys**: `STRIPE_SECRET_KEY` (use `sk_test_…` until launch).

**Testing webhooks locally** with the Stripe CLI:

```bash
stripe login
npm run stripe:listen                # prints a whsec_… secret → STRIPE_WEBHOOK_SECRET in .env.local
# In the app: Settings → Upgrade to Pro, pay with 4242 4242 4242 4242 (any future date / CVC)
stripe trigger checkout.session.completed   # synthetic events (no user metadata → logged and skipped)
stripe events resend <evt_id>                # replay: the app answers {"status":"duplicate"}
```

How webhooks stay safe:
- The signature is verified against the raw body; bad signatures get `400`.
- Every processed event id is stored in `stripe_events`; replays are skipped.
- Credit grants are additionally keyed by a unique ledger reference (`topup:<checkout session id>`), so even two different events for the same purchase can't grant twice.
- Handler errors return `500` so Stripe retries; all handlers are idempotent.
- `past_due` keeps Pro during Stripe's retry period and shows a *Payment failed — update your card* banner in Settings; `canceled`/`unpaid` switch the account back to Free.
- Upgrading mid-day immediately adds the difference between the Pro and Free daily allowance.

---

## 5. Upstash Redis

Create a Redis database at [upstash.com](https://upstash.com) (region near your Vercel functions) → `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.

Used for: per-user chat/auth/checkout rate limits, per-user unmetered fair-use counters, the account-wide free-endpoint counters (per minute and per day), endpoint cooldowns after a 429, the cached monthly spend, and once-per-month alert flags. Without these variables an in-memory store is used — fine for local dev, **not** for production (counters aren't shared between serverless instances).

---

## 6. Admin alerts (Resend)

At 80% and 100% of the monthly spend cap (and when synced models disappear from OpenRouter) the admin gets an email via [Resend](https://resend.com): set `RESEND_API_KEY`, `ALERT_EMAIL_FROM` (a verified domain) and `ADMIN_ALERT_EMAIL` (comma-separated). Without a key, alerts are written to the server log.

---

## 7. Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel (framework: Next.js).
2. Add **every** variable from `.env.example` in Project → Settings → Environment Variables (`MOCK_AI=0`, `NEXT_PUBLIC_SITE_URL=https://your-domain.com`, and a random `CRON_SECRET`).
3. Deploy. `vercel.json` registers the cron jobs:
   | Route | Schedule | Purpose |
   | --- | --- | --- |
   | `/api/cron/maintenance` | every 15 min | release stale credit holds, refresh monthly spend, send cap alerts |
   | `/api/cron/daily-grant` | 16:01 UTC (00:01 MYT) | pre-grant today's allowance to recently active users (optional — grants are also lazy) |
   | `/api/cron/sync-prices` | daily | sync model prices from OpenRouter |

   Vercel's Hobby plan only runs crons once a day; on Hobby, change the maintenance schedule to daily or call it from an external scheduler with `Authorization: Bearer $CRON_SECRET`.
4. Update the Supabase redirect URLs, Google OAuth and the Stripe webhook URL to the production domain.
5. Chat streams can run up to 300 s (`maxDuration` in `src/app/api/chat/route.ts`); this requires Vercel Fluid Compute (default on new projects).

---

## 8. Make your account an admin

Sign up normally, then run in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

(`npm run seed` also creates/promotes `DEMO_ADMIN_EMAIL`.) The admin area lives at `/admin`. The role is checked server-side in the admin layout and in every `/api/admin/*` route.

---

## 9. Changing prices and plans

All commercial values live in [`config/plans.ts`](config/plans.ts): credit name, credit rate, margin, plan allowances and prices, top-up packs, fair-use caps, free-endpoint limits, spend cap, payment fees and fixed costs.

Recommended workflow:
1. Open **Admin → Calculator**, adjust inputs, check the warnings and break-even numbers, save scenarios and compare them.
2. Click **Use these values** to get ready-to-paste `config/plans.ts` blocks. Nothing is applied automatically.
3. Paste, review the diff, deploy. If you change the Pro price, also create a new price in Stripe and update `STRIPE_PRICE_PRO_MONTHLY`.

Operational values (spend cap, fair-use caps, free-endpoint limits, a manual frontier kill-switch) can be overridden at runtime in **Admin → Finance → Operational settings** without a deploy.

---

## 10. How credits work

**Ledger.** `credit_transactions` is the source of truth (`daily_grant`, `usage`, `topup`, `refund`, `admin_adjust`). `credit_wallets` caches balances; every write happens inside a SQL function that locks the wallet row (`SELECT … FOR UPDATE`), so concurrent requests can't overspend. `reconcile_wallet()` recomputes the cache from the ledger.

**Two buckets.**
- *Daily*: granted per Asia/Kuala_Lumpur date. When a new day starts, the old remainder simply stops counting (no rollover) and a new `daily_grant` row is written — lazily on first use, or by the midnight cron. Invariant: `daily_balance = Σ daily rows for wallet.daily_date`.
- *Top-up*: purchased credits, never expire, spent only after the daily bucket is empty.

**Request flow.**

```
user prompt ─► /api/chat  (auth · Zod · rate limit)
  │
  ├─ unmetered model ─► fair-use check (Redis, per user per KL day)
  │     free-endpoint capacity check (account-wide 20/min, 1000/day; Free users stop at 70%, Pro at 90%)
  │     model:free ──429/5xx──► model (paid) ──fail──► fallback unmetered model …
  │     logged in usage_logs (cost tracked, 0 credits); notice shown if another model answered
  │
  └─ frontier model ─► spend cap reached? → "frontier models paused"
        estimate = (prompt tokens × in-price + max output × out-price) / rate × margin
        reserve_credits(): lock wallet · apply today's grant · available = daily + top-up − holds
             available < estimate → 402 with Upgrade / Top up / Switch to free buttons
             otherwise → pending hold (usage_logs.status = 'pending')
        stream from OpenRouter (usage accounting returns the real USD cost)
          ├─ answered (or stopped by user) → settle_usage(): charge actual cost, daily first, then top-up
          └─ failed before output / provider error → release_hold(): nothing charged
        stale holds (crashed requests) are released by the maintenance cron
```

`refund_usage()` reverses a settled charge into the buckets it came from (used for manual refunds); top-up purchases refunded in Stripe revoke their credits via the `charge.refunded` webhook.

**"~X credits/request"** in the model picker is a rolling average of the last 50 real charges per model, seeded from an estimate (1,500 input + 600 output tokens) until 3 samples exist.

**Spend cap.** Monthly paid OpenRouter spend (frontier + paid fallbacks) is tracked in Redis and the database. At 80% the admin is emailed; at 100% frontier models are disabled with a banner while unmetered models keep running; paid fallbacks continue until 110% of the cap, after which unmetered models use free endpoints only.

---

## 11. Calculator formulas

Implemented in [`src/lib/calculator/formulas.ts`](src/lib/calculator/formulas.ts) and unit-tested.

| Symbol | Meaning |
| --- | --- |
| r | USD value of 1 credit (`creditRateUsd`) |
| m_j | margin for model j (global multiplier or per-model override) |
| w_j | share of frontier usage on model j (normalised; one model = 100% in stress-test mode) |
| FX | USD → MYR |
| D | 30.4 days/month |
| A_p, A_f | Pro / Free daily allowance |
| U_p, U_f | Pro / Free utilisation (1.0 in worst case) |
| q, f, cf | unmetered requests/user/day, share served by paid fallback, USD per fallback |
| pct, fee | payment fee % and fixed MYR per transaction |

- AI cost per credit consumed: **k = Σ w_j · r / m_j**
- Credits per request on model j: **c_j = max(cost_j / r · m_j, min charge)**; requests/day = A / c_j
- Unmetered fallback per user/month: **UF = q · f · cf · D** (USD)
- AI cost per Pro user/month: **C_p = (A_p · U_p · D · k + UF) · FX**; Free: **C_f = (A_f · U_f · D · k + UF) · FX** (= cost per Free user)
- Revenue: **N_p · P + T · P_t − [pct · gross + fee · (N_p + T)]**
- AI cost: **N_p · C_p + N_f · C_f + T · credits_per_pack · k · FX** (top-up credits assumed fully used)
- Net = revenue − AI cost − fixed costs; margin = net / net revenue
- Per Pro user: revenue = P(1 − pct) − fee; profit = revenue − C_p (also shown at U = 1)
- Minimum Pro price: **(C_p + fee) / (1 − pct)**
- Maximum safe Pro allowance: **(P(1 − pct) − fee − UF·FX) / (U_p · D · k · FX)**
- Pro users to break even: **⌈(fixed + N_f · C_f − top-up profit) / Pro profit per user⌉**
- Warnings: loss per Pro user at 100% utilisation, worst-case monthly loss, any model whose credit price is below its real cost.

---

## 12. Project structure

```
config/plans.ts                 All pricing/plan values
supabase/migrations/            Schema, RLS, credit functions, admin aggregates
supabase/seed.sql               Generated model seed (local `supabase start`)
scripts/                        seed.ts, sync-openrouter-prices.ts
src/middleware.ts               Session refresh + /app, /admin protection
src/app/(marketing)/            Landing, pricing, privacy, terms, refund policy
src/app/(auth)/                 Login, sign-up, forgot/reset password, server actions
src/app/auth/callback/          Email + OAuth callback
src/app/app/                    Chat, conversation, compare, usage, settings
src/app/admin/                  Finance, models, users, calculator
src/app/api/chat/               Streaming chat (credits, failover, capacity)
src/app/api/webhooks/stripe/    Stripe webhook
src/app/api/billing/            Checkout (Pro, top-ups) + Customer Portal
src/app/api/cron/               Maintenance, daily grant, price sync
src/lib/ai/                     OpenRouter streamer (+ mock) and failover router
src/lib/credits/                Pricing math + ledger RPC wrappers
src/lib/capacity/               Free-endpoint counters, fair use, spend cap
src/lib/billing/                Stripe client, webhook handlers, Supabase store
src/lib/calculator/             Calculator formulas (pure)
src/components/                 UI (shadcn/ui primitives in components/ui)
tests/                          Vitest unit tests + PGlite database tests
```

---

## 13. Tests

```bash
npm test
```

- `tests/db/credits.test.ts` runs the **real migrations** on in-process Postgres (PGlite): deduction, holds, concurrency, daily-first spending, no-overdraft, settle idempotency, rolling averages, refunds, stale-hold cleanup, daily reset with no rollover, mid-day upgrade, top-up idempotency, admin adjustments, ledger reconciliation and RLS.
- `tests/unit/webhooks.test.ts`: Stripe event handling, replays, duplicate deliveries, subscription lifecycle, revenue records, refunds.
- `tests/unit/router.test.ts`: the unmetered failover chain and capacity routing.
- `tests/unit/calculator.test.ts`: every calculator formula, break-even round trips, CSV and plans.ts export.
- `tests/unit/misc.test.ts`: KL day boundaries, credit pricing, spend-cap states, history trimming, error parsing.

---

## 14. Security notes

- All API keys are server-only; only `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` and `NEXT_PUBLIC_SITE_URL` reach the browser.
- Row Level Security is enabled on every table. Users can read only their own rows. Balances, usage, billing and admin tables can't be written by users at all (column-level grants limit profile edits to name/avatar). Credit functions are `SECURITY DEFINER` and executable only by the service role.
- Zod validates every request body; chat, auth, checkout and compare endpoints are rate-limited.
- Admin pages and APIs check `profiles.role = 'admin'` server-side.
- Unmetered models show a notice that free endpoints may log prompts; the privacy page explains it.
- Legal pages (`/privacy`, `/terms`, `/refund-policy`) are placeholders — have them reviewed (PDPA 2010, Consumer Protection Act 1999) before launch.
