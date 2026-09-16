-- =====================================================================================
-- FIX 28 — DATA CENTER TYPE GEOGRAPHIC MEMBERSHIP (DDL of record, executable, atomic)
--
-- THE DEFECT, stated as the architecture rather than as a symptom:
--
--   `public.development_reports` is written by the ZIP-mode engine, which RETRIEVES
--   records around the ZIP CENTROID within a RADIUS (`ZIP_RADIUS_MI`, and the EPA FRS
--   radius ladder). Retrieval is a candidate operation. Nothing anywhere then decided
--   MEMBERSHIP: the row is keyed by ZIP, so every candidate silently became a canonical
--   member of that ZIP. Candidate retrieval is not ZIP attribution, and the gap between
--   them is where an outside Data center point becomes "a data centre in your ZIP".
--
--   Before the 2026-09-06 dual-identity and 2026-09-07 overlay-on-Type rulings an EPA FRS
--   data-centre facility drew a purple square — "a regulated facility nearby" — and the
--   caption's "nearby facilities for context" was true of it. Those rulings gave such a
--   record the Data center TYPE pin. A Type pin is a claim about this ZIP, so the
--   deliberately radius-derived facility plane started making whole-ZIP Type claims it was
--   never measured to support. That interaction is the root cause; neither ruling is wrong.
--
-- MEASURED BEFORE THIS FILE (2026-09-15, whole corpus, no sampling):
--   12,722 ZIP pages · 687 carry a Data center Type dot · 1,178 such dots
--   996 testable (the ZIP has usable geo.zcta_boundary geometry): 360 inside, 636 outside
--   361 ZIP pages carry >= 1 confirmed outside point · max overshoot 13.054 mi
--   ZIP 20166 (Sterling VA): 15 dots, 4 inside, 11 outside
--   706 ZIP pages have NO geo.zcta_boundary row at all; 153 of them carry 182 dots -> FIX 29
--
-- WHAT THIS FILE DOES, AND WHAT IT REFUSES TO DO:
--   * It adds a MEMBERSHIP DECISION between candidate storage and the canonical ZIP result,
--     at the one shared layer every consumer already reads: the stored row itself. Map 1,
--     the Place embed, app_refresh_zip -> app_projects/app_changes, the SEO ZIP documents
--     and the verifiers all read `public.development_reports`, so correcting the row is the
--     only placement under which every consumer inherits the same truth with no change of
--     its own. It is enforced by a TRIGGER, not by an instruction in a hot function, for
--     the same reason `enforce_canonical_zip()` is: the `*/2` rolling refresh rewrites
--     `sites` from the engine, so a one-time data repair would be undone within minutes.
--   * It is scoped to Data center TYPE point records. No other Type's geography moves.
--   * It NEVER manufactures geometry. A ZIP with no usable boundary is UNTESTABLE and is
--     left byte-identical (the Fix 29 firewall). No centroid, no buffer, no radius, no
--     tolerance, no "close enough".
--   * It NEVER deletes a source record. Exclusion is per (ZIP, record): the same record
--     stays in whichever ZIP row's geography actually contains it, and `national_dc_records`,
--     `app_projects` and the upstream government sources are untouched.
--   * It NEVER changes Type CLASSIFICATION. `map_site_is_datacenter_type()` is a projection
--     of the SHIPPED classifier (lib/map.js `HS.trackerSiteItem` -> `HS.resolveMarker`), and
--     the projection is proven equal to it over the whole production corpus by
--     scripts/fix28-dc-membership-audit.mjs, which runs the real lib/map.js.
-- =====================================================================================

begin;

