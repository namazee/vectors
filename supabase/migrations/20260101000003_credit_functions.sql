-- =============================================================================
-- Credit ledger functions
--
-- All balance-changing operations run inside a single transaction that locks the
-- user's wallet row (SELECT ... FOR UPDATE), so concurrent requests for the same
-- user are serialised and can never overspend.
--
-- Daily allowance model:
--   * The daily bucket belongs to one Asia/Kuala_Lumpur date (wallet.daily_date).
--   * When a new day starts, the previous day's remainder simply stops counting
--     (no rollover) and a 'daily_grant' row for the new day is written.
--   * Ledger invariant:
--       daily_balance = SUM(amount) WHERE bucket='daily' AND grant_date = daily_date
--       topup_balance = SUM(amount) WHERE bucket='topup'
--
-- Usage flow: reserve_credits (hold) → settle_usage (charge actual) or
-- release_hold (no charge). refund_usage reverses a settled charge.
--
-- These functions are only executable by the service role.
-- =============================================================================

-- Today's date in Kuala Lumpur.
create or replace function public.kl_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;

-- Internal: assumes the wallet row is already locked by the caller.
create or replace function public._apply_daily_grant(p_user uuid, p_today date, p_daily_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.credit_wallets%rowtype;
  v_granted numeric;
  v_diff numeric;
begin
  select * into v_wallet from public.credit_wallets where user_id = p_user;

  if v_wallet.daily_date is distinct from p_today then
    -- New day: yesterday's remainder expires (no rollover).
    update public.credit_wallets
       set daily_balance = 0, daily_date = p_today, updated_at = now()
     where user_id = p_user;
  end if;

  select coalesce(sum(amount), 0) into v_granted
    from public.credit_transactions
   where user_id = p_user and kind = 'daily_grant' and grant_date = p_today;

  -- Grant the allowance, or top up the difference after a mid-day upgrade.
  v_diff := p_daily_amount - v_granted;
  if v_diff > 0 then
    insert into public.credit_transactions (user_id, kind, bucket, amount, grant_date, reference, note)
    values (p_user, 'daily_grant', 'daily', v_diff, p_today,
            'daily:' || p_user || ':' || p_today || ':' || p_daily_amount,
            case when v_granted > 0 then 'Plan upgrade top-up' else 'Daily allowance' end)
    on conflict (reference) do nothing;
    if found then
      update public.credit_wallets
         set daily_balance = daily_balance + v_diff, updated_at = now()
       where user_id = p_user;
    end if;
  end if;
end;
$$;

-- Lock (creating if missing) the wallet and apply today's grant.
create or replace function public._lock_wallet(p_user uuid, p_today date, p_daily_amount numeric)
returns public.credit_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.credit_wallets%rowtype;
begin
  insert into public.credit_wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from public.credit_wallets where user_id = p_user for update;
  perform public._apply_daily_grant(p_user, p_today, p_daily_amount);
  select * into v_wallet from public.credit_wallets where user_id = p_user;
  return v_wallet;
end;
$$;

create or replace function public._held_credits(p_user uuid, p_ttl_minutes integer)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(credits_reserved), 0)
    from public.usage_logs
   where user_id = p_user
     and status = 'pending'
     and tier = 'frontier'
     and created_at > now() - make_interval(mins => p_ttl_minutes);
$$;

-- Public: current balances (applies the daily grant if needed).
create or replace function public.get_wallet(
  p_user uuid,
  p_daily_amount numeric,
  p_today date default null,
  p_hold_ttl_minutes integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, public.kl_today());
  v_wallet public.credit_wallets%rowtype;
  v_held numeric;
begin
  v_wallet := public._lock_wallet(p_user, v_today, p_daily_amount);
  v_held := public._held_credits(p_user, p_hold_ttl_minutes);
  return jsonb_build_object(
    'daily', v_wallet.daily_balance,
    'topup', v_wallet.topup_balance,
    'held', v_held,
    'available', greatest(v_wallet.daily_balance + v_wallet.topup_balance - v_held, 0),
    'daily_date', v_wallet.daily_date
  );
end;
$$;

-- Public: place a hold for an estimated max cost.
create or replace function public.reserve_credits(
  p_user uuid,
  p_daily_amount numeric,
  p_estimate numeric,
  p_model_slug text,
  p_plan public.plan_id,
  p_conversation_id uuid default null,
  p_today date default null,
  p_hold_ttl_minutes integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, public.kl_today());
  v_wallet public.credit_wallets%rowtype;
  v_held numeric;
  v_available numeric;
  v_log_id uuid;
