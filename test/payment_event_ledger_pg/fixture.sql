-- Disposable stand-in for the parts of production the payment-event ledger touches. NEVER applied to
-- production: run.sh refuses unless PGDATABASE names a disposable database.
--   * the Supabase roles, and Supabase's DEFAULT PRIVILEGES (every new table, sequence and function in `public`
--     is granted to anon, authenticated and service_role), so the lock-down in docs/payment-event-ledger.sql is
--     tested against the posture that actually needs undoing.
--   * a stand-in for public.subscriptions, the mutable per-user table the deployed webhook writes and the map
--     product's paywall reads (shape read from production by the Order M audit, 2026-10-01: 12 columns, a status
--     CHECK, UNIQUE(processor_subscription_id); its FK to auth.users is not reproduced). It carries a TRAP: any
--     statement that touches it raises. The ledger must never write to it (entitlement is Order L's function),
--     so a recorder that does so fails every check that records an event, instead of passing quietly.
-- The ledger itself depends on no other table, so nothing else is stood in.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin; end if;
end $$;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.subscriptions (
  id                        uuid        primary key default gen_random_uuid(),
  user_id                   uuid        not null,
  status                    text        not null,
  plan                      text,
  processor_customer_id     text,
  processor_subscription_id text        unique,
  trial_end                 timestamptz,
  current_period_end        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  processor                 text        not null default 'lemonsqueezy',
  email                     text,
  constraint subscriptions_status_check check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'))
);

create function public.subscriptions_trap() returns trigger language plpgsql as $$
begin
  raise exception 'TRAP: public.subscriptions was touched (% refused)', tg_op;
end $$;
create trigger subscriptions_trap_row before insert or update or delete on public.subscriptions
  for each row execute function public.subscriptions_trap();
create trigger subscriptions_trap_truncate before truncate on public.subscriptions
  for each statement execute function public.subscriptions_trap();
