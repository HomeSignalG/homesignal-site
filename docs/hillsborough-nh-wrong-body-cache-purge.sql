-- hillsborough-nh-wrong-body-cache-purge.sql — ONE-TIME, provenance-scoped cache surgery.
--
-- DO NOT RE-APPLY. Re-measured 2026-09-09 17:08Z: Florida-host app_changes on the
-- 34 NH ZIPs = 0; Florida-host sites in those 34 development_reports rows = 0;
-- 33602 control still has the host. The fail-closed 884-site gate below will
-- RAISE, which is the correct refusal now that the residue is gone.
--
-- WHAT THIS FINISHES. Ingest PR #482 (2026-09-07) + load-feeds-to-db deactivated
-- gov-hillsborough-nh-commission (WRONG STATE: hillsboroughcounty.legistar.com is
-- Hillsborough County FLORIDA). WRITE 1 on 2026-09-09 15:19:32Z archived-then-deleted
-- the 26 refill government_notice alerts off community
-- bac33320-b4e9-42de-ae72-54d2b06226ba. WRITE 2 rematerialized the 34 NH ZIP pages;
-- app_refresh_zip line 28 deletes app_changes where zip=_zip unscoped, then
-- re-inserts from public.dev_sites_deduped(_zip) — the Map 1 development_reports
-- cache. The 238 remaining Florida app_changes (7 per ZIP × 34) were therefore
-- re-inserted from this cache, not left behind.
--
-- WHY WAITING ON THE ROLLING REFRESH IS THE SLOW PATH, NOT THE REQUIRED ONE.
-- Live engine get-address-report {zip:03101} on 2026-09-09 returned 0 sites whose
-- url host is hillsboroughcounty.legistar.com (33602 control: 26). CORE GUARD 2
-- only refuses a drop to zero, so a later collect would self-heal. Queue ahead of
-- Z is thousands of older rows (~11–27 h). This file is the scoped Map 1 unit:
-- strip the Florida-host elements and recompute counts in the SAME statement.
--
-- PRECEDENT: docs/bethelak-wrong-body-cache-purge.sql (same shape, different host).
--
-- SCOPE PROOF (measured 2026-09-09 before writing, PostgREST, anon read):
--   • NH county community has 34 zip_codes (includes 03101, 03060)
--   • development_reports table-wide = 12,722 (Gold Master)
--   • 34/34 of those ZIPs carry exactly 26 sites whose url/record_url host is
--     hillsboroughcounty.legistar.com (884 = 26 × 34)
--   • 33602 positive control carries 26 of the same host (must stay)
--   • remaining sites after a host-strip are all scope=point (0 area leftover)
--   • app_projects on Z carry 0 of that host (area items never landed there)
--   • app_changes on Z carry 238 of that host — cleaned ONLY by app_refresh_zip
--     after this UPDATE, which this file also does
--
-- The ZIP set is computed from communities.zip_codes (rule 7: never transcribed).
-- Surviving sites keep order (WITH ORDINALITY). Untouched rows are untouched.
-- counts.{proposed,approved,operating,development,civic,comment_open} are
-- recomputed from the surviving array so they match verify-development Task 5.
-- counts.facilities is left as stored (facility sites are point/EPA; none of
-- the Florida-host rows are facilities).

begin;

-- ── 0. fail-closed gates (a wrong ZIP set or a moved residue STOPS the write)
do $$
declare
  n_zips int;
  n_state text;
  n_name text;
  n_level text;
  n_fl_rows int;
  n_fl_sites int;
  n_dr int;
  n_ctrl int;
begin
  select count(z), max(c.state), max(c.name), max(c.level)
    into n_zips, n_state, n_name, n_level
    from public.communities c, unnest(c.zip_codes) as z
   where c.id = 'bac33320-b4e9-42de-ae72-54d2b06226ba';
  if n_zips is distinct from 34
     or n_state is distinct from 'NH'
     or n_name is distinct from 'Hillsborough County'
     or n_level is distinct from 'county' then
    raise exception 'NH community fingerprint drifted: zips=% state=% name=% level=%',
      n_zips, n_state, n_name, n_level;
  end if;

  select count(*) into n_dr from public.development_reports;
  if n_dr is distinct from 12722 then
    raise exception 'development_reports n=% <> 12722 Gold Master — STOP', n_dr;
  end if;

  select count(distinct r.zip), count(*)
    into n_fl_rows, n_fl_sites
    from public.development_reports r
    join public.communities c on c.id = 'bac33320-b4e9-42de-ae72-54d2b06226ba'
     and r.zip = any (c.zip_codes),
         jsonb_array_elements(r.sites) s
   where lower(substring(coalesce(nullif(s->>'url',''), nullif(s->>'record_url',''), '')
                         from '^[a-zA-Z]+://([^/:]+)'))
         = 'hillsboroughcounty.legistar.com';
  if n_fl_rows is distinct from 34 or n_fl_sites is distinct from 884 then
    raise exception 'NH FL-host cache residue drifted: rows=% sites=% (want 34/884) — STOP',
      n_fl_rows, n_fl_sites;
  end if;

  select count(*) into n_ctrl
    from public.development_reports r, jsonb_array_elements(r.sites) s
   where r.zip = '33602'
     and lower(substring(coalesce(nullif(s->>'url',''), nullif(s->>'record_url',''), '')
                         from '^[a-zA-Z]+://([^/:]+)'))
         = 'hillsboroughcounty.legistar.com';
  if n_ctrl < 1 then
    raise exception '33602 positive control has 0 FL-host sites — host filter is wrong — STOP';
  end if;
end $$;

