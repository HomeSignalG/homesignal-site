-- ============================================================================
-- Del Valle property-card foundation — app_projects identity + lifecycle + provenance
-- Applied 2026-08-09 as migrations:
--   app_projects_identity_lifecycle_provenance
--   app_refresh_zip_tabs_lifecycle_and_identity
-- Parked here per CLAUDE.md §1 (docs/*.sql is the DDL of record).
--
-- WHY: the 2026-08-09 Maps card audit measured three defects in the materialiser and
-- one misattribution in the card. All four have the same root: app_refresh_zip read a
-- narrow, ArcGIS-shaped set of keys out of development_reports.sites[], so a TDLR TABS
-- filing — the richest record type in the Del Valle pilot — lost its lifecycle, its
-- status words, its dates, and every party it names.
--
--   defect 1  lifecycle read `bucket` only. TABS stamps an explicit lifecycle `type`
--             ('built'|'approved'|'proposed') and no bucket, so all five Del Valle TABS
--             rows materialised as 'On file' -> the grey "lifecycle unknown" pin, for
--             buildings the filing states are complete.
--   defect 2  stage read `status_raw` only. TABS calls the same thing `status_text`
--             ("Inspection Complete", "Project Closed"), so stage was NULL on all five
--             and the card answered "the record lists its status as 'On file.'"
--   defect 3  impact_score read `bucket` only, so score and pin colour were derived
--             from different evidence and could disagree.
--   misattribution  `developer` = coalesce(owner, src) was rendered under one label,
--             "Developer / applicant". For a TABS filing that value is the OWNER; for
--             an EPA facility it is the SOURCE STRING. One label standing in for three
--             different things is a claim the record does not make.
--
-- SCOPE OF THE WRITE: additive only. No column dropped, retyped or backfilled; no row
-- rewritten outside the ZIP being refreshed. Every ZIP other than 78617 reads NULL on
-- the new columns until its own next refresh (the pg_cron daily pass), and every
-- renderer omits a row whose value is absent — so the rollout is a no-op until a ZIP
-- is re-materialised. Only 78617 was refreshed for this change.
-- ============================================================================

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.app_projects add column if not exists address    text;
alter table public.app_projects add column if not exists start_date date;
alter table public.app_projects add column if not exists end_date   date;
alter table public.app_projects add column if not exists scope_text text;
alter table public.app_projects add column if not exists parties    jsonb;
alter table public.app_projects add column if not exists provenance jsonb;

comment on column public.app_projects.address    is 'Street address exactly as filed on the source record (site.address / site.location_addr). Never geocoded back, never inferred.';
comment on column public.app_projects.start_date is 'Project start as stated by the source (TDLR TABS start_date). NOT the filing date — that is submitted_at.';
comment on column public.app_projects.end_date   is 'Project end/completion as stated by the source (TDLR TABS end_date).';
comment on column public.app_projects.scope_text is 'The source record''s own description / scope of work. Verbatim, never generated.';
comment on column public.app_projects.parties    is 'Array of {role,name,address?,phone?} built by app_site_parties(). ONLY roles the source itself names. Developer / Applicant / Operator / Parent Company are supported role words but are never written today because no wired source states them.';
comment on column public.app_projects.provenance is 'Source-verification metadata: {src,jurisdiction,source_class,case_number,url_precision,geo_precision,canonical_addr,refreshed_at,source_vintage}. Display-behind-a-disclosure, not primary card content.';

-- ── 2. The ONE party builder ────────────────────────────────────────────────
-- Roles are taken from the SOURCE's own words. TDLR TABS labels its blocks OWNER,
-- CONTACT, "filed by" and DESIGN FIRM, so those are the four roles emitted. It does
-- NOT say "developer", "applicant", "operator" or "parent company", so this function
-- never writes them — a role with no evidence is absent, not guessed. Adding a role
-- means finding a source that STATES it, not widening this CASE list.
create or replace function public.app_site_parties(el jsonb)
returns jsonb
language sql
immutable
as $fn$
  select coalesce(jsonb_agg(x.p order by x.ord), '[]'::jsonb)
  from (
    select 1 as ord,
           nullif(el->>'owner','') as nm,
           jsonb_strip_nulls(jsonb_build_object(
             'role',    'Owner',
             'name',    nullif(el->>'owner',''),
             'address', nullif(el->>'owner_addr',''),
             'phone',   nullif(el->>'owner_phone',''))) as p
    union all
    select 2, nullif(el->>'contact_name',''),
           jsonb_strip_nulls(jsonb_build_object(
             'role', 'Contact',
             'name', nullif(el->>'contact_name','')))
    union all
    select 3, nullif(el->>'filed_by',''),
           jsonb_strip_nulls(jsonb_build_object(
             'role', 'Filed By',
             'name', nullif(el->>'filed_by','')))
    union all
    select 4, nullif(el->>'design_firm',''),
           jsonb_strip_nulls(jsonb_build_object(
             'role',    'Design Firm',
             'name',    nullif(el->>'design_firm',''),
             'address', nullif(el->>'design_firm_addr',''),
             'phone',   nullif(el->>'design_firm_phone','')))
  ) x
  where x.nm is not null
$fn$;

comment on function public.app_site_parties(jsonb) is
  'development_reports site element -> ordered [{role,name,address?,phone?}]. Roles are the source''s own (Owner/Contact/Filed By/Design Firm); nothing is inferred. Empty array when the source names no party.';

-- ── 3. app_refresh_zip ──────────────────────────────────────────────────────
-- The full current definition lives in the applied migration
-- `app_refresh_zip_tabs_lifecycle_and_identity`; the three expressions that changed are
-- reproduced here so the delta is reviewable without diffing 200 lines of plpgsql.
--
-- STATUS (was: `lower(el->>'bucket')` alone)
--   case when lower(coalesce(el->>'decided','')) = 'true' then 'Decided'
--        else case lower(coalesce(nullif(el->>'bucket',''), nullif(el->>'type',''), ''))
--          when 'built' then 'Active' when 'approved' then 'Approved'
--          when 'proposed' then 'Proposed' when 'operating' then 'Operating'
--          else 'On file' end
--   end
--   -- same evidence order lib/map.js::trackerSiteItem already uses, so the signed-in
--   -- card and the public tracker now read one lifecycle. A record stating NEITHER
--   -- bucket nor type still resolves to 'On file' — unknown stays a first-class state.
--
-- STAGE (was: `nullif(el->>'status_raw','')`)
--   coalesce(nullif(el->>'status_raw',''), nullif(el->>'status_text',''))
--   -- ONE field for "the source's own status words", whichever key the connector uses.
--   -- `status` remains the normalized HomeSignal lifecycle; both are preserved.
--
-- IMPACT_SCORE (was: `lower(el->>'bucket')` alone)
--   case lower(coalesce(nullif(el->>'bucket',''), nullif(el->>'type',''), ''))
--     when 'proposed' then 72 when 'approved' then 55 when 'built' then 55 else 45 end
--   -- only the bucket->type fallback is new; 'operating' -> 45 is left exactly as it
--   -- was, so no already-correct row changes score.
--
-- NEW COLUMNS, both INSERT branches:
--   address     coalesce(nullif(el->>'address',''), nullif(el->>'location_addr',''))
--   start_date  date-guarded el->>'start_date'          (development branch only)
--   end_date    date-guarded el->>'end_date'            (development branch only)
--   scope_text  nullif(el->>'scope_text','')            (development branch only)
--   parties     nullif(public.app_site_parties(el), '[]'::jsonb)   (development only)
--   provenance  nullif(jsonb_strip_nulls(jsonb_build_object(
--                 'src', 'jurisdiction', 'source_class', 'case_number' (or project_no),
--                 'url_precision', 'geo_precision', 'canonical_addr',
--                 'refreshed_at', 'source_vintage')), '{}'::jsonb)
--   -- refreshed_at / source_vintage are read once per call from the ZIP's
--   -- development_reports row, so every card can state when its data was last pulled.
--
-- NOT carried through, deliberately: title (pre-truncation label), rel_rule, source_id,
-- e/n home offsets, matched_address, needs_review, facility_name, geocode_source,
-- match_type. They have no card use today and stay in development_reports.sites[].

-- ── 4. Apply to the pilot ZIP ───────────────────────────────────────────────
-- select public.app_refresh_zip('78617');
--   -> 78617: development=508/508 facilities=29/29 notices=8 news=8 quality=pass
--   (row counts identical to the pre-change run: 508 + 29 = 537, nothing gained or lost)
--
-- Verification actually run, 2026-08-09:
--   status distribution  BEFORE  Approved 335 · Operating 119 · Proposed 49 · On file 5
--                        AFTER   Approved 336 · Operating 119 · Proposed 49 · Active 4
--                        (the 5 'On file' TABS rows resolved to their stated lifecycle:
--                         4 built -> Active, 1 approved -> Approved. Zero 'On file' left.)
--   address    508/508 development rows       stage      508/508 development rows
--   provenance 537/537 rows                   parties      5/508 (the TABS filings)
--   start_date   5/508                        scope_text   5/508

-- ============================================================================
-- PART 2 — Parent Company as a first-class relationship
-- Applied 2026-08-09 as migrations:
--   company_parent_relationship_model
--   app_refresh_zip_attach_parents
--
-- WHAT ALREADY EXISTED, measured before writing anything:
--   select table_name, column_name from information_schema.columns
--    where table_schema='public' and column_name ilike '%parent%';
--     -> communities.parent_id                      (ZIP -> city -> county; not corporate)
--        company_esg_matches.parent_company_id/_name
--   select count(*), count(parent_company_id), count(parent_company_name),
--          count(*) filter (where match_confidence='verified')
--     from public.company_esg_matches;               -> 4, 0, 0, 0
--   CONCLUSION: HomeSignal holds NO verified corporate parent relationship. The model
--   below is therefore fully wired and populates ZERO parents. That is the correct
--   outcome for this task, not an incomplete one.
--
-- THE IDENTITY MODEL (roles stay distinct; nothing collapses to one company field):
--   Property / Facility
--     -> Property Owner  -> Parent Company (verified only)
--     -> Developer       -> Parent Company (verified only)
--     -> Applicant
--     -> Operator        -> Parent Company (verified only)
--     -> Contact / Filed By / Design Firm
--
-- LINEAGE IS NEVER COLLAPSED. app_attach_parents() ADDS a `parent` object beside the
-- party's own `role` and `name`; no code path can replace an operating entity with its
-- holding company. "Operator: ABC Operations LLC" keeps its row and gains
-- "Parent company: ABC Holdings, Inc." beneath it.
--
-- THE EVIDENCE BAR IS A CONSTRAINT, NOT A CONVENTION.
--   * company_parents_no_unverified_parent  — an unverified row cannot hold a parent
--     NAME at all. A candidate lives in `notes`, where no renderer or join reads it.
--   * company_parents_verified_needs_evidence — 'verified' requires parent_name +
--     parent_key + evidence_source + evidence_url + retrieved_at.
--   * company_parents_not_self — a company cannot be its own parent.
--   Shared founders / executives / investors, similar names, news co-occurrence and
--   "same corporate ecosystem" are not evidence and have NO column that accepts them.
--   An inferred parent is unstorable, not merely discouraged.
--
--   Probed live 2026-08-09, all four (three rejections + one acceptance as the positive
--   control that proves the rejections are real):
--     unverified row + parent name         -> check_violation  REJECTED
--     verified with no source/url/date     -> check_violation  REJECTED
--     company as its own parent            -> check_violation  REJECTED
--     verified + source + url + retrieved  -> ACCEPTED (probe rows then deleted; 0 left)
--
-- NAME KEYING: app_company_key() normalises case/punctuation/whitespace ONLY. Corporate
-- suffixes are KEPT, so 'neuralink' and 'neuralink corporation' are DISTINCT keys —
-- merging them would infer a relationship from name similarity, the exact thing the
-- brief forbids. ('River Bottoms Ranch LLC' and 'RIVER BOTTOMS RANCH LLC' DO share a key:
-- that is case, not similarity.)
--
-- FUTURE COMPANY-LEVEL DATASETS join public.v_app_project_companies, which yields both
-- halves per (project, role, company): `company_key` for the direct company, and
-- `parent_key` populated ONLY where parent_verification = 'verified'. Anything inherited
-- through that edge must be labelled parent-company information — the edge itself carries
-- attribution:'parent_company' for exactly that purpose.
--
-- SEEDED STATE (78617): the four parent-eligible companies are registered with
-- verification='not_yet_asked' and a note recording what was checked and what it
-- returned. "Not yet asked" is a valid and required provenance value; writing
-- 'searched_none_found' would claim a lookup nobody performed.
--   neuralink · neuralink corporation · river bottoms ranch · river bottoms ranch llc
--
-- NOT DONE, deliberately: no external corporate-registry research, no SEC/state-SOS
-- lookups, no parent inference from the shared-phone link the pipeline already records
-- between River Bottoms Ranch and Neuralink filings. A shared phone is a shared phone.
-- ============================================================================
