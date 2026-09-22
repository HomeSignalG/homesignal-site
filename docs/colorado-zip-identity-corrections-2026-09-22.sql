-- ============================================================================
-- Colorado ZIP identity corrections — APPLIED 2026-09-22
-- migration: colorado_broomfield_morgan_roots_and_zip_corrections_20260922
-- Companion to docs/utah-zip-identity-corrections-2026-09-22.sql
-- ============================================================================
-- Colorado, like Utah, predates the `zipcodes` PyPI v3.0.0 convention, so its ZIP
-- identities were hand-derived. Comparing all 140 CO ZIP pages against that pinned
-- source (comparison GENERATED, never transcribed) found 12 county disagreements.
-- TWO were acted on. TEN were not, and the reason is the point of this file.
--
-- FIXED — verifiable from the pinned source ALONE, no county boundary required:
--
--   80020  Broomfield (80020)  Boulder County -> BROOMFIELD County (new root)
--          Broomfield has been a CONSOLIDATED CITY-AND-COUNTY since 2001, carved out
--          of Boulder/Adams/Jefferson/Weld precisely to end that four-way split. So
--          this is not a straddle — it is 25 years stale, and a Broomfield resident
--          was being shown BOULDER COUNTY's commission.
--
--   80654  Roggen (80654)      Weld County    -> Wiggins (80654), MORGAN County (new)
--          Named for the wrong PLACE. The pinned source has 80652 = Roggen (Weld) and
--          80654 = Wiggins (Morgan) — two different ZIPs. Same class as the Utah
--          84332/84333 shift and equally provable without geography.
--
-- NOT FIXED — 80003, 80010, 80011, 80023, 80163, 80227, 80247, 80504, 80534, 80603.
--   These ZIPs genuinely STRADDLE county lines (Aurora spans Adams/Arapahoe/Douglas;
--   Longmont, Johnstown and Brighton each span two) or are PO-box ZIPs assigned to a
--   post office rather than an area. Our county is defensible for each, and 80003 /
--   80023 are the DOCUMENTED first-county collision rule. Settling them needs a
--   ZCTA<->county relationship file carrying per-county SHARES; this repo does not
--   have one. Reassigning a resident's county government on a single unshared label
--   is precisely the confident-claim-from-unverified-evidence the rules forbid.
--
-- ⛔ THREE WITNESSES WERE TRIED AND REJECTED. Do not re-derive them:
--   1. THE UTAH TIEBREAKER DOES NOT WORK HERE. In Utah, 84665's stored centroid was
--      65 miles from its claimed county, which settled it. In Colorado ALL TWELVE
--      stored centroids are byte-identical to the package point, so centroid and
--      county field never contradict each other.
--   2. PERMIT-ISSUER PROVENANCE IS CONFOUNDED. denver-*, aurora-building-permits,
--      adams-county-building-permits and weld-county-site-plan-review all use
--      `spatial_zip_radius_mi` with NO native zip column, so a source lands on a page
--      by 3-5 mile proximity, not by jurisdiction. Worse, the coverage gate runs
--      denver-* on 80227 BECAUSE the community row already says Denver — circular.
--   3. NO COUNTY GEOMETRY EXISTS IN-HOUSE. `geo.*` carries ZCTA polygons
--      (geo.zcta_boundary) but no county boundaries, and `app_projects` has no county
--      or jurisdiction column.
--
-- COST, measured before applying: 80020 lost 2 Boulder County rows and kept its own 7;
-- 80654 lost 1 Weld-sourced weather alert and is now honestly empty. Both pages were
-- ALREADY noindex. The two new roots have no feeds, so their Government Notices tiles
-- start empty — the founder's stated bar: no coverage beats wrong coverage.
-- ============================================================================

do $$
declare
  v_n int; v_before text; v_broom uuid; v_morgan uuid;
  v_after text; v_dups int; v_co_pages int; v_orphans int;
  c_topics text[] := array[
    'County Commission & county business','Planning, zoning & development',
    'Property taxes & assessments','Public safety & emergencies',
    'Water districts & utilities','Elections & voting'];
