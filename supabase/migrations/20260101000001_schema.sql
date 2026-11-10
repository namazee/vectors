-- =============================================================================
-- Core schema
-- =============================================================================

do $$ begin
  create type public.user_role as enum ('user', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.plan_id as enum ('free', 'pro');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.model_tier as enum ('unmetered', 'frontier');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.credit_kind as enum ('daily_grant', 'usage', 'topup', 'refund', 'admin_adjust');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.credit_bucket as enum ('daily', 'topup');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.usage_status as enum ('pending', 'settled', 'released', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  role public.user_role not null default 'user',
  plan public.plan_id not null default 'free',
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cached balances. The ledger (credit_transactions) is the source of truth;
-- reconcile_wallet() recomputes these from it.
create table if not exists public.credit_wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  daily_balance numeric(14, 4) not null default 0 check (daily_balance >= 0),
  daily_date date,
  topup_balance numeric(14, 4) not null default 0 check (topup_balance >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
create table if not exists public.models (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  provider text not null,
  -- Paid OpenRouter endpoint (frontier models, or paid fallback for unmetered).
  openrouter_id text not null,
  -- ":free" endpoint for unmetered models (nullable).
  free_openrouter_id text,
  -- Unmetered: slug of the next unmetered model to try if this one is down.
  fallback_model_slug text,
  tier public.model_tier not null,
  input_price_per_m numeric(12, 6) not null default 0,
  output_price_per_m numeric(12, 6) not null default 0,
  context_length integer,
  max_output_tokens integer,
  description text,
  logo text,
  active boolean not null default true,
  sort_order integer not null default 100,
  est_credits_per_request numeric(14, 4),
  avg_credits_per_request numeric(14, 4),
  avg_sample_count integer not null default 0,
  margin_override numeric(6, 3),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists models_active_sort_idx on public.models (tier, sort_order) where active;

-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'New chat',
  model_slug text,
  is_compare boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc);

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  model_slug text not null,
  served_model text,
  tier public.model_tier not null,
  plan public.plan_id not null default 'free',
  endpoint text check (endpoint in ('free', 'paid')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(14, 8) not null default 0,
  credits_reserved numeric(14, 4) not null default 0,
  credits_charged numeric(14, 4) not null default 0,
  credits_refunded numeric(14, 4) not null default 0,
  status public.usage_status not null default 'pending',
  fallback_reason text,
  error text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists usage_logs_user_created_idx on public.usage_logs (user_id, created_at desc);
create index if not exists usage_logs_created_idx on public.usage_logs (created_at desc);
create index if not exists usage_logs_pending_idx on public.usage_logs (user_id) where status = 'pending';
create index if not exists usage_logs_model_idx on public.usage_logs (model_slug, created_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  model_slug text,
  served_model text,
  credits_used numeric(14, 4) not null default 0,
  usage_log_id uuid references public.usage_logs (id) on delete set null,
  compare_group uuid,
  status text not null default 'complete' check (status in ('complete', 'stopped', 'error')),
  notice text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.credit_kind not null,
  bucket public.credit_bucket not null,
  amount numeric(14, 4) not null,
  -- For bucket = 'daily': the Asia/Kuala_Lumpur day this row belongs to.
  grant_date date,
  usage_log_id uuid references public.usage_logs (id) on delete set null,
  -- Idempotency key (e.g. 'daily:<user>:<date>:<amount>', 'topup:<checkout session>').
  reference text unique,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (bucket <> 'daily' or grant_date is not null)
);
create index if not exists credit_tx_user_created_idx on public.credit_transactions (user_id, created_at desc);
create index if not exists credit_tx_user_daily_idx on public.credit_transactions (user_id, grant_date) where bucket = 'daily';

-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id text primary key, -- Stripe subscription id
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null,
  price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

create table if not exists public.topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  pack_id text not null,
  credits numeric(14, 4) not null,
  amount_myr numeric(12, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists topups_user_idx on public.topups (user_id, created_at desc);

-- Stripe webhook idempotency.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pricing_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  inputs jsonb not null,
  outputs jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- New user → profile + wallet
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  insert into public.credit_wallets (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists models_touch on public.models;
create trigger models_touch before update on public.models for each row execute function public.touch_updated_at();
drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
