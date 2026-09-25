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
--   3. two sources' SITE claims contradict each
--      other (dc_site_claims_conflict, v4 below)   -> GEOGRAPHY_UNRESOLVED  SOURCES_DISAGREE
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
--     (IDENTITY_UNRESOLVED), nor one whose derived address another entity also uses
--     (DERIVED_ADDRESS_SHARED): the address cannot tell the two apart;
--   * the point's positional uncertainty (metres) is stored with the decision.
--
-- RULE VERSION 4 (2026-09-24) — ONE SOURCE-INDEPENDENT GEOGRAPHY AUTHORITY:
--   * every coordinate claim is classified by what the EVIDENCE is (dc_entity_geography_evidence):
--     PUBLISHER_SITE, DERIVED_ADDRESS, PUBLISHER_NON_SITE, PUBLISHER_UNUSABLE -- never by source name;
--   * authority follows the class: a publisher site point, then a derived address point; a non-site
--     or unusable point never places an entity. A precision label ("exact") only breaks ties inside
--     a class -- it never lifts a town centroid above a site;
--   * two site claims CONTRADICT only when they lie farther apart than the evidence allows: the sum
--     of their quantified errors (a derived point's calibrated 2,000 m), or the 1 km peer tolerance
--     between two publisher site points (neither carries a number). So a derived point inside its
--     bound CORROBORATES a publisher site point (flag CORROBORATED_BY_DERIVED_ADDRESS) and never
--     vetoes it; one beyond its bound fails closed (DERIVED_ADDRESS_BEYOND_UNCERTAINTY), as does a
--     genuine conflict between two publisher site points (SITE_CLAIMS_CONFLICT). Both are
--     SOURCES_DISAGREE, never an arbitrary pick.
--   * WHY 2,000 m IS THE RIGHT ALLOWANCE (measured, Step 3D header): 200 Atlas records' OWN street
--     addresses geocoded against their OWN site points -- p50 120 m, p95 396 m, max 1,801 m. A pair
--     farther apart than that is not geocoder noise: the address and the point do not describe the
--     same place, and nothing here can say which one is wrong.
--   * ZIP plays no part: no ZCTA, no provider ZIP, no centroid. Membership is decided afterwards,
--     from the canonical point alone, by geo.zip_point_membership_in.
--
-- RULE VERSION 5 (2026-09-24) — A PUBLISHER'S OWN ADDRESS VALIDATES ITS OWN POINT:
--   * rule_version 4 paired site claims with `a.source_key < b.source_key`, so a claim was only ever
--     compared with ANOTHER source's claim. An Atlas-only facility whose street address Atlas itself
--     states could never be checked against it: Lancaster was caught only because Epoch happened to
--     state the same address. Pairing on a source name is a source-dependent rule; claims are now
--     paired by (source, class, observation), so ANY two distinct site claims of an entity are
--     compared by the SAME dc_site_claims_conflict, whoever published them.
--   * the corroboration flag likewise accepts any derived address point, not only another source's.
--   * measured 2026-09-24 before the change: every live entity carries at most ONE claim per
--     (source, class), so the only pairs this adds are a publisher point vs a derived point; two
--     same-source publisher points are not a shape production has.
--   * derived points enter only from an ADMITTED extraction (Step 3D dc_derived_address_admitted):
--     acquiring Atlas's derivations changes no decision until that extraction is admitted.
--   * nothing else moves: a derived point inside its bound corroborates, beyond it the entity fails
--     closed (SOURCES_DISAGREE, never "move to the derived point"), and the absence of a derived
--     point -- no address, a failed or ambiguous geocode -- is not evidence against anything.
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

-- ── THE GEOGRAPHY EVIDENCE OF EVERY ENTITY (one definition; the resolver and every report read it)
-- Every coordinate pair any CURRENT observation linked to an entity asserts:
--   * the publisher's own point, with the publisher's own account of what it is (location basis);
--   * an ACCEPTED derived address point of Step 3D -- a different kind of evidence, labelled as
--     such: basis DERIVED_ADDRESS, no publisher precision, and its calibrated positional
--     uncertainty in metres.
-- evidence_class is decided by the EVIDENCE, never by the source's name:
--   PUBLISHER_SITE      a publisher point whose basis is not a settlement/area statement and which
--                       carries >= 2 decimal places (a claim about the site itself)
--   DERIVED_ADDRESS     a HomeSignal geocode of a publisher's site address (carries uncertainty)
--   PUBLISHER_NON_SITE  the publisher says the point is a town / administrative / area location
--   PUBLISHER_UNUSABLE  <= 1 decimal place on either axis (±~5.5 km: cannot decide a ZIP)
create or replace view public.dc_entity_geography_evidence with (security_invoker = true) as
select eo.canonical_entity_id, o.home_signal_observation_id oid, o.source_key,
       o.source_native_precision prec, o.source_native_lat lat, o.source_native_lon lng,
       least(scale(o.source_native_lat::text::numeric),
             scale(o.source_native_lon::text::numeric)) decimals,
       o.observed_at, lb.basis, lb.rule_key basis_rule, lb.evidence basis_evidence,
       null::double precision uncertainty_m,
       case when lb.basis = 'NON_SITE_AREA' then 'PUBLISHER_NON_SITE'
            when least(scale(o.source_native_lat::text::numeric),
                       scale(o.source_native_lon::text::numeric)) <= 1 then 'PUBLISHER_UNUSABLE'
            else 'PUBLISHER_SITE' end evidence_class
  from public.dc_entity_observation eo
  join public.dc_current_observation c
    on c.home_signal_observation_id = eo.home_signal_observation_id
  join public.dc_source_observation o
    on o.home_signal_observation_id = eo.home_signal_observation_id
 cross join lateral public.dc_location_basis(o.source_key, o.distribution_key, o.raw_payload) lb
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
       dp.positional_uncertainty_m,
       'DERIVED_ADDRESS'::text
  from public.dc_entity_observation eo
  join public.dc_observation_derived_point dp
    on dp.home_signal_observation_id = eo.home_signal_observation_id
  join public.dc_source_observation o
    on o.home_signal_observation_id = eo.home_signal_observation_id
 where dp.verdict = 'ACCEPTED'
   and dp.admitted;   -- an extraction not yet admitted (Step 3D) is acquired and reported, never evidence

revoke all on public.dc_entity_geography_evidence from public, anon, authenticated;

comment on view public.dc_entity_geography_evidence is
'STEP 3B. Every coordinate claim linked to a canonical entity, classified by what the evidence is
(PUBLISHER_SITE / DERIVED_ADDRESS / PUBLISHER_NON_SITE / PUBLISHER_UNUSABLE), never by source
name. dc_resolve_geography reads it; no resident reader.';

-- ── WHEN DO TWO SITE CLAIMS CONTRADICT EACH OTHER? (one definition; rule_version 4) ─────────────
-- A claim's own evidence says how far it may be from the true site:
--   * a DERIVED_ADDRESS point carries its calibrated positional uncertainty (Step 3D: 200 Atlas
--     records whose own address was geocoded against their own site point -- p50 120 m, p95 396 m,
--     p99 637 m, max 1,801 m -- carried as 2,000 m). A publisher site point within that bound is
--     exactly what an honest geocode of the same site produces: it corroborates, never vetoes;
--   * a PUBLISHER_SITE point carries no quantified error, so two of them use the PEER tolerance of
--     1 km (the rule_version 2 threshold, unchanged).
-- Allowance = the sum of the two quantified errors, or the peer tolerance when neither has one.
-- Any other class (area / unusable) is not a site claim and never contradicts anything.
-- It knows no source, no place and no facility: only classes, errors and distance.
create or replace function public.dc_site_claims_conflict(
    p_class_a text, p_uncertainty_a double precision, p_lat_a double precision, p_lng_a double precision,
    p_class_b text, p_uncertainty_b double precision, p_lat_b double precision, p_lng_b double precision)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
    select p_class_a in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')
       and p_class_b in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')
       and ST_DistanceSphere(ST_MakePoint(p_lng_a, p_lat_a), ST_MakePoint(p_lng_b, p_lat_b))
           > case when p_uncertainty_a is null and p_uncertainty_b is null then 1000
                  else coalesce(p_uncertainty_a, 0) + coalesce(p_uncertainty_b, 0) end
$$;

revoke all on function public.dc_site_claims_conflict(text, double precision, double precision, double precision,
                                                      text, double precision, double precision, double precision)
    from public, anon, authenticated;

comment on function public.dc_site_claims_conflict(text, double precision, double precision, double precision,
                                                   text, double precision, double precision, double precision) is
'STEP 3B. Whether two site claims of one entity contradict each other: farther apart than the sum of
their quantified positional errors (a derived point''s calibrated bound), or than the 1 km peer
tolerance when neither carries one. Evidence classes only; no source, place or facility.';

create or replace function public.dc_resolve_geography(p_apply boolean default false)
returns table(metric text, value text)
language plpgsql
as $fn$
declare
    v_rule_version constant integer := 5;
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

    -- Every coordinate pair any CURRENT observation of an entity asserts, as classified by the
    -- one evidence view below (publisher points and ACCEPTED derived address points).
    create temporary table _geo_pts on commit drop as
    select canonical_entity_id, oid, source_key, prec, lat, lng, decimals, observed_at, basis,
           basis_rule, basis_evidence, uncertainty_m, evidence_class
      from public.dc_entity_geography_evidence;

    -- Why each entity's derived location did or did not qualify (reported, never a point).
    create temporary table _geo_derived on commit drop as
    select distinct on (eo.canonical_entity_id) eo.canonical_entity_id,
           jsonb_build_object('input_quality', dp.input_quality, 'geocoder_query', dp.geocoder_query,
                              'verdict', dp.verdict, 'reason', dp.verdict_reason,
                              'match_type', dp.match_type, 'matched_address', dp.matched_address) derived
      from public.dc_entity_observation eo
      join public.dc_observation_derived_point dp
        on dp.home_signal_observation_id = eo.home_signal_observation_id
     where dp.admitted
     order by eo.canonical_entity_id, (dp.verdict = 'ACCEPTED') desc, dp.home_signal_observation_id;

    -- ⛔ IDENTITY BEFORE A DERIVED MARKER. An entity with an OPEN cross-source identity question
    -- (dc_entity_identity_open: the automatic IDENTITY_UNRESOLVED) may not be PLACED by a derived
    -- point: the other entity may be the same facility, and two markers for one site is the defect.
    -- The question is answered by Step 3A's one definition, recomputed from evidence on every run;
    -- nothing here waits for a person. Publisher points are unaffected.
    create temporary table _geo_open on commit drop as
    select distinct o.canonical_entity_id
      from public.dc_entity_identity_open o;

    create temporary table _geo_pick on commit drop as
    select distinct on (canonical_entity_id) *
      from _geo_pts
     order by canonical_entity_id,
              -- the EVIDENCE CLASS decides authority (never the source, never the label): a
              -- publisher's site point, then a derived address point, then a non-site or
              -- unusable publisher point (which can never place an entity anyway)
              (evidence_class in ('PUBLISHER_NON_SITE', 'PUBLISHER_UNUSABLE')),
              (evidence_class = 'DERIVED_ADDRESS'),
              -- inside one class only: the publisher's own precision label, then precision
              (prec = 'exact') desc nulls last,
              decimals desc,
              observed_at desc, oid;

    create temporary table _geo_out on commit drop as
    with base as (
        select e.canonical_entity_id, e.entity_grain, p.oid, p.source_key, p.prec, p.lat,
               p.lng, p.decimals, p.basis, p.basis_rule, p.basis_evidence, p.uncertainty_m,
               -- ⚖️ CANONICAL GEOGRAPHY AUTHORITY (rule_version 4). Only SITE claims are compared:
               -- a publisher's site point and an accepted derived address point. A town/area or
               -- unusable point is not a claim about the site, so it neither agrees nor disagrees.
               -- Any two DISTINCT site claims of one entity CONTRADICT each other only when they lie
               -- farther apart than the evidence itself allows (dc_site_claims_conflict). Claims are
               -- paired by (source, class, observation), never by source alone (rule_version 5): a
               -- publisher's point and the geocode of that SAME publisher's address are two claims.
               --   * a derived point carries its calibrated error bound, so a publisher's site point
               --     within that bound is CORROBORATED by it, never vetoed;
               --   * two publisher site points carry no quantified error: the peer tolerance.
               -- A contradiction beyond that allowance fails closed: SOURCES_DISAGREE, no point.
               exists (select 1 from _geo_pts a join _geo_pts b
                         on a.canonical_entity_id = b.canonical_entity_id
                        and (a.source_key, a.evidence_class, a.oid) < (b.source_key, b.evidence_class, b.oid)
                        where a.canonical_entity_id = e.canonical_entity_id
                          and public.dc_site_claims_conflict(a.evidence_class, a.uncertainty_m, a.lat, a.lng,
                                                             b.evidence_class, b.uncertainty_m, b.lat, b.lng)) disagree,
               -- which kind of contradiction (reported, never a different outcome)
               exists (select 1 from _geo_pts a join _geo_pts b
                         on a.canonical_entity_id = b.canonical_entity_id
                        and (a.source_key, a.evidence_class, a.oid) < (b.source_key, b.evidence_class, b.oid)
                        where a.canonical_entity_id = e.canonical_entity_id
                          and a.evidence_class = 'PUBLISHER_SITE' and b.evidence_class = 'PUBLISHER_SITE'
                          and public.dc_site_claims_conflict(a.evidence_class, a.uncertainty_m, a.lat, a.lng,
                                                             b.evidence_class, b.uncertainty_m, b.lat, b.lng)) peer_conflict,
               -- the chosen publisher site point, corroborated by a derived address point (any
               -- publisher's, the point's own publisher included -- rule_version 5)
               (p.evidence_class = 'PUBLISHER_SITE'
                and exists (select 1 from _geo_pts d
                             where d.canonical_entity_id = e.canonical_entity_id
                               and d.evidence_class = 'DERIVED_ADDRESS'
                               and not public.dc_site_claims_conflict(p.evidence_class, p.uncertainty_m, p.lat, p.lng,
                                                                      d.evidence_class, d.uncertainty_m, d.lat, d.lng))) corroborated,
               e.canonical_entity_id in (select canonical_entity_id from _geo_open) identity_open,
               -- a derived point may place only a record whose identity persists across runs: a
               -- singleton key (a name repeated inside its own run) would mint a new marker id
               -- every acquisition
               (p.basis = 'DERIVED_ADDRESS'
                and exists (select 1 from public.dc_observation_record_key rk
                             where rk.home_signal_observation_id = p.oid and rk.record_key_rank = 2)) unstable,
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
                when b.basis = 'DERIVED_ADDRESS' and b.unstable then 'GEOGRAPHY_UNRESOLVED'
                when b.basis = 'DERIVED_ADDRESS' and b.identity_open then 'GEOGRAPHY_UNRESOLVED'
                when b.basis = 'DERIVED_ADDRESS' and b.shared then 'GEOGRAPHY_UNRESOLVED'
                else 'RESOLVED' end status,
           case when b.entity_grain = 'AGGREGATE_MULTI_SITE' then 'PUBLISHER_MULTI_SITE'
                when b.oid is null then 'NO_COORDINATES'
                when b.disagree then 'SOURCES_DISAGREE'
                when b.decimals <= 1 then 'ROUNDED_COORDINATES'
                when b.basis = 'NON_SITE_AREA' then 'PUBLISHER_AREA_POINT'
                when b.basis = 'DERIVED_ADDRESS' and b.unstable then 'UNSTABLE_RECORD_IDENTITY'
                when b.basis = 'DERIVED_ADDRESS' and b.identity_open then 'IDENTITY_UNRESOLVED'
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
               case when b.basis = 'DERIVED_ADDRESS' and b.unstable then 'UNSTABLE_RECORD_IDENTITY' end,
               case when b.basis = 'DERIVED_ADDRESS' and b.identity_open then 'IDENTITY_UNRESOLVED' end,
               case when b.decimals = 2 then 'COARSE_COORDINATES' end,
               case when b.prec = 'approximate' then 'PUBLISHER_APPROXIMATE' end,
               case when b.shared then 'SHARED_COORDINATES' end,
               case when b.disagree then 'SOURCES_DISAGREE' end,
               case when b.disagree and b.peer_conflict then 'SITE_CLAIMS_CONFLICT' end,
               case when b.disagree and not b.peer_conflict then 'DERIVED_ADDRESS_BEYOND_UNCERTAINTY' end,
               case when b.corroborated and not b.disagree then 'CORROBORATED_BY_DERIVED_ADDRESS' end,
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
