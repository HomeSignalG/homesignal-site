-- the fingerprint of the LEGACY brokerage's rows (account, memberships, evaluation, credits), taken before and after docs/individual-agent-signup.sql is applied
select md5(string_agg(x, '|' order by x)) as fp from (
  select 'a:' || a.id || a.name || a.status as x from public.brokerage_account a where a.name = 'Legacy Brokerage'
  union all select 'm:' || m.id || m.user_id || m.role || m.status from public.brokerage_member m join public.brokerage_account a on a.id = m.brokerage_id where a.name = 'Legacy Brokerage'
  union all select 'c:' || c.evaluation_id || c.ordinal || c.report_id from public.evaluation_credit c
  union all select 'e:' || e.evaluation_id || e.status || coalesce(e.seat_limit::text, 'n') from public.evaluation e join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Legacy Brokerage') q \gset
\qecho :fp