begin
  if p_estimate < 0 then
    raise exception 'estimate must be >= 0';
  end if;

  v_wallet := public._lock_wallet(p_user, v_today, p_daily_amount);
  v_held := public._held_credits(p_user, p_hold_ttl_minutes);
  v_available := v_wallet.daily_balance + v_wallet.topup_balance - v_held;

  if v_available < p_estimate then
    return jsonb_build_object('ok', false, 'available', greatest(v_available, 0), 'required', p_estimate);
  end if;

  insert into public.usage_logs (user_id, conversation_id, model_slug, tier, plan, credits_reserved, status)
  values (p_user, p_conversation_id, p_model_slug, 'frontier', p_plan, p_estimate, 'pending')
  returning id into v_log_id;

  return jsonb_build_object('ok', true, 'usage_log_id', v_log_id, 'available', v_available - p_estimate);
end;
$$;

-- Public: charge the actual cost for a pending hold (idempotent).
create or replace function public.settle_usage(
  p_log_id uuid,
  p_credits numeric,
  p_cost_usd numeric,
  p_input_tokens integer,
  p_output_tokens integer,
  p_served_model text,
  p_daily_amount numeric,
  p_latency_ms integer default null,
  p_today date default null,
  p_avg_window integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, public.kl_today());
  v_log public.usage_logs%rowtype;
  v_wallet public.credit_wallets%rowtype;
  v_charge numeric;
  v_from_daily numeric;
  v_from_topup numeric;
  v_n integer;
begin
  select * into v_log from public.usage_logs where id = p_log_id;
  if not found then
    raise exception 'usage log % not found', p_log_id;
  end if;

  -- Lock wallet first, then re-read the log under the lock (idempotency).
  v_wallet := public._lock_wallet(v_log.user_id, v_today, p_daily_amount);
  select * into v_log from public.usage_logs where id = p_log_id for update;
  if v_log.status <> 'pending' then
    return jsonb_build_object('ok', true, 'already', true, 'charged', v_log.credits_charged);
  end if;

  -- Never take the balance below zero; any overage is absorbed (and visible in logs).
  v_charge := least(greatest(p_credits, 0), v_wallet.daily_balance + v_wallet.topup_balance);
  v_from_daily := least(v_charge, v_wallet.daily_balance);
  v_from_topup := v_charge - v_from_daily;

  if v_from_daily > 0 then
    insert into public.credit_transactions (user_id, kind, bucket, amount, grant_date, usage_log_id, reference)
    values (v_log.user_id, 'usage', 'daily', -v_from_daily, v_today, p_log_id, 'usage:daily:' || p_log_id);
  end if;
  if v_from_topup > 0 then
    insert into public.credit_transactions (user_id, kind, bucket, amount, usage_log_id, reference)
    values (v_log.user_id, 'usage', 'topup', -v_from_topup, p_log_id, 'usage:topup:' || p_log_id);
  end if;

  update public.credit_wallets
     set daily_balance = daily_balance - v_from_daily,
         topup_balance = topup_balance - v_from_topup,
         updated_at = now()
   where user_id = v_log.user_id;

  update public.usage_logs
     set status = 'settled',
         credits_charged = v_charge,
         cost_usd = p_cost_usd,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         served_model = p_served_model,
         endpoint = 'paid',
         latency_ms = p_latency_ms,
         settled_at = now()
   where id = p_log_id;

  -- Rolling average credits/request for the model picker.
  update public.models
     set avg_sample_count = least(avg_sample_count + 1, p_avg_window),
         avg_credits_per_request = case
           when avg_credits_per_request is null or avg_sample_count = 0 then p_credits
           else avg_credits_per_request + (p_credits - avg_credits_per_request) / least(avg_sample_count + 1, p_avg_window)
         end
   where slug = v_log.model_slug;

  return jsonb_build_object(
    'ok', true,
    'charged', v_charge,
    'from_daily', v_from_daily,
    'from_topup', v_from_topup,
    'uncovered', greatest(p_credits - v_charge, 0)
  );
end;
$$;

