-- creates the accounts the scenarios buy for: one INDIVIDUAL (individual_signup, no brokerage involved) and seven brokerage evaluations, each owned by a user
set client_min_messages = warning;
create table public.fx_acct (label text primary key, brokerage_id uuid not null, user_n int not null);
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
insert into auth.users (id, email, email_confirmed_at) select pg_temp._u(g), 'u' || g || '@fx.test', now() from generate_series(1, 8) g;
do $$
declare t text; b uuid; lab text; n int; ev uuid;
begin
  perform 1 from public.individual_signup(pg_temp._u(1), 'Pat Agent');
  insert into public.fx_acct select 'ind', r.brokerage_id, 1 from public.brokerage_membership_of(pg_temp._u(1)) r;
  for lab, n in select * from (values ('brk', 2), ('ref', 3), ('sbx', 4), ('rst', 5), ('other', 6), ('pau', 7), ('chb', 8)) v(a, b) loop
    select c.owner_token, c.brokerage_id into t, b from public.evaluation_create('Acct ' || lab) c;
    perform 1 from public.evaluation_invite_redeem(t, pg_temp._u(n));
    insert into public.fx_acct values (lab, b, n);
  end loop;
end $$;
\copy (select label, brokerage_id from public.fx_acct order by label) to stdout