begin
  select count(*), md5(string_agg(k, ',' order by k collate "C")) into v_n, v_before from (
    select c.zip_codes[1]||'|'||c.name||'|'||c.slug||'|'||c.county||'|'||coalesce(p.name,'~') as k
      from public.communities c left join public.communities p on p.id=c.parent_id
     where c.level='zip' and c.zip_codes[1] in ('80020','80654')
    union all
    select 'ROOT '||c.county||'|'||coalesce(array_length(c.zip_codes,1),0)::text||'|'
           ||(case when '80020'=any(c.zip_codes) then 'has80020' else 'no80020' end)||'|'
           ||(case when '80654'=any(c.zip_codes) then 'has80654' else 'no80654' end)
      from public.communities c
     where c.level='county' and c.state='CO' and c.county in ('Boulder','Weld')
    union all
    select 'EXISTS '||c.county from public.communities c
     where c.level='county' and c.state='CO' and c.county in ('Broomfield','Morgan')
  ) t;
  if v_n <> 4 or v_before is distinct from '08a584c485d7cb5fa6347ef0d6db17be' then
    raise exception 'PRECONDITION FAILED: expected 4 / 08a584c485d7cb5fa6347ef0d6db17be, got % / %', v_n, v_before;
  end if;

  insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
  values ('Broomfield County','Broomfield','CO', array['80020'], 'county', c_topics, 'broomfield-county-co')
  returning id into v_broom;
  insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
  values ('Morgan County','Morgan','CO', array['80654'], 'county', c_topics, 'morgan-county-co')
  returning id into v_morgan;

  update public.communities set county='Broomfield', parent_id=v_broom
   where level='zip' and zip_codes[1]='80020';
  update public.communities
     set name='Wiggins (80654)', slug='wiggins-80654', county='Morgan', parent_id=v_morgan
   where level='zip' and zip_codes[1]='80654';

  update public.communities set zip_codes = array_remove(zip_codes,'80020')
   where level='county' and state='CO' and county='Boulder';
  update public.communities set zip_codes = array_remove(zip_codes,'80654')
   where level='county' and state='CO' and county='Weld';

  select string_agg(c.zip_codes[1]||'='||c.name||'/'||c.slug||'/'||c.county||'/'||coalesce(p.name,'~'),
         ' ; ' order by c.zip_codes[1] collate "C")
    into v_after
    from public.communities c left join public.communities p on p.id=c.parent_id
   where c.level='zip' and c.zip_codes[1] in ('80020','80654');
  if v_after is distinct from
       '80020=Broomfield (80020)/broomfield-80020/Broomfield/Broomfield County ; '
     ||'80654=Wiggins (80654)/wiggins-80654/Morgan/Morgan County'
  then raise exception 'POSTCONDITION FAILED: %', v_after; end if;

  if exists (select 1 from public.communities
              where level='county' and state='CO' and county='Boulder' and '80020'=any(zip_codes))
  then raise exception 'Boulder County still claims 80020'; end if;
  if exists (select 1 from public.communities
              where level='county' and state='CO' and county='Weld' and '80654'=any(zip_codes))
  then raise exception 'Weld County still claims 80654'; end if;

  select count(*) into v_dups from (
    select slug from public.communities where slug is not null group by slug having count(*)>1) d;
  if v_dups <> 0 then raise exception 'duplicate slugs introduced: %', v_dups; end if;
  select count(*) into v_co_pages from public.communities
   where level='zip' and state in ('Colorado','CO');
  if v_co_pages <> 140 then raise exception 'CO ZIP page count moved: % (expected 140)', v_co_pages; end if;
  select count(*) into v_orphans from public.communities
   where level='zip' and state in ('Colorado','CO') and parent_id is null;
  if v_orphans <> 0 then raise exception 'orphan CO ZIP pages: %', v_orphans; end if;

  raise notice 'OK: Broomfield + Morgan county roots created; 80020 and 80654 re-parented; 140 CO pages intact';
end $$;

-- ============================================================================
-- REMATERIALIZE — correcting the row changes nothing a resident sees until the page
-- is rebuilt.
--   select public.app_refresh_zip('80020');   -- notices 7, quality=pass
--   select public.app_refresh_zip('80654');   -- facilities 1, honestly empty
--
-- VERIFIED AFTER, on app_changes.community_id:
--   80020 -> Broomfield (80020) 7 rows, ZERO Boulder County rows
--   80654 -> 0 rows (the Weld weather alert correctly gone)
-- Statewide CO after: 140 pages, 12 county roots (was 10), 0 orphans,
-- 0 missing metadata, 0 missing dev cache, 0 duplicate slugs globally.
--
-- 📌 SEPARATE AND PRE-EXISTING: Colorado's tile coverage is far below Utah's —
-- notices 81/140, local news 60/140, meetings 55/140 (Utah is 310/310 on all three).
-- Untouched by this change; it is a feed-wiring gap, not an identity defect.
-- ============================================================================