-- Public: release a hold without charging (request failed before any output).
create or replace function public.release_hold(
  p_log_id uuid,
  p_error text default null,
  p_cost_usd numeric default 0
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.usage_logs
     set status = 'released', error = p_error, cost_usd = coalesce(p_cost_usd, 0), settled_at = now()
   where id = p_log_id and status = 'pending';
  return found;
end;
$$;

-- Public: reverse a settled charge, returning credits to the buckets they came from.
-- Daily credits from a past day are returned to today's daily bucket.
create or replace function public.refund_usage(
  p_log_id uuid,
  p_daily_amount numeric,
  p_reason text default 'Automatic refund',
  p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, public.kl_today());
  v_log public.usage_logs%rowtype;
  v_daily numeric;
  v_topup numeric;
begin
  select * into v_log from public.usage_logs where id = p_log_id;
  if not found then
    raise exception 'usage log % not found', p_log_id;
  end if;
  perform public._lock_wallet(v_log.user_id, v_today, p_daily_amount);
  select * into v_log from public.usage_logs where id = p_log_id for update;

  if v_log.status <> 'settled' or v_log.credits_refunded > 0 or v_log.credits_charged = 0 then
    return jsonb_build_object('ok', true, 'refunded', 0);
  end if;

  select coalesce(-sum(amount) filter (where bucket = 'daily'), 0),
         coalesce(-sum(amount) filter (where bucket = 'topup'), 0)
    into v_daily, v_topup
    from public.credit_transactions
   where usage_log_id = p_log_id and kind = 'usage';

  if v_daily > 0 then
    insert into public.credit_transactions (user_id, kind, bucket, amount, grant_date, usage_log_id, reference, note)
    values (v_log.user_id, 'refund', 'daily', v_daily, v_today, p_log_id, 'refund:daily:' || p_log_id, p_reason);
  end if;
  if v_topup > 0 then
    insert into public.credit_transactions (user_id, kind, bucket, amount, usage_log_id, reference, note)
    values (v_log.user_id, 'refund', 'topup', v_topup, p_log_id, 'refund:topup:' || p_log_id, p_reason);
  end if;

  update public.credit_wallets
     set daily_balance = daily_balance + v_daily,
         topup_balance = topup_balance + v_topup,
         updated_at = now()
   where user_id = v_log.user_id;

  update public.usage_logs
     set credits_refunded = v_daily + v_topup, error = coalesce(error, p_reason)
   where id = p_log_id;

  return jsonb_build_object('ok', true, 'refunded', v_daily + v_topup);
end;
$$;

-- Public: record an unmetered request (no credits) for analytics / spend tracking.
create or replace function public.log_unmetered_usage(
  p_user uuid,
  p_conversation_id uuid,
  p_model_slug text,
  p_served_model text,
  p_plan public.plan_id,
  p_endpoint text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric,
  p_fallback_reason text,
  p_latency_ms integer,
  p_status public.usage_status default 'settled',
  p_error text default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.usage_logs (user_id, conversation_id, model_slug, served_model, tier, plan, endpoint,
                                 input_tokens, output_tokens, cost_usd, status, fallback_reason, latency_ms,
                                 error, settled_at)
  values (p_user, p_conversation_id, p_model_slug, p_served_model, 'unmetered', p_plan, p_endpoint,
          p_input_tokens, p_output_tokens, p_cost_usd, p_status, p_fallback_reason, p_latency_ms, p_error, now())
  returning id;
$$;

-- Public: credit a top-up purchase (idempotent on p_reference).
create or replace function public.grant_topup(
  p_user uuid,
  p_credits numeric,
  p_reference text,
  p_note text default 'Top-up purchase'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_credits <= 0 then
    raise exception 'credits must be positive';
  end if;
  insert into public.credit_wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from public.credit_wallets where user_id = p_user for update;

  insert into public.credit_transactions (user_id, kind, bucket, amount, reference, note)
  values (p_user, 'topup', 'topup', p_credits, p_reference, p_note)
  on conflict (reference) do nothing;
  if not found then
    return false; -- already granted
  end if;

  update public.credit_wallets set topup_balance = topup_balance + p_credits, updated_at = now()
   where user_id = p_user;
  return true;
end;
$$;

-- Public: admin manual adjustment (positive or negative). Never below zero.
create or replace function public.admin_adjust_credits(
  p_user uuid,
  p_amount numeric,
  p_bucket public.credit_bucket,
  p_note text,
  p_admin uuid,
  p_daily_amount numeric,
  p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, public.kl_today());
  v_wallet public.credit_wallets%rowtype;
  v_amount numeric := p_amount;
begin
  v_wallet := public._lock_wallet(p_user, v_today, p_daily_amount);
  if p_bucket = 'daily' and v_wallet.daily_balance + v_amount < 0 then
    v_amount := -v_wallet.daily_balance;
  elsif p_bucket = 'topup' and v_wallet.topup_balance + v_amount < 0 then
    v_amount := -v_wallet.topup_balance;
  end if;
  if v_amount = 0 then
    return jsonb_build_object('ok', true, 'applied', 0);
  end if;

  insert into public.credit_transactions (user_id, kind, bucket, amount, grant_date, note, created_by)
  values (p_user, 'admin_adjust', p_bucket, v_amount,
          case when p_bucket = 'daily' then v_today end, p_note, p_admin);

  update public.credit_wallets
     set daily_balance = daily_balance + case when p_bucket = 'daily' then v_amount else 0 end,
         topup_balance = topup_balance + case when p_bucket = 'topup' then v_amount else 0 end,
         updated_at = now()
   where user_id = p_user;
  return jsonb_build_object('ok', true, 'applied', v_amount);
end;
$$;

-- Public: recompute cached balances from the ledger. Returns drift found.
create or replace function public.reconcile_wallet(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.credit_wallets%rowtype;
  v_daily numeric;
  v_topup numeric;
  v_drift_daily numeric;
  v_drift_topup numeric;
begin
  select * into v_wallet from public.credit_wallets where user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  select coalesce(sum(amount), 0) into v_daily from public.credit_transactions
   where user_id = p_user and bucket = 'daily' and grant_date = v_wallet.daily_date;
  select coalesce(sum(amount), 0) into v_topup from public.credit_transactions
   where user_id = p_user and bucket = 'topup';
  v_drift_daily := v_wallet.daily_balance - v_daily;
  v_drift_topup := v_wallet.topup_balance - v_topup;
  if v_drift_daily <> 0 or v_drift_topup <> 0 then
    update public.credit_wallets set daily_balance = greatest(v_daily, 0), topup_balance = greatest(v_topup, 0), updated_at = now()
     where user_id = p_user;
  end if;
  return jsonb_build_object('ok', true, 'drift_daily', v_drift_daily, 'drift_topup', v_drift_topup);
end;
$$;

-- Public: release holds that were never settled (crashed requests).
create or replace function public.release_stale_holds(p_ttl_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.usage_logs
     set status = 'released', error = coalesce(error, 'Hold expired'), settled_at = now()
   where status = 'pending' and created_at < now() - make_interval(mins => p_ttl_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Total paid OpenRouter spend in the current calendar month (UTC).
create or replace function public.monthly_paid_spend()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)
    from public.usage_logs
   where created_at >= date_trunc('month', now())
     and endpoint = 'paid';
$$;

-- Lock down: only the service role may call these.
revoke all on function public._apply_daily_grant(uuid, date, numeric) from public;
revoke all on function public._lock_wallet(uuid, date, numeric) from public;
revoke all on function public._held_credits(uuid, integer) from public;
revoke all on function public.get_wallet(uuid, numeric, date, integer) from public;
revoke all on function public.reserve_credits(uuid, numeric, numeric, text, public.plan_id, uuid, date, integer) from public;
revoke all on function public.settle_usage(uuid, numeric, numeric, integer, integer, text, numeric, integer, date, integer) from public;
revoke all on function public.release_hold(uuid, text, numeric) from public;
revoke all on function public.refund_usage(uuid, numeric, text, date) from public;
revoke all on function public.log_unmetered_usage(uuid, uuid, text, text, public.plan_id, text, integer, integer, numeric, text, integer, public.usage_status, text) from public;
revoke all on function public.grant_topup(uuid, numeric, text, text) from public;
revoke all on function public.admin_adjust_credits(uuid, numeric, public.credit_bucket, text, uuid, numeric, date) from public;
revoke all on function public.reconcile_wallet(uuid) from public;
revoke all on function public.release_stale_holds(integer) from public;
revoke all on function public.monthly_paid_spend() from public;

grant execute on function public.get_wallet(uuid, numeric, date, integer) to service_role;
grant execute on function public.reserve_credits(uuid, numeric, numeric, text, public.plan_id, uuid, date, integer) to service_role;
grant execute on function public.settle_usage(uuid, numeric, numeric, integer, integer, text, numeric, integer, date, integer) to service_role;
grant execute on function public.release_hold(uuid, text, numeric) to service_role;
grant execute on function public.refund_usage(uuid, numeric, text, date) to service_role;
grant execute on function public.log_unmetered_usage(uuid, uuid, text, text, public.plan_id, text, integer, integer, numeric, text, integer, public.usage_status, text) to service_role;
grant execute on function public.grant_topup(uuid, numeric, text, text) to service_role;
grant execute on function public.admin_adjust_credits(uuid, numeric, public.credit_bucket, text, uuid, numeric, date) to service_role;
grant execute on function public.reconcile_wallet(uuid) to service_role;
grant execute on function public.release_stale_holds(integer) to service_role;
grant execute on function public.monthly_paid_spend() to service_role;