-- ── 1. THE TYPE PROJECTION ────────────────────────────────────────────────────────────
-- A SQL projection of `HS.resolveMarker(HS.trackerSiteItem(site, frsRid)).typeKey ===
-- 'datacenter'` for a `development_reports` site object. It is NOT a new classifier and it
-- may not become one: every branch below exists because the shipped code has that branch,
-- in that order, and the live audit fails if the two ever disagree on one record.
--
-- The field mapping is `HS.trackerSiteItem` verbatim, and the omissions are load-bearing:
--   item.type = site.use_type ; item.use_type = site.use_type ; item.layer = site.layer
--   item.category and item.type_raw are NOT mapped (type_raw travels as `permit_class`,
--     which only lib/map.js::dataCenterSignificance reads) -> so they are not read here
--   item.name / item.title / item.label = site.label
--   item._facility = !!frsRid(site)  ->  site.registry_id
create or replace function public.map_site_is_datacenter_type(site jsonb)
returns boolean
language sql
immutable
as $function$
with f as (
  select
    coalesce(site->>'use_type','')                                as use_type,
    coalesce(site->>'layer','')                                   as layer,
    coalesce(site->>'label','')                                   as nm,
    (coalesce(btrim(coalesce(site->>'registry_id','')),'') <> '')  as is_facility
),
n as (
  select f.*,
         lower(btrim(use_type)) as u_n,
         lower(btrim(layer))    as l_n,
         -- classifyProjectType's KEYWORD phase joins normType() of
         -- [type, use_type, layer, category], Boolean-filtered, with a single space.
         -- type IS use_type here, hence the deliberate repetition.
         btrim(concat_ws(' ',
           nullif(lower(btrim(use_type)),''),
           nullif(lower(btrim(use_type)),''),
           nullif(lower(btrim(layer)),''))) as combined
  from f
)
select case
  -- ── FACILITY PATH (resolveMarker's isFacilityItem branch) ──────────────────────────
  -- 1. DUAL IDENTITY: statedDataCenter(item, classOnly=true). classOnly means the record
  --    NAME is never evidence here, and terminalNeutral is not consulted on this branch.
  when n.is_facility and (n.use_type ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
                       or n.layer    ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm')
    then true
  -- 2. OVERLAY-ON-TYPE: classifyFacilityOverlayType -> classifyProjectType on the class
  --    fields only. TERMINAL_NEUTRAL and FALLBACK are rejected by the overlay, so an
  --    'other project' facility is a plain regulated facility, never a data centre.
  when n.is_facility and n.u_n <> 'other project' and n.l_n <> 'other project'
       and (n.u_n in ('data center','datacenter','data-center','data centre')
         or n.l_n in ('data center','datacenter','data-center','data centre')
         or n.combined ~* 'data\s*center|hyperscale|server\s*farm')
    then true
  when n.is_facility then false
  -- ── PROJECT PATH (classifyProjectType) ─────────────────────────────────────────────
  -- PRECEDENCE 1.5 — an explicit TERMINAL_NEUTRAL outranks every inference below,
  -- statedDataCenter's name branch included. Terminal means terminal.
  when n.u_n = 'other project' or n.l_n = 'other project' then false
  -- PRECEDENCE 2 — statedDataCenter, class fields first.
  when n.use_type ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
    or n.layer    ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
    then true
  -- statedDataCenter, NAME branch: the street-name guard and the incidental-reference
  -- guard are both required, and the incidental guard needs BOTH halves (a "serving …"
  -- construction AND a competing infrastructure head noun).
  when n.nm ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
   and not n.nm ~* 'data\s*cent(er|re)\s+(rd|road|st|street|ave|avenue|ln|lane|dr|drive|blvd|boulevard|way|pkwy|parkway|ct|court|cir|circle)\y'
   and not (n.nm ~* '\y(serving|serves|to\s+serve|in\s+support\s+of|supporting|feeding|adjacent\s+to|next\s+to|abutting|associated\s+with)\y[^.;]{0,60}?data\s*cent'
        and n.nm ~* '\ysubstation\y|\yswitchyard\y|switching\s+station\y|\ytransmission\y|\y[0-9]{2,3}\s*kv\y|\ypower\s*line\y|\ytransmission\s+line\y|\ysolar\s+(farm|array|field)\y|photovoltaic|\ybattery\s+(energy\s+)?storage\y|\ybess\y|\ywind\s+(farm|turbine)\y|\ypower\s+plant\y|\ygenerating\s+station\y|\ycell\s+tower\y|\ymonopole\y|\yantenna\y')
    then true
  -- TYPE_EXACT / LAYER_EXACT. 'data-center' is here because DATACENTER_RE cannot match it:
  -- \s* does not match a hyphen, so the exact table is the only branch that resolves it.
  when n.u_n in ('data center','datacenter','data-center','data centre')
    or n.l_n in ('data center','datacenter','data-center','data centre')
    then true
  -- KEYWORD_RULES, on the joined class string only (never the name).
  when n.combined ~* 'data\s*center|hyperscale|server\s*farm' then true
  -- NAME_RULES carries NO data-centre rule, deliberately (lib/map.js): a duplicate there
  -- could only fire on a record the guarded phase above had already vetoed.
  else false
end
from n;
$function$;

comment on function public.map_site_is_datacenter_type(jsonb) is
  'Fix 28: SQL projection of lib/map.js HS.resolveMarker(...).typeKey = ''datacenter'' for a '
  'development_reports site. NOT a second classifier - equality with the shipped one is '
  'asserted over the whole production corpus by scripts/fix28-dc-membership-audit.mjs.';

-- ── 2. THE MEMBERSHIP DECISION ────────────────────────────────────────────────────────
-- ST_Intersects(point, boundary) is HomeSignal's ACCEPTED ZIP-membership predicate: it is
-- exactly what geo.zip_authoritative_membership is built with (scripts/n5_shard.py -
-- "Membership is exact ST_Intersects against authoritative geometry. No centroid, no
-- radius."). Using it here means Map 1 has ONE membership semantics, not two.
--
-- BOUNDARY SEMANTICS ARE INTENTIONAL. For a point, ST_Intersects == ST_Covers, i.e.
-- boundary-INCLUSIVE, while ST_Contains / ST_Within are boundary-exclusive. ZCTAs tile the
-- country, so a point exactly on a shared edge belongs to both neighbours: inclusive can
-- over-attribute to at most two ZIPs, exclusive attributes it to NONE, which is a silent
-- false exclusion. Measured on the 996 testable points: ST_Intersects 360, ST_Covers 360,
-- ST_Contains 360, ST_Within 360 - zero boundary-only points today, so the choice costs
-- nothing now and is made on semantics rather than on this corpus.
--
-- Points are built as ST_SetSRID(ST_MakePoint(lng, lat), 4269) - the identical expression
-- the shipped N5 membership driver uses. Stored boundaries are SRID 4269 (TIGER/Line 2025,
-- 2020 ZCTA delineation), typmod MULTIPOLYGON, GiST-indexed on geom.
create or replace function public.zip_dc_membership_outside(p_zip text, site jsonb, p_geom geometry)
returns boolean
language sql
immutable
as $function$
  select p_geom is not null
     and public.map_site_is_datacenter_type(site)
     and (site->>'scope') = 'point'
     and nullif(site->>'lat','') is not null
     and nullif(site->>'lng','') is not null
     and not ST_Intersects(
           ST_SetSRID(ST_MakePoint((site->>'lng')::float8, (site->>'lat')::float8), 4269),
           p_geom);
$function$;

-- ── 3. ENFORCEMENT ────────────────────────────────────────────────────────────────────
-- A BEFORE trigger, mirroring trg_development_reports_canonical_zip. The `*/2`
-- dev-reports-rolling-refresh rewrites `sites` from the engine every two minutes, so a
-- data-only repair is undone before anyone could read it. Enforcement is the only shape
-- that holds, and it covers every writer - the cron, a manual refresh, a backfill, and any
-- writer that does not exist yet.
create or replace function public.dev_reports_enforce_dc_zip_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $function$
declare
  v_geom  geometry;
  v_kept  jsonb;
  v_n_fac int; v_n_dev int; v_n_prop int; v_n_appr int; v_n_oper int; v_n_comm int;
  v_n_all int;
  v_c     jsonb;
begin
  -- A shape we do not understand is left alone, never coerced. Same fail-safe as
  -- dev_refresh_collect's `jsonb_typeof(j->'sites') = 'array'` write-eligibility guard.
  if jsonb_typeof(new.sites) is distinct from 'array' then
    return new;
  end if;

  -- FIX 29 FIREWALL. No usable boundary -> this ZIP is UNTESTABLE for Fix 28 and its row is
  -- returned byte-identical. Not measured is not empty, and it is certainly not a circle:
  -- nothing here manufactures, substitutes or approximates geometry.
  select b.geom into v_geom
    from geo.zcta_boundary b
   where b.zcta5 = new.zip
     and b.geom is not null
     and ST_GeometryType(b.geom) in ('ST_Polygon', 'ST_MultiPolygon')
     and not ST_IsEmpty(b.geom);
  if v_geom is null then
    return new;
  end if;

  -- PASS 1 - COUNT ONLY. The overwhelmingly common case is "nothing to correct", and a row
  -- that needs no correction must not pay to have its whole sites array rebuilt: these rows
  -- reach 19.6 MB and the refresh writes ~240/hour. Counting first is what keeps the steady
  -- state cheap; the rebuild in pass 2 is paid only by a row that actually changes.
  with j as (
    select public.zip_dc_membership_outside(new.zip, t.x, v_geom) as outside,
           t.x
      from jsonb_array_elements(new.sites) t(x)
     where (t.x->>'scope') = 'point'
       and nullif(t.x->>'lat','') is not null
       and nullif(t.x->>'lng','') is not null
       -- CHEAP SUPERSET, and it must stay a SUPERSET. Every branch that can make
       -- map_site_is_datacenter_type() true needs the literal 'data', 'hyperscal' or
       -- 'server' in use_type, layer or label - DATACENTER_RE, the TYPE_EXACT keys and the
       -- KEYWORD pattern all contain one of the three. Measured over all 12,722 cached
       -- reports: this superset selects exactly the same 1,178 Data centre points the full
       -- predicate does, so it costs no record. Without it the trigger called the full
       -- predicate once per site and took 11.7 s on ZIP 20166 (3,532 sites) against a
       -- refresh that writes ~240 rows an hour; with it, 352 ms.
       and (position('data' in lower(coalesce(t.x->>'use_type','') || coalesce(t.x->>'layer','') || coalesce(t.x->>'label',''))) > 0
         or position('hyperscal' in lower(coalesce(t.x->>'use_type','') || coalesce(t.x->>'layer','') || coalesce(t.x->>'label',''))) > 0
         or position('server' in lower(coalesce(t.x->>'use_type','') || coalesce(t.x->>'layer','') || coalesce(t.x->>'label',''))) > 0)
  )
  select count(*) filter (where outside)::int,
         count(*) filter (where outside and coalesce(btrim(coalesce(x->>'registry_id','')),'') <> '')::int,
         count(*) filter (where outside and x->>'relevance' = 'development')::int,
         count(*) filter (where outside and x->>'relevance' = 'development' and x->>'type' = 'proposed')::int,
         count(*) filter (where outside and x->>'relevance' = 'development' and x->>'type' = 'approved')::int,
         count(*) filter (where outside and x->>'relevance' = 'development' and x->>'type' = 'built')::int,
         count(*) filter (where outside and (x->>'comment_open')::boolean is true)::int
    into v_n_all, v_n_fac, v_n_dev, v_n_prop, v_n_appr, v_n_oper, v_n_comm
    from j;

  if v_n_all = 0 then
    return new;                                   -- nothing to correct; row untouched
  end if;

  -- PASS 2 - REBUILD, order preserved.
  select coalesce(jsonb_agg(t.x order by t.o) filter (
           where not public.zip_dc_membership_outside(new.zip, t.x, v_geom)), '[]'::jsonb)
    into v_kept
    from jsonb_array_elements(new.sites) with ordinality t(x, o);

  new.sites := v_kept;

  -- COUNTS FOLLOW MEMBERSHIP, or the page contradicts its own map. A record that is not a
  -- member of this ZIP is not counted for this ZIP either. Each counter is reduced by the
  -- excluded records' OWN contribution to it, never recomputed from a rule this file would
  -- then own, and only where the key already exists - so a report that never carried a
  -- counter does not acquire one here. scripts/lib/verify-dev-helpers.mjs asserts
  -- `rendered facility count == counts.facilities`; that invariant is why this is not
  -- optional.
  v_c := coalesce(new.counts, '{}'::jsonb);
  if v_n_fac  > 0 and v_c ? 'facilities'   then v_c := jsonb_set(v_c, '{facilities}',   to_jsonb(greatest(coalesce((v_c->>'facilities')::int,0)   - v_n_fac,  0))); end if;
  if v_n_dev  > 0 and v_c ? 'development'  then v_c := jsonb_set(v_c, '{development}',  to_jsonb(greatest(coalesce((v_c->>'development')::int,0)  - v_n_dev,  0))); end if;
  if v_n_prop > 0 and v_c ? 'proposed'     then v_c := jsonb_set(v_c, '{proposed}',     to_jsonb(greatest(coalesce((v_c->>'proposed')::int,0)     - v_n_prop, 0))); end if;
  if v_n_appr > 0 and v_c ? 'approved'     then v_c := jsonb_set(v_c, '{approved}',     to_jsonb(greatest(coalesce((v_c->>'approved')::int,0)     - v_n_appr, 0))); end if;
  if v_n_oper > 0 and v_c ? 'operating'    then v_c := jsonb_set(v_c, '{operating}',    to_jsonb(greatest(coalesce((v_c->>'operating')::int,0)    - v_n_oper, 0))); end if;
  if v_n_comm > 0 and v_c ? 'comment_open' then v_c := jsonb_set(v_c, '{comment_open}', to_jsonb(greatest(coalesce((v_c->>'comment_open')::int,0) - v_n_comm, 0))); end if;
  new.counts := v_c;

  return new;
end
$function$;

drop trigger if exists trg_development_reports_dc_zip_membership on public.development_reports;
create trigger trg_development_reports_dc_zip_membership
  before insert or update of sites on public.development_reports
  for each row execute function public.dev_reports_enforce_dc_zip_membership();

commit;

-- =====================================================================================
-- PARKED-VS-LIVE PARITY (CLAUDE.md rule 8 - fingerprinted, never eyeballed)
--
-- A parked migration that has drifted from production is worse than none: it reads as the
-- truth and replays something else. These are md5s of each function's BODY (`pg_proc.prosrc`)
-- with comments stripped and whitespace collapsed, computed on both sides after the apply of
-- 2026-09-15. Re-check them before any release; if one moves, the file is stale, not the DB.
--
--   map_site_is_datacenter_type            c6fcbec5a05c3ad997a5fe0569987206
--   zip_dc_membership_outside              22479bc53450444c95e0be8fa3dbdf2f
--   dev_reports_enforce_dc_zip_membership  b4697ba065c99e152f558d437a9c1c65
--
-- Recompute (live):
--   select proname, md5(regexp_replace(regexp_replace(prosrc,'--[^\n]*','','g'),'\s+',' ','g'))
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and proname in ('map_site_is_datacenter_type',
--          'zip_dc_membership_outside','dev_reports_enforce_dc_zip_membership');
--
-- BACKFILL (already applied to the 361 affected ZIP pages). The trigger does the work; the
-- update only has to touch `sites` so it fires. It advances no freshness clock, because it
-- sets no timestamp column - `refreshed_at` and `facilities_refreshed_at` are untouched.
--
--   update public.development_reports d set sites = d.sites where d.zip in (<the affected ZIPs>);
--
-- Then re-materialize those ZIPs so the downstream projection is not left stale:
--   select public.app_refresh_zip(z) for each z;
-- (`app_refresh_sweep` would reach them within ~7 h anyway; this makes it immediate.)
--
-- ROLLBACK, in full:
--   drop trigger trg_development_reports_dc_zip_membership on public.development_reports;
-- The excluded records return to each ZIP on its next engine refresh (~53 h for a full sweep).
-- =====================================================================================
