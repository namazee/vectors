-- =============================================================================
-- Revenue records (from Stripe webhooks) and admin/usage aggregate functions
-- =============================================================================

create table if not exists public.payments (
  id text primary key,                 -- Stripe invoice id or checkout session id
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('subscription', 'topup')),
  plan public.plan_id,
  amount_myr numeric(12, 2) not null,
  currency text not null default 'myr',
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  created_at timestamptz not null default now()
);
create index if not exists payments_created_idx on public.payments (created_at desc);
alter table public.payments enable row level security;
-- No policies: service role only.

-- Spend & credits per model over a period.
create or replace function public.admin_usage_by_model(p_from timestamptz, p_to timestamptz)
returns table (model_slug text, tier public.model_tier, requests bigint, paid_requests bigint, fallback_requests bigint,
               cost_usd numeric, credits_charged numeric, input_tokens bigint, output_tokens bigint)
language sql stable security definer set search_path = public as $$
  select model_slug, tier,
         count(*) as requests,
         count(*) filter (where endpoint = 'paid') as paid_requests,
         count(*) filter (where fallback_reason is not null) as fallback_requests,
         coalesce(sum(cost_usd), 0) as cost_usd,
         coalesce(sum(credits_charged - credits_refunded), 0) as credits_charged,
         coalesce(sum(input_tokens), 0)::bigint, coalesce(sum(output_tokens), 0)::bigint
    from public.usage_logs
   where created_at >= p_from and created_at < p_to and status in ('settled', 'failed', 'released')
   group by model_slug, tier
   order by cost_usd desc;
$$;

-- Spend & credits per plan over a period.
create or replace function public.admin_usage_by_plan(p_from timestamptz, p_to timestamptz)
returns table (plan public.plan_id, users bigint, requests bigint, cost_usd numeric, frontier_cost_usd numeric,
               unmetered_cost_usd numeric, credits_charged numeric)
language sql stable security definer set search_path = public as $$
  select plan,
         count(distinct user_id) as users,
         count(*) as requests,
         coalesce(sum(cost_usd), 0),
         coalesce(sum(cost_usd) filter (where tier = 'frontier'), 0),
         coalesce(sum(cost_usd) filter (where tier = 'unmetered'), 0),
         coalesce(sum(credits_charged - credits_refunded), 0)
    from public.usage_logs
   where created_at >= p_from and created_at < p_to
   group by plan;
$$;

-- Heaviest users by real cost.
create or replace function public.admin_top_users(p_from timestamptz, p_to timestamptz, p_limit integer default 20)
returns table (user_id uuid, email text, plan public.plan_id, requests bigint, cost_usd numeric, credits_charged numeric)
language sql stable security definer set search_path = public as $$
  select u.user_id, p.email, p.plan, count(*) as requests,
         coalesce(sum(u.cost_usd), 0) as cost_usd,
         coalesce(sum(u.credits_charged - u.credits_refunded), 0) as credits_charged
    from public.usage_logs u
    join public.profiles p on p.id = u.user_id
   where u.created_at >= p_from and u.created_at < p_to
   group by u.user_id, p.email, p.plan
   order by cost_usd desc
   limit p_limit;
$$;

-- Daily spend (KL days) for charts.
create or replace function public.admin_daily_spend(p_days integer default 30)
returns table (day date, cost_usd numeric, frontier_cost_usd numeric, unmetered_cost_usd numeric, requests bigint)
language sql stable security definer set search_path = public as $$
  select (created_at at time zone 'Asia/Kuala_Lumpur')::date as day,
         coalesce(sum(cost_usd), 0),
         coalesce(sum(cost_usd) filter (where tier = 'frontier'), 0),
         coalesce(sum(cost_usd) filter (where tier = 'unmetered'), 0),
         count(*)
    from public.usage_logs
   where created_at >= now() - make_interval(days => p_days)
   group by 1
   order by 1;
$$;

-- Per-user list for the admin Users page.
create or replace function public.admin_list_users(p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, email text, display_name text, role public.user_role, plan public.plan_id, created_at timestamptz,
               daily_balance numeric, daily_date date, topup_balance numeric,
               requests_30d bigint, cost_usd_30d numeric, credits_30d numeric, total_count bigint)
language sql stable security definer set search_path = public as $$
  with filtered as (
    select p.* from public.profiles p
     where p_search is null or p_search = ''
        or p.email ilike '%' || p_search || '%' or p.display_name ilike '%' || p_search || '%'
  ), usage as (
    select user_id, count(*) as requests, sum(cost_usd) as cost, sum(credits_charged - credits_refunded) as credits
      from public.usage_logs
     where created_at >= now() - interval '30 days' and user_id in (select id from filtered)
     group by user_id
  )
  select f.id, f.email, f.display_name, f.role, f.plan, f.created_at,
         coalesce(w.daily_balance, 0), w.daily_date, coalesce(w.topup_balance, 0),
         coalesce(u.requests, 0), coalesce(u.cost, 0), coalesce(u.credits, 0),
         count(*) over ()
    from filtered f
    left join public.credit_wallets w on w.user_id = f.id
    left join usage u on u.user_id = f.id
   order by coalesce(u.cost, 0) desc, f.created_at desc
   limit p_limit offset p_offset;
$$;

-- Credits per model per KL day for one user (Usage page).
create or replace function public.user_usage_daily(p_user uuid, p_days integer default 30)
returns table (day date, model_slug text, requests bigint, credits numeric)
language sql stable security definer set search_path = public as $$
  select (created_at at time zone 'Asia/Kuala_Lumpur')::date as day, model_slug,
         count(*) as requests,
         coalesce(sum(credits_charged - credits_refunded), 0) as credits
    from public.usage_logs
   where user_id = p_user
     and created_at >= now() - make_interval(days => p_days)
     and status in ('settled')
   group by 1, 2
   order by 1, 2;
$$;

revoke all on function public.admin_usage_by_model(timestamptz, timestamptz) from public;
revoke all on function public.admin_usage_by_plan(timestamptz, timestamptz) from public;
revoke all on function public.admin_top_users(timestamptz, timestamptz, integer) from public;
revoke all on function public.admin_daily_spend(integer) from public;
revoke all on function public.admin_list_users(text, integer, integer) from public;
revoke all on function public.user_usage_daily(uuid, integer) from public;
grant execute on function public.admin_usage_by_model(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_usage_by_plan(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_top_users(timestamptz, timestamptz, integer) to service_role;
grant execute on function public.admin_daily_spend(integer) to service_role;
grant execute on function public.admin_list_users(text, integer, integer) to service_role;
grant execute on function public.user_usage_daily(uuid, integer) to service_role;