-- ── 1. strip + recompute counts on the 34 NH rows only
with z as (
  select unnest(zip_codes) as zip
    from public.communities
   where id = 'bac33320-b4e9-42de-ae72-54d2b06226ba'
     and state = 'NH'
),
filtered as (
  select r.zip, r.counts,
         (select coalesce(jsonb_agg(s order by ord), '[]'::jsonb)
            from jsonb_array_elements(r.sites) with ordinality t(s, ord)
           where lower(substring(coalesce(nullif(s->>'url',''), nullif(s->>'record_url',''), '')
                                 from '^[a-zA-Z]+://([^/:]+)'))
                 is distinct from 'hillsboroughcounty.legistar.com') as new_sites
    from public.development_reports r
    join z using (zip)
   where exists (
     select 1 from jsonb_array_elements(r.sites) s
      where lower(substring(coalesce(nullif(s->>'url',''), nullif(s->>'record_url',''), '')
                            from '^[a-zA-Z]+://([^/:]+)'))
            = 'hillsboroughcounty.legistar.com'
   )
),
affected as (
  select zip, counts, new_sites,
         (select count(*)::int from jsonb_array_elements(new_sites) s
           where s->>'relevance' = 'development' and s->>'type' = 'proposed') as proposed,
         (select count(*)::int from jsonb_array_elements(new_sites) s
           where s->>'relevance' = 'development' and s->>'type' = 'approved') as approved,
         (select count(*)::int from jsonb_array_elements(new_sites) s
           where s->>'relevance' = 'development' and s->>'type' = 'built') as operating,
         (select count(*)::int from jsonb_array_elements(new_sites) s
           where s->>'relevance' = 'civic') as civic,
         (select count(*)::int from jsonb_array_elements(new_sites) s
           where (s->>'comment_open') in ('true', 't')) as comment_open
    from filtered
)
update public.development_reports r
   set sites  = a.new_sites,
       counts = r.counts
                || jsonb_build_object(
                     'proposed',     a.proposed,
                     'approved',     a.approved,
                     'operating',    a.operating,
                     'development',  a.proposed + a.approved + a.operating,
                     'civic',        a.civic,
                     'comment_open', a.comment_open
                   )
  from affected a
 where r.zip = a.zip;

-- Expect: UPDATE 34. Anything else = STOP and look (do not continue to rematerialize).

-- ── 2. rematerialize Z only — rebuilds app_changes from the cleaned cache.
--    NOT CREATE OR REPLACE. Per-ZIP, same function WRITE 2 already used.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select unnest(zip_codes) as zip
      from public.communities
     where id = 'bac33320-b4e9-42de-ae72-54d2b06226ba'
       and state = 'NH'
     order by 1 collate "C"
  loop
    perform public.app_refresh_zip(r.zip);
    n := n + 1;
  end loop;
  if n is distinct from 34 then
    raise exception 'app_refresh_zip called % times, want 34 — STOP', n;
  end if;
end $$;

commit;

-- ── VERIFICATION (run immediately after; each is a positive control) ──────────────────
-- 1. Zero Florida-host sites on the NH ZIP set:
--      select count(*) from public.development_reports r
--        join public.communities c on c.id = 'bac33320-b4e9-42de-ae72-54d2b06226ba'
--         and r.zip = any (c.zip_codes),
--             jsonb_array_elements(r.sites) s
--       where lower(substring(coalesce(nullif(s->>'url',''), nullif(s->>'record_url',''), '')
--                             from '^[a-zA-Z]+://([^/:]+)'))
--             = 'hillsboroughcounty.legistar.com';
--    -- = 0
-- 2. Positive control — the same host filter still sees Florida pages:
--      select count(*) from public.development_reports r, jsonb_array_elements(r.sites) s
--       where r.zip = '33602'
--         and lower(substring(coalesce(nullif(s->>'url',''), nullif(s->>'record_url',''), '')
--                             from '^[a-zA-Z]+://([^/:]+)'))
--             = 'hillsboroughcounty.legistar.com';
--    -- > 0 (measured 26 before the write; must not drop)
-- 3. Task 5 on the 34: counts.* == remaining rails
--      select zip from public.development_reports r
--        join public.communities c on c.id = 'bac33320-b4e9-42de-ae72-54d2b06226ba'
--         and r.zip = any (c.zip_codes)
--       where (r.counts->>'proposed')::int <> (select count(*) from jsonb_array_elements(r.sites) s
--               where s->>'relevance'='development' and s->>'type'='proposed')
--          or (r.counts->>'approved')::int <> (select count(*) from jsonb_array_elements(r.sites) s
--               where s->>'relevance'='development' and s->>'type'='approved')
--          or (r.counts->>'operating')::int <> (select count(*) from jsonb_array_elements(r.sites) s
--               where s->>'relevance'='development' and s->>'type'='built')
--          or (r.counts->>'civic')::int <> (select count(*) from jsonb_array_elements(r.sites) s
--               where s->>'relevance'='civic')
--          or (r.counts->>'development')::int <> (
--               (r.counts->>'proposed')::int + (r.counts->>'approved')::int + (r.counts->>'operating')::int);
--    -- = 0 rows
-- 4. Gold Master unchanged:
--      select count(*) from public.development_reports;  -- 12,722
-- 5. Community-page plane (the 238). Expect 0 after step 2:
--      select count(*) from public.app_changes ac
--        join public.communities c on c.id = 'bac33320-b4e9-42de-ae72-54d2b06226ba'
--         and ac.zip = any (c.zip_codes)
--       where lower(substring(ac.source_ref from '^[a-zA-Z]+://([^/:]+)'))
--             = 'hillsboroughcounty.legistar.com';
-- 6. Florida notices/meetings controls unmoved:
--      gov-hillsborough-fl-commission / hillsborough-fl-legistar-meetings still active.
