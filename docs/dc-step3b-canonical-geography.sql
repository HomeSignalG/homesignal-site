-- ============================================================================
-- STEP 3B · CANONICAL GEOGRAPHY — DDL OF RECORD
-- ============================================================================
-- One row per canonical entity (Step 3A) stating WHERE HomeSignal believes it is, or that it
-- cannot say. Geography is a canonical decision, not a publisher assertion: the publisher's
-- point is EVIDENCE, and this layer decides whether that evidence is good enough to place the
-- entity inside a ZIP boundary.
--
-- WHAT IT IS NOT
--   * It assigns NO ZIP. ZIP membership is a separate stage that reads this table through the
--     one point-in-ZIP authority (geo.zip_point_membership_in). No radius, no centroid.
--   * It has NO resident reader. RLS on, no anon/authenticated grant (Step 3A posture); the
--     isolation gate derives its forbidden list from this file.
--   * It knows no place, project or source by name. Every rule reads a column, never a value
--     list. Stratos (41.5, -113.5, "exact") is unresolved because its coordinates carry one
--     decimal place, the same rule that applies to every other record.
--
-- THE RULES (rule_version 2), evaluated per entity over its CURRENT linked observations,
-- and ONLY once every current observation is linked (else: REFUSED_IDENTITY_PENDING, no write):
--   1. entity_grain AGGREGATE_MULTI_SITE          -> NOT_A_SITE      (publisher says so)
--   2. no observation carries a coordinate pair    -> GEOGRAPHY_UNRESOLVED  NO_COORDINATES
--   3. two sources place it > 1 km apart           -> GEOGRAPHY_UNRESOLVED  SOURCES_DISAGREE
--   4. the chosen point has <= 1 decimal place on
--      either axis (±~5.5 km: cannot decide a ZIP) -> GEOGRAPHY_UNRESOLVED  ROUNDED_COORDINATES
--      ("exact" is not trusted: PUBLISHER_CLAIMS_EXACT is recorded beside it)
--   5. the publisher says the chosen point is a
--      settlement / administrative / area location
--      (dc_location_basis = NON_SITE_AREA)          -> GEOGRAPHY_UNRESOLVED  PUBLISHER_AREA_POINT
--      (flag PUBLISHER_AREA_POINT, + PUBLISHER_CLAIMS_EXACT when it was labelled "exact";
--       the publisher's own sentence rides in provenance.location_basis_evidence)
--   6. otherwise                                   -> RESOLVED, POINT, with flags:
--        COARSE_COORDINATES      2 decimal places (~1.1 km)
--        PUBLISHER_APPROXIMATE   the publisher labels the point approximate
--        SHARED_COORDINATES      another entity's chosen point is identical (centroid suspect)
--        PUBLISHER_ROAD_REFERENCE the publisher says the pin is a road / corridor / intersection
--                                 reference (recorded, NOT demoted: not yet determined)
--   The chosen point: a site-basis observation before an area-basis one, then publisher-
--   precision 'exact', then the most decimal places, then the newest observation, then the
--   observation id (deterministic).
--
-- RULE VERSION 3 (2026-09-24) — DERIVED ADDRESS POINTS (docs/dc-step3d-derived-location.sql):
--   * an ACCEPTED derived point is a candidate point with basis DERIVED_ADDRESS, ranked AFTER
--     any publisher site point and BEFORE a publisher area point -- so it never overrides a
--     site the publisher states, and it replaces a town centroid (which stays rejected);
--   * a town/area point is not a site claim, so it no longer takes part in SOURCES_DISAGREE:
--     only site claims are compared, with the SAME 1 km rule, owned here and nowhere else;
--   * a derived point may not place an entity that has an OPEN cross-source identity question
--     (IDENTITY_REVIEW_REQUIRED), nor one whose derived address another entity also uses
--     (DERIVED_ADDRESS_SHARED): the address cannot tell the two apart;
--   * the point's positional uncertainty (metres) is stored with the decision.
--
-- FOOTPRINT: geometry_type admits 'FOOTPRINT' and a footprint would win over any point, but NO
-- current source supplies a polygon (Atlas: lat/lon only; Epoch: address only). The rule is not
-- written against a field that does not exist; the first footprint-bearing source adds it.
-- ============================================================================

create table if not exists public.dc_entity_geography (
    canonical_entity_id       uuid primary key
                              references public.dc_canonical_entity(canonical_entity_id),
    geography_status          text not null,
    geometry_type             text,
    positional_uncertainty_m  double precision,   -- metres; NULL = no quantified uncertainty
    geom                      geometry(Geometry, 4326),
    lat                       double precision,
    lng                       double precision,
    coordinate_decimals       integer,
    authority_source_key      text,
    authority_observation_id  uuid references public.dc_source_observation(home_signal_observation_id),
    publisher_precision       text,
    quality_flags             text[] not null default '{}',
    rule_key                  text not null,
    rule_version              integer not null,
    provenance                jsonb not null default '{}'::jsonb,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    constraint dc_entity_geography_status_ck check (geography_status in
        ('RESOLVED', 'GEOGRAPHY_UNRESOLVED', 'NOT_A_SITE')),
    constraint dc_entity_geography_type_ck check (geometry_type in ('POINT', 'FOOTPRINT')),
    -- A resolved row has a geometry; an unresolved one never carries one to be misread.
    constraint dc_entity_geography_resolved_ck check (
        (geography_status = 'RESOLVED' and geom is not null and geometry_type is not null)
     or (geography_status <> 'RESOLVED' and geom is null and geometry_type is null))
);

alter table public.dc_entity_geography enable row level security;
-- rule_version 3: a derived point's positional uncertainty travels with the decision, so the ONE
-- membership authority (map1_dc_zip_members) can refuse a point whose error disk crosses a ZCTA.
alter table public.dc_entity_geography add column if not exists positional_uncertainty_m double precision;
revoke all on public.dc_entity_geography from anon, authenticated;

comment on table public.dc_entity_geography is
'STEP 3B. Canonical geography per canonical entity: RESOLVED (point or footprint),
GEOGRAPHY_UNRESOLVED or NOT_A_SITE, with quality flags and the observation that is its
authority. No ZIP here; membership is a separate stage over geo.zip_point_membership_in.';

-- ── LOCATION BASIS (2026-09-24): IS THE PUBLISHER'S POINT THE SITE, OR A PLACE? ───────────────
-- A coordinate is evidence of a site only when the publisher says, or at least does not deny,
-- that it locates the site. Compute Atlas states in each record's `notes` how its pin was
-- derived, and for a measured 262 data-centre records (2026-09-24, all 2,187 current records
-- read, every hit adjudicated by hand) it says the pin is a CITY / TOWN / COUNTY / COMMUNITY /
-- AREA location -- "Coordinates are Ellendale city centroid", "a Pineville (county seat)
-- centroid", "approximate to Oklahoma City". 39 of the published ones were ALSO labelled
-- location.precision = 'exact'. Such a point decides WHICH ZIP the town centre is in, not
-- which ZIP the facility is in: a centroid shortcut arriving through source data.
--
-- This is a CANONICAL decision (the adapter records the publisher's words and interprets
-- nothing), made per source like dc_classify_observation: one function, rules keyed on the
-- source, returning a basis and the rule that produced it. The resolver reads the RESULT and
-- never the text, so it stays source-agnostic.
--
--   NON_SITE_AREA   the publisher states the point is a settlement / administrative / area
--                   location.  -> the resolver withholds the point (GEOGRAPHY_UNRESOLVED).
--   NON_SITE_ROAD   the publisher states the point is a road, corridor, intersection or
--                   interchange reference.  -> FLAG ONLY. Such a pin usually borders the site;
--                   whether it may place a facility in a ZIP is NOT_YET_DETERMINED, so it is
--                   recorded (PUBLISHER_ROAD_REFERENCE) and not demoted.
--   UNSTATED        nothing disqualifies the point. An address geocode, a parcel centroid, a
--                   building footprint, an industrial or technology PARK / CENTER location, and
--                   plain "approximate" all land here: the rule demotes only what the publisher
--                   explicitly says is not the site.
--
-- Precision is preferred to recall: a miss leaves today's behaviour; a false hit would remove a
-- real site. So every rule is a narrow phrase shape, historical sentences ("replace the earlier
-- city-level geocode", "corrected ... from a city-centroid placeholder") are ignored, a
-- direction phrase ("south of Eloy city center") is not a statement about the pin, and a match
-- naming a road or a park/center is never an area. The adjudicated corpus is a test fixture
-- (test/dc_geography_pg), so a rule change is measured against every real sentence.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- Every non-overlapping match of p_re in p_text, left to right, with its 1-based position.
create or replace function public.dc_regex_matches(p_text text, p_re text, p_flags text)
returns table(pos integer, m text)
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
    s integer := 1;
    p integer;
    e integer;
begin
    if p_text is null or p_text = '' then return; end if;
    loop
        p := regexp_instr(p_text, p_re, s, 1, 0, p_flags);
        exit when p = 0;
        e := regexp_instr(p_text, p_re, s, 1, 1, p_flags);
        pos := p; m := substr(p_text, p, e - p);
        return next;
        s := greatest(e, p + 1);
        exit when s > length(p_text);
    end loop;
end;
$fn$;

-- One sentence -> NON_SITE_AREA | NON_SITE_ROAD | NEUTRAL, and the rule that decided it.
create or replace function public.dc_location_basis_sentence(p_sentence text)
returns table(basis text, rule_key text)
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
    -- the shapes, as data: (rule, pattern, regexp flags)
    unit constant text := '(?:city|town|village|township|county|community|municipal(?:ity)?|borough|locality|area|region|metro|city-area|city-boundary|search[- ]area|project[- ]area|zip(?:[- ]code)?)';
    nm   constant text := '[A-Z][\w.''-]*(?:\s[A-Z][\w.''-]*){0,3}';
    suf  constant text := '(?:Road|Rd|Avenue|Ave|Street|St|Drive|Dr|Highway|Hwy|Parkway|Pkwy|Boulevard|Blvd|Lane|Ln|Route|Pike|Way)';
    neg_re   constant text := '\y(?:not|no|nor|never)\y(?:\s+(?:a|an|the|yet|mapped|confirmed|surveyed|independently))*\s*$';
    neg2_re  constant text := '\ynot (?:a |an |the )?(?:[\w-]+ ){0,3}$';
    hist_re  constant text := '\y(earlier|previous(?:ly)?|prior|former(?:ly)?|original(?:ly)?|old|replac(?:e|es|ed|ing) (?:the|an?)|instead of|rather than|no longer|corrected\y[^.;]{0,30}\yfrom|(?:moved|changed|updated|upgraded)\y[^.;]{0,30}\yfrom)\y[^.;]{0,40}$';
    dir_re   constant text := '\y(north|south|east|west|northeast|northwest|southeast|southwest|near|outside|beyond|of|from)\s+(?:the\s+|of\s+)?(?:[A-Z][\w.''-]*\s+){0,3}$';
    park_re  constant text := '\y(?:park|industrial|campus|district|site|port|airport|megasite|tradeport|complex|estate)\y|\y(?:industrial|technology|tech|research|business|commerce|innovation|data|logistics|distribution|medical|shopping|civic|convention|trade|operations) (?:center|centre)\y';
    roadsuf_re constant text := '\y' || suf || '\y';
    r record;
    mm record;
    pre text;
    area_rules text[][];
    road_first text[][];
    road_late text[][];
    i integer;
begin
    if p_sentence is null or btrim(p_sentence) = '' then
        return query select 'NEUTRAL'::text, 'EMPTY'::text; return;
    end if;

    road_first := array[
        array['ROAD_EXPLICIT', '\y(?:road-level|road[- ]segment|road midpoint|corridor|intersection|junction|interchange)\y', 'i'],
        array['ROAD_SLASH', '\y[A-Z0-9][\w.''-]*\s' || suf || '\s*/\s*[A-Z0-9]|/\s*(?:[A-Z0-9][\w.''-]*\s){1,3}' || suf || '\y', '']];
    road_late := array[
        array['ROAD_NAMED', '\ygeocode (?:of|for) (?:the )?(?!\d)(?:[A-Z0-9][\w.''-]*\s){1,4}' || suf || '\y(?!\s+(?:address|addresses))', ''],
        array['ROAD_APPROX', '\y[Cc]oordinates? (?:are |is )?approximate(?:ly)? (?:to|for) (?:the )?(?:[A-Z0-9][\w.''-]*\s){1,4}' || suf || '\y', '']];
    area_rules := array[
        array['AREA_CENTROID', '\y' || unit || '[- ](?:centroid|cent(?:er|re))\y', 'i'],
        array['CENTROID_OF_AREA', '\y(?:centroid|cent(?:er|re)) of (?:the )?(?:[\w.''/-]+\s){0,4}?' || unit || '\y', 'i'],
        array['PLACE_CENTROID_APPROX', '\ycentroid (?:approximation|placeholder)\y', 'i'],
        array['AREA_LEVEL', '\y' || unit || '[- ]level\y', 'i'],
        array['AREA_REFERENCE', '\y' || unit || '(?:[- ]seat)? (?:reference point|locator)\y', 'i'],
        array['THE_PLACE_OF', '\y(?:coordinates?|pin|point) (?:is|are) (?:the |an? )?(?:approximate )?(?:town|city|village|community|township|borough) of\y', 'i'],
        array['AREA_ESTIMATE', '\y[A-Z][\w.''-]*-area (?:estimate|coordinates?|point|pin|approximation)\y', ''],
        array['APPROX_TO_PLACE', '\y[Cc]oordinates? (?:are |is )?approximate(?:ly)? (?:to|for) (?:the )?(?:(?:town|city|village) of )?(?:(?:north|south|east|west|western|eastern|northern|southern|central) )?(?!NW|NE|SW|SE)' || nm || '(?:,\s*(?:the\s)?' || nm || '\s(?:County|Parish)(?:\sseat)?|\s(?:area|township|county|city))?\s*(?:[.;,)]|$)|\y[Cc]oordinates? (?:are |is )?approximate(?:ly)? (?:to|for) the (?:township|town|city|village|county)\s*[.;,]', ''],
        array['UNIT_ESTIMATE', '(?<!/ )(?<!/)\y(?:township|village|community|city|town|locality|metro)(?:[- ]area)? (?:estimate|approximation|geocode|point|anchor|zone)\y|\y(?:village|community|city) area\y', 'i'],
        array['COUNTY_SEAT', '\ycounty seat\y', 'i'],
        array['ANCHORED_ON_PLACE', '\yanchor(?:ed)? (?:on|to|at) (?:the )?(?:city|town|village|community) of\y', 'i'],
        array['COMMUNITY_POINT', '\y(?:OpenStreetMap|OSM) point for ' || nm || ', the (?:nearest )?(?:named )?(?:community|town|village|city)\y', ''],
        array['ARE_THE_PLACE_UNIT', '\y(?:coordinates?|pin) (?:is|are) the ' || nm || ' (?:community|township|village)\y', ''],
        array['GEOCODED_TO_PLACE', '\ygeocoded to the (?:town|city|village|township) of\y|\ygeocode of ' || nm || ' (?:Township|Village)\y', 'i'],
        array['PAREN_PLACE_AREA', '\yapproximate\s*\((?:[A-Z][\w.''-]*\s?){1,3}area\y', ''],
        array['NEAREST_PLACE', '\ynearest(?: named)? (?:place|community|town|city)\y', 'i']];

    -- 1. an explicit road / corridor / intersection statement about the pin
    for i in 1 .. array_length(road_first, 1) loop
        for mm in select * from public.dc_regex_matches(p_sentence, road_first[i][2], road_first[i][3]) loop
            pre := substr(p_sentence, greatest(1, mm.pos - 40), mm.pos - greatest(1, mm.pos - 40));
            continue when pre ~* neg_re or pre ~* neg2_re;
            return query select 'NON_SITE_ROAD'::text, road_first[i][1]; return;
        end loop;
    end loop;

    -- 2. an explicit settlement / administrative / area statement about the pin
    for i in 1 .. array_length(area_rules, 1) loop
        for mm in select * from public.dc_regex_matches(p_sentence, area_rules[i][2], area_rules[i][3]) loop
            continue when mm.m ~* park_re or mm.m ~ roadsuf_re;
            pre := substr(p_sentence, greatest(1, mm.pos - 60), mm.pos - greatest(1, mm.pos - 60));
            continue when pre ~* hist_re;
            continue when area_rules[i][1] = 'AREA_CENTROID' and pre ~ dir_re;
            return query select 'NON_SITE_AREA'::text, area_rules[i][1]; return;
        end loop;
    end loop;

    -- 3. a named road the pin was geocoded to
    for i in 1 .. array_length(road_late, 1) loop
        for mm in select * from public.dc_regex_matches(p_sentence, road_late[i][2], road_late[i][3]) loop
            pre := substr(p_sentence, greatest(1, mm.pos - 40), mm.pos - greatest(1, mm.pos - 40));
            continue when pre ~* neg_re or pre ~* neg2_re;
            return query select 'NON_SITE_ROAD'::text, road_late[i][1]; return;
        end loop;
    end loop;

    return query select 'NEUTRAL'::text, 'NO_NON_SITE_STATEMENT'::text;
end;
$fn$;

-- One observation -> its location basis. Per source, like dc_classify_observation.
create or replace function public.dc_location_basis(p_source_key text, p_distribution_key text,
                                                    p_payload jsonb)
returns table(basis text, rule_key text, evidence jsonb)
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $fn$
declare
    s record;
    road record;
begin
    if p_source_key = 'compute_atlas' then
        -- the publisher's own sentences about how its pin was derived
        for s in
            select x.ord, btrim(x.sent) sent, b.basis sb, b.rule_key srk
              from regexp_split_to_table(coalesce(p_payload->>'notes', ''), '(?<=[.;])\s+')
                   with ordinality x(sent, ord)
             cross join lateral public.dc_location_basis_sentence(btrim(x.sent)) b
             where x.sent ~* '(coordinat|centroid|\mpin\M|lat/lon|lat-lon|geolocat|geocod)'
             order by x.ord
        loop
            if s.sb = 'NON_SITE_AREA' then
                return query select 'NON_SITE_AREA'::text, 'ATLAS_NOTES_' || s.srk,
                    jsonb_build_object('field', 'notes', 'sentence', s.sent);
                return;
            end if;
            if s.sb = 'NON_SITE_ROAD' and road is null then road := s; end if;
        end loop;
        if road is not null then
            return query select 'NON_SITE_ROAD'::text, 'ATLAS_NOTES_' || road.srk,
                jsonb_build_object('field', 'notes', 'sentence', road.sent);
            return;
        end if;
        return query select 'UNSTATED'::text, 'ATLAS_NOTES_NO_NON_SITE_STATEMENT'::text,
            '{}'::jsonb;
        return;
    end if;
    return query select 'UNSTATED'::text, 'NO_LOCATION_BASIS_RULE'::text,
        jsonb_build_object('source_key', p_source_key, 'distribution_key', p_distribution_key);
end;
$fn$;

create or replace function public.dc_resolve_geography(p_apply boolean default false)
returns table(metric text, value text)
language plpgsql
as $fn$
declare
    v_rule_version constant integer := 3;
    v_written integer := 0;
    v_pending integer;
begin
    -- ⛔ IDENTITY FIRST, OR NOTHING (2026-09-24). This resolver reads coordinates only through
    -- observations that identity has already linked to an entity. An acquisition that commits
    -- after the hour's identity run (:25) and before this one (:35) makes the CURRENT run a set
    -- of observations linked to nothing, and every entity then has "no coordinates" -- measured
    -- 2026-09-24 14:35Z: Atlas landed 14:26:42, all 2,870 live entities were rewritten
    -- GEOGRAPHY_UNRESOLVED, and Map 1 served ZERO canonical data centres until identity ran
    -- again. Unlinked current evidence is not evidence of absence, so the resolver refuses to
    -- decide anything until identity has caught up, and the last decided geography stands.
    select count(*) into v_pending
      from public.dc_current_observation c
     where not exists (select 1 from public.dc_entity_observation eo
                        where eo.home_signal_observation_id = c.home_signal_observation_id);
    if v_pending > 0 then
        return query
            select 'MODE'::text, case when p_apply then 'APPLY' else 'REPORT_ONLY' end
            union all select 'REFUSED_IDENTITY_PENDING', v_pending::text
            union all select 'ROWS_WRITTEN', '0';
        return;
    end if;

    drop table if exists _geo_pts;
    drop table if exists _geo_pick;
    drop table if exists _geo_out;
    drop table if exists _geo_open;
    drop table if exists _geo_derived;

    -- Every coordinate pair any CURRENT observation of an entity asserts -- the publisher's own
    -- points, and (rule_version 3) the ACCEPTED derived address points of Step 3D, which are a
    -- different kind of evidence and are labelled as such: basis DERIVED_ADDRESS, no publisher
    -- precision, and a positional uncertainty that Map 1 membership must respect.
    create temporary table _geo_pts on commit drop as
    select eo.canonical_entity_id, o.home_signal_observation_id oid, o.source_key,
           o.source_native_precision prec, o.source_native_lat lat, o.source_native_lon lng,
           least(scale(o.source_native_lat::text::numeric),
                 scale(o.source_native_lon::text::numeric)) decimals,
           o.observed_at, lb.basis, lb.rule_key basis_rule, lb.evidence basis_evidence,
           null::double precision uncertainty_m
      from public.dc_entity_observation eo
      join public.dc_current_observation c
        on c.home_signal_observation_id = eo.home_signal_observation_id
      join public.dc_source_observation o
        on o.home_signal_observation_id = eo.home_signal_observation_id
     cross join lateral public.dc_location_basis(o.source_key, o.distribution_key,
                                                 o.raw_payload) lb
     where o.source_native_lat is not null and o.source_native_lon is not null
       and o.source_native_lat between -90 and 90 and o.source_native_lon between -180 and 180
    union all
    select eo.canonical_entity_id, dp.home_signal_observation_id, dp.source_key,
           null::text, dp.lat, dp.lng, 6, o.observed_at,
           'DERIVED_ADDRESS'::text, dp.match_type,
           jsonb_build_object('derivation_id', dp.derivation_id, 'geocoder_query', dp.geocoder_query,
                              'matched_address', dp.matched_address, 'provider', dp.provider,
                              'match_type', dp.match_type,
                              'provider_candidates', dp.provider_candidates,
                              'derived_at', dp.derived_at, 'run_ref', dp.run_ref,
                              'verdict', dp.verdict, 'verdict_reason', dp.verdict_reason),
           dp.positional_uncertainty_m
      from public.dc_entity_observation eo
      join public.dc_observation_derived_point dp
        on dp.home_signal_observation_id = eo.home_signal_observation_id
      join public.dc_source_observation o
        on o.home_signal_observation_id = eo.home_signal_observation_id
     where dp.verdict = 'ACCEPTED';

    -- Why each entity's derived location did or did not qualify (reported, never a point).
    create temporary table _geo_derived on commit drop as
    select distinct on (eo.canonical_entity_id) eo.canonical_entity_id,
           jsonb_build_object('input_quality', dp.input_quality, 'geocoder_query', dp.geocoder_query,
                              'verdict', dp.verdict, 'reason', dp.verdict_reason,
                              'match_type', dp.match_type, 'matched_address', dp.matched_address) derived
      from public.dc_entity_observation eo
      join public.dc_observation_derived_point dp
        on dp.home_signal_observation_id = eo.home_signal_observation_id
     order by eo.canonical_entity_id, (dp.verdict = 'ACCEPTED') desc, dp.home_signal_observation_id;

    -- ⛔ IDENTITY BEFORE A DERIVED MARKER. An entity with an OPEN cross-source identity question
    -- -- a surfaced candidate pair with another data-centre entity that no person has decided
    -- CONFIRMED_DISTINCT (and that did not merge) -- may not be PLACED by a derived point: the
    -- other entity may be the same facility, and two markers for one site is the defect.
    -- Publisher points are unaffected (their behaviour before rule_version 3 is unchanged).
    create temporary table _geo_open on commit drop as
    select distinct x.canonical_entity_id
      from public.dc_identity_candidate k
      join public.dc_entity_observation x
        on x.home_signal_observation_id in (k.observation_a, k.observation_b)
      join public.dc_entity_observation y
        on y.home_signal_observation_id in (k.observation_a, k.observation_b)
       and y.home_signal_observation_id <> x.home_signal_observation_id
      join public.dc_canonical_entity ye on ye.canonical_entity_id = y.canonical_entity_id
     cross join lateral public.dc_adjudicate_pair(k.observation_a, k.observation_b,
                                                  k.candidate_rule_key) d
     where x.source_key <> y.source_key
       and y.canonical_entity_id <> x.canonical_entity_id
       and ye.superseded_by is null
       and ye.classification in ('CONFIRMED_DC', 'DC_CANDIDATE')
       and d.decision_state <> 'CONFIRMED_DISTINCT';

    create temporary table _geo_pick on commit drop as
    select distinct on (canonical_entity_id) *
      from _geo_pts
     order by canonical_entity_id, (basis = 'NON_SITE_AREA'), (basis = 'DERIVED_ADDRESS'),
              (prec = 'exact') desc nulls last,
              decimals desc,
              observed_at desc, oid;

    create temporary table _geo_out on commit drop as
    with base as (
        select e.canonical_entity_id, e.entity_grain, p.oid, p.source_key, p.prec, p.lat,
               p.lng, p.decimals, p.basis, p.basis_rule, p.basis_evidence, p.uncertainty_m,
               -- A publisher's town/area point is not a claim about the SITE (rule_version 2),
               -- so it can neither disagree with nor be agreed with: only site claims -- publisher
               -- site points and accepted derived points -- are compared.
               exists (select 1 from _geo_pts a join _geo_pts b
                         on a.canonical_entity_id = b.canonical_entity_id
                        and a.source_key < b.source_key
                        where a.canonical_entity_id = e.canonical_entity_id
                          and a.basis <> 'NON_SITE_AREA' and b.basis <> 'NON_SITE_AREA'
                          and ST_DistanceSphere(ST_MakePoint(a.lng, a.lat),
                                                ST_MakePoint(b.lng, b.lat)) > 1000) disagree,
               e.canonical_entity_id in (select canonical_entity_id from _geo_open) identity_open,
               (select dd.derived from _geo_derived dd
                 where dd.canonical_entity_id = e.canonical_entity_id) derived,
               exists (select 1 from _geo_pick q
                        where q.canonical_entity_id <> e.canonical_entity_id
                          and q.lat = p.lat and q.lng = p.lng) shared
          from public.dc_canonical_entity e
          left join _geo_pick p on p.canonical_entity_id = e.canonical_entity_id
         where e.superseded_by is null)
    select b.*,
           case when b.entity_grain = 'AGGREGATE_MULTI_SITE' then 'NOT_A_SITE'
                when b.oid is null or b.disagree or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'
                when b.basis = 'NON_SITE_AREA' then 'GEOGRAPHY_UNRESOLVED'
                when b.basis = 'DERIVED_ADDRESS' and b.identity_open then 'GEOGRAPHY_UNRESOLVED'
                when b.basis = 'DERIVED_ADDRESS' and b.shared then 'GEOGRAPHY_UNRESOLVED'
                else 'RESOLVED' end status,
           case when b.entity_grain = 'AGGREGATE_MULTI_SITE' then 'PUBLISHER_MULTI_SITE'
                when b.oid is null then 'NO_COORDINATES'
                when b.disagree then 'SOURCES_DISAGREE'
                when b.decimals <= 1 then 'ROUNDED_COORDINATES'
                when b.basis = 'NON_SITE_AREA' then 'PUBLISHER_AREA_POINT'
                when b.basis = 'DERIVED_ADDRESS' and b.identity_open then 'IDENTITY_REVIEW_REQUIRED'
                when b.basis = 'DERIVED_ADDRESS' and b.shared then 'DERIVED_ADDRESS_SHARED'
                when b.basis = 'DERIVED_ADDRESS' then 'DERIVED_ADDRESS_POINT'
                else 'PUBLISHER_POINT' end rule_key,
           array_remove(array[
               case when b.oid is not null and b.decimals <= 1 then 'ROUNDED_COORDINATES' end,
               case when b.oid is not null and (b.decimals <= 1 or b.basis = 'NON_SITE_AREA')
                         and b.prec = 'exact'
                    then 'PUBLISHER_CLAIMS_EXACT' end,
               case when b.basis = 'NON_SITE_AREA' then 'PUBLISHER_AREA_POINT' end,
               case when b.basis = 'NON_SITE_ROAD' then 'PUBLISHER_ROAD_REFERENCE' end,
               case when b.basis = 'DERIVED_ADDRESS' then 'DERIVED_ADDRESS_POINT' end,
               case when b.basis = 'DERIVED_ADDRESS' and b.identity_open then 'IDENTITY_REVIEW_REQUIRED' end,
               case when b.decimals = 2 then 'COARSE_COORDINATES' end,
               case when b.prec = 'approximate' then 'PUBLISHER_APPROXIMATE' end,
               case when b.shared then 'SHARED_COORDINATES' end,
               case when b.disagree then 'SOURCES_DISAGREE' end,
               case when b.oid is null then 'NO_COORDINATES' end], null) flags
      from base b;

    if p_apply then
        insert into public.dc_entity_geography as g
            (canonical_entity_id, geography_status, geometry_type, geom, lat, lng,
             coordinate_decimals, authority_source_key, authority_observation_id,
             publisher_precision, quality_flags, rule_key, rule_version, provenance,
             positional_uncertainty_m)
        select canonical_entity_id, status,
               case when status = 'RESOLVED' then 'POINT' end,
               case when status = 'RESOLVED' then ST_SetSRID(ST_MakePoint(lng, lat), 4326) end,
               lat, lng, decimals, source_key, oid, prec, flags, rule_key, v_rule_version,
               jsonb_build_object('rule', rule_key, 'observation', oid,
                                  'location_basis', basis, 'location_basis_rule', basis_rule,
                                  'location_basis_evidence', basis_evidence,
                                  'positional_uncertainty_m', uncertainty_m,
                                  'derived_location', derived),
               case when status = 'RESOLVED' then uncertainty_m end
          from _geo_out
        on conflict (canonical_entity_id) do update
           set geography_status = excluded.geography_status,
               geometry_type = excluded.geometry_type, geom = excluded.geom,
               lat = excluded.lat, lng = excluded.lng,
               coordinate_decimals = excluded.coordinate_decimals,
               authority_source_key = excluded.authority_source_key,
               authority_observation_id = excluded.authority_observation_id,
               publisher_precision = excluded.publisher_precision,
               quality_flags = excluded.quality_flags, rule_key = excluded.rule_key,
               rule_version = excluded.rule_version, provenance = excluded.provenance,
               positional_uncertainty_m = excluded.positional_uncertainty_m,
               updated_at = now()
         where (g.geography_status, g.lat, g.lng, g.quality_flags, g.rule_key,
                g.authority_observation_id, g.rule_version, g.positional_uncertainty_m, g.provenance)
               is distinct from
               (excluded.geography_status, excluded.lat, excluded.lng, excluded.quality_flags,
                excluded.rule_key, excluded.authority_observation_id, excluded.rule_version,
                excluded.positional_uncertainty_m, excluded.provenance);
        get diagnostics v_written = row_count;
    end if;

    return query
        select 'MODE'::text, case when p_apply then 'APPLY' else 'REPORT_ONLY' end
        union all select 'ENTITIES', count(*)::text from _geo_out
        union all select 'ROWS_WRITTEN', case when p_apply then v_written::text else 'n/a' end
        union all select 'STATUS_' || s.status, s.n::text
               from (select status, count(*) n from _geo_out group by status) s
        union all select 'RULE_' || r.rule_key, r.n::text
               from (select rule_key, count(*) n from _geo_out group by rule_key) r
        union all select 'FLAG_' || f.flag, f.n::text
               from (select flag, count(*) n from _geo_out, unnest(flags) flag group by flag) f;
end;
$fn$;

comment on function public.dc_resolve_geography(boolean) is
'STEP 3B resolver. Default REPORT ONLY. Decides each canonical entity''s geography from its
current observations by column-level rules (grain, coordinates present, source agreement,
decimal places); never by place, project or source name. Idempotent: an unchanged entity is
not rewritten.';

-- ── AUTOMATIC, AFTER IDENTITY (2026-09-22) ─────────────────────────────────────────────────
-- dc-resolve-canonical runs at :25; geography follows at :35 so it reads that hour's entities.
-- Idempotent (an unchanged entity is not rewritten), DB-side, independent of GitHub Actions.
do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dc-resolve-geography';
  perform cron.schedule('dc-resolve-geography', '35 * * * *',
                        'select count(*) from public.dc_resolve_geography(true)');
end
$cron$;
