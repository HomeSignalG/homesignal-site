-- contact_messages — backs the contact.html "Send message" form.
-- The static site INSERTs here with the PUBLIC anon key, so RLS must allow the
-- anon role to INSERT and nothing else (no select/update/delete for anon).
--
-- This is a PARKED reference for the Supabase project (qwnnmljucajnexpxdgxr); it is
-- NOT auto-applied by the static site. Apply it in the Supabase SQL editor, then verify
-- the policy list shows ONLY the anon INSERT policy below.

create table if not exists public.contact_messages (
  id          bigint generated always as identity primary key,
  name        text        not null,
  email       text        not null,
  message     text        not null,
  source      text        not null default 'contact_form',
  created_at  timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

-- Anonymous visitors may INSERT only. With RLS enabled and no SELECT/UPDATE/DELETE
-- policy for anon, all other operations are denied to anon by default.
drop policy if exists contact_messages_anon_insert on public.contact_messages;
create policy contact_messages_anon_insert
  on public.contact_messages
  for insert
  to anon
  with check (true);

-- Intentionally NO select/update/delete policies for the anon role. The service_role
-- (server side / Supabase dashboard / the zapier_write integration) is the table owner
-- and bypasses RLS, so it retains full read access for follow-up — that key must stay
-- server-side and is never referenced in the static site.

-- Verify after applying:
--   select polname, cmd, roles from pg_policies where tablename = 'contact_messages';
--   -> expect exactly one row: contact_messages_anon_insert / INSERT / {anon}
