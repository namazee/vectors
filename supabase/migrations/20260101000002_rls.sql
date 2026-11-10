-- =============================================================================
-- Row Level Security
-- Users can only see their own data. Credits, usage, billing and admin tables
-- are written exclusively by the server (service role) via SECURITY DEFINER
-- functions; authenticated users get read-only access to their own rows.
-- =============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.models enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.usage_logs enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.topups enable row level security;
alter table public.stripe_events enable row level security;
alter table public.pricing_scenarios enable row level security;
alter table public.app_settings enable row level security;

-- profiles: read own; update only display_name / avatar_url (column grants below)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- wallets / ledger / usage / billing: read own only
drop policy if exists "wallets_select_own" on public.credit_wallets;
create policy "wallets_select_own" on public.credit_wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists "credit_tx_select_own" on public.credit_transactions;
create policy "credit_tx_select_own" on public.credit_transactions for select to authenticated using (user_id = auth.uid());
drop policy if exists "usage_select_own" on public.usage_logs;
create policy "usage_select_own" on public.usage_logs for select to authenticated using (user_id = auth.uid());
drop policy if exists "subs_select_own" on public.subscriptions;
create policy "subs_select_own" on public.subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "topups_select_own" on public.topups;
create policy "topups_select_own" on public.topups for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.credit_wallets, public.credit_transactions, public.usage_logs,
  public.subscriptions, public.topups from authenticated, anon;

-- models: anyone can read active models
drop policy if exists "models_select_active" on public.models;
create policy "models_select_active" on public.models for select to anon, authenticated using (active);
revoke insert, update, delete on public.models from authenticated, anon;

-- conversations: full CRUD on own
drop policy if exists "conversations_all_own" on public.conversations;
create policy "conversations_all_own" on public.conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- messages: read / delete own; inserts go through the server
drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own" on public.messages for select to authenticated using (user_id = auth.uid());
drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.messages from authenticated, anon;

-- stripe_events, pricing_scenarios, app_settings: no policies → service role only.
