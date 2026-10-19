-- public.gov_notice_current_communities — DDL of record, READ BACK from production
-- 2026-10-19 (pg_get_viewdef md5 ef2b7d4d9fbf8389291d64d41ba3119b). Already applied; this
-- file records it so the repo carries the definition its one reader depends on.
--
-- WHY IT EXISTS. scripts/gen-gov-notice-coverage.mjs used to read public.alerts with the
-- anon key. Migration 20260926231526 phase3_revoke_anon_alerts_after_site_swap revoked anon
-- SELECT on the base table, and public.alerts_public (the site's replacement) does not carry
-- pipeline_type, so the generator failed with HTTP 401 from that day on (the `regenerate`
-- job, red on main since at least 2026-10-16). This view exposes exactly one column,
-- community_id, for exactly the generator's predicate.
--
-- THE WINDOW. Government notices with published_at inside the symmetric -90/+90 day
-- source-currentness window (founder ruling 2026-09-06; ceiling restored 2026-09-07), UTC
-- midnight bounds. These are the same bounds the generator sent as
-- published_at=gte.<date>&published_at=lte.<date> (PostgREST read the date strings as UTC
-- midnight). Measured 2026-10-19: 303 communities through the view, 303 through the old
-- predicate on public.alerts, 0 in either set and not the other.
--
-- ⚠️ This is NOT the -365/+730 record-eligibility window. Do not merge the two.
--
-- Owner-rights view (security_invoker = false) owned by postgres: anon cannot read
-- public.alerts, so the view runs with its owner's rights and returns community ids only.
create or replace view public.gov_notice_current_communities with (security_invoker = false) as
 SELECT DISTINCT community_id
   FROM alerts a
  WHERE pipeline_type = 'government_notice'::text AND community_id IS NOT NULL AND published_at >= (((now() AT TIME ZONE 'utc'::text)::date - 90)::timestamp without time zone AT TIME ZONE 'utc'::text) AND published_at <= (((now() AT TIME ZONE 'utc'::text)::date + 90)::timestamp without time zone AT TIME ZONE 'utc'::text);

comment on view public.gov_notice_current_communities is
  'Communities holding a government_notice alert inside the -90/+90 day source-currentness window (UTC midnight bounds). community_id only. Reader: scripts/gen-gov-notice-coverage.mjs. Owner-rights view: anon has no SELECT on public.alerts.';

grant select on public.gov_notice_current_communities to anon, authenticated, service_role;
