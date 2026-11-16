-- APPLY: the data-centre BUILD-SCOPE rule in public.map_site_is_datacenter_type (2026-11-13).
--
-- Generated from docs/fix28-datacenter-zip-membership.sql (the DDL of record), which now equals
-- lib/project-type.js on all 426 frozen production inputs (test/fix28-datacenter-membership.test.mjs,
-- and the same 426 run through this function on a disposable Postgres: 426 agree, 412 true).
--
-- What changes: a record the commercial gate typed "other project" is a data centre when its own
-- words state that the work BUILDS one ("Building a Data Center - Phase 1") and name no equipment
-- inside an existing one; and a named compute facility ("super-compute facility") counts as a data
-- centre name. Used only by the Fix 28 membership trigger on development_reports (a data-centre
-- point outside its ZIP is not kept on that ZIP's cached report).
--
-- One transaction. The checks at the end raise, undoing the replace, unless the function gives the
-- expected answer for the real Memphis records and keeps every guard.
begin;
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
),
-- namesDataCenter() and statesDataCenterBuild() (lib/project-type.js, 2026-11-13).
-- The incidental guard vetoes BOTH name rules; the compute-facility words count only as a
-- named physical facility. A build-scope data centre is the one exception to TERMINAL_NEUTRAL.
d as (
  select n.*,
         (not (n.nm ~* '\y(serving|serves|to\s+serve|to\s+power|powering|powers|in\s+support\s+of|supporting|feeding|adjacent\s+to|next\s+to|abutting|associated\s+with)\y[^.;]{0,60}?(data\s*cent|super(\s|-)?comput|high(\s|-)performance\s+comput|hpc\s+(facility|center|centre|campus|building)|gpu\s+cluster)'
               and n.nm ~* '\ysubstation\y|\yswitchyard\y|switching\s+station\y|\ytransmission\y|\y[0-9]{2,3}\s*kv\y|\ypower\s*line\y|\ytransmission\s+line\y|\ysolar\s+(farm|array|field)\y|photovoltaic|\ybattery\s+(energy\s+)?storage\y|\ybess\y|\ywind\s+(farm|turbine)\y|\ypower\s+plant\y|\ygenerating\s+station\y|\yturbines?\y|\ygenerators?\y|\ygenerating\s+units?\y|\yegus?\y|\ypeakers?\y|\ycell\s+tower\y|\ymonopole\y|\yantenna\y')
          and ((n.nm ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
                and not n.nm ~* 'data\s*cent(er|re)\s+(rd|road|st|street|ave|avenue|ln|lane|dr|drive|blvd|boulevard|way|pkwy|parkway|ct|court|cir|circle)\y')
               or (n.nm ~* '\ysuper(\s|-)?comput(e|er|ing)\s+(facility|center|centre|campus|building)\y|\yhigh(\s|-)performance\s+comput(e|ing)\s+(facility|center|centre|campus|building)\y|\yhpc\s+(facility|center|centre|campus|building)\y|\ygpu\s+cluster\s+(facility|building|campus)\y'
                   and (not n.nm ~* '\ysubstation\y|\yswitchyard\y|switching\s+station\y|\ytransmission\y|\y[0-9]{2,3}\s*kv\y|\ypower\s*line\y|\ytransmission\s+line\y|\ysolar\s+(farm|array|field)\y|photovoltaic|\ybattery\s+(energy\s+)?storage\y|\ybess\y|\ywind\s+(farm|turbine)\y|\ypower\s+plant\y|\ygenerating\s+station\y|\yturbines?\y|\ygenerators?\y|\ygenerating\s+units?\y|\yegus?\y|\ypeakers?\y|\ycell\s+tower\y|\ymonopole\y|\yantenna\y'
                        or n.nm ~* '\yand\s+(an?\s+|the\s+)?(super(\s|-)?comput(e|er|ing)|high(\s|-)performance\s+comput(e|ing)|hpc|gpu\s+cluster)\s+(facility|center|centre|campus|building)\y')))) as nm_dc
  from n
),
e as (
  select d.*,
         (d.nm_dc and d.nm ~* '\ybuild(ing)?\s+(a|an|the|new)\y|\yconstruct(ion|ing)?\y|\ynew\s+(\S+\s+){0,3}(data\s*cent|data\s*hall|building)|\yphase\s+([ivx]+|[0-9]+)\y|\yaddition\y|\yexpan(d|ds|ding|sion)\y|\ycore\s+(and|&)\s+shell\y|\yshell\s+building\y'
                  and not d.nm ~* '\yrack(s|ing)?\y|\ycontainment\y|\ypump\y|\ygenerators?\y|\yups\y|\ycabl(e|es|ing)\y|\ychillers?\y|\ycrah\y|\ycrac\y|\ysprinklers?\y|\yfire\s+alarm\y|\ysigns?\y|\ylighting\y|\ydemoli') as dc_build
  from d
)
select case
  -- ── FACILITY PATH (resolveMarker's isFacilityItem branch) ──────────────────────────
  -- 1. DUAL IDENTITY: statedDataCenter(item, classOnly=true). classOnly means the record
  --    NAME is never evidence here, and terminalNeutral is not consulted on this branch.
  when e.is_facility and (e.use_type ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
                       or e.layer    ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm')
    then true
  -- 2. OVERLAY-ON-TYPE: classifyFacilityOverlayType -> classifyProjectType on the class
  --    fields only. TERMINAL_NEUTRAL and FALLBACK are rejected by the overlay, so an
  --    'other project' facility is a plain regulated facility, never a data centre.
  when e.is_facility and e.u_n <> 'other project' and e.l_n <> 'other project'
       and (e.u_n in ('data center','datacenter','data-center','data centre')
         or e.l_n in ('data center','datacenter','data-center','data centre')
         or e.combined ~* 'data\s*center|hyperscale|server\s*farm')
    then true
  when e.is_facility then false
  -- ── PROJECT PATH (classifyProjectType) ─────────────────────────────────────────────
  -- PRECEDENCE 1.5 — an explicit TERMINAL_NEUTRAL outranks every inference below,
  -- statedDataCenter's name branch included. Terminal means terminal.
  -- ... unless the record's own words state that the work builds or expands a data centre
  -- (founder decision 1, 2026-11-13; statesDataCenterBuild in lib/project-type.js).
  when (e.u_n = 'other project' or e.l_n = 'other project') and not e.dc_build then false
  -- PRECEDENCE 2 — statedDataCenter, class fields first.
  when e.use_type ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
    or e.layer    ~* 'data\s*cent(er|re|e)|data\s*hall|hyperscale|server\s*farm'
    then true
  -- statedDataCenter, NAME branch: the street-name guard and the incidental-reference
  -- guard are both required, and the incidental guard needs BOTH halves (a "serving …"
  -- construction AND a competing infrastructure head noun).
  when e.nm_dc
    then true
  -- TYPE_EXACT / LAYER_EXACT. 'data-center' is here because DATACENTER_RE cannot match it:
  -- \s* does not match a hyphen, so the exact table is the only branch that resolves it.
  when e.u_n in ('data center','datacenter','data-center','data centre')
    or e.l_n in ('data center','datacenter','data-center','data centre')
    then true
  -- KEYWORD_RULES, on the joined class string only (never the name).
  when e.combined ~* 'data\s*center|hyperscale|server\s*farm' then true
  -- NAME_RULES carries NO data-centre rule, deliberately (lib/map.js): a duplicate there
  -- could only fire on a record the guarded phase above had already vetoed.
  else false
end
from e;
$function$;

do $check$
declare bad text := '';
begin
  if not public.map_site_is_datacenter_type('{"use_type":"other project","label":"ACC Project: Building a Data Center - Phase 1"}') then bad := bad || ' build-scope'; end if;
  if public.map_site_is_datacenter_type('{"use_type":"other project","label":"ACC Installing data center containment racking for Oppidan Data Center Facility"}') then bad := bad || ' racking'; end if;
  if public.map_site_is_datacenter_type('{"use_type":"other project","label":"IRON MOUNTAIN DATA CENTER - PUMP"}') then bad := bad || ' pump'; end if;
  if public.map_site_is_datacenter_type('{"use_type":"other project","label":"NEW 132 kV substation to serve the data center campus"}') then bad := bad || ' serving'; end if;
  if not public.map_site_is_datacenter_type('{"use_type":"commercial","label":"gas-fired power plant and super-compute facility"}') then bad := bad || ' compute'; end if;
  if public.map_site_is_datacenter_type('{"use_type":"commercial","label":"AI factory"}') then bad := bad || ' ai-factory'; end if;
  if public.map_site_is_datacenter_type('{"use_type":"energy","label":"Air permit, 15 natural gas turbines, SpaceX Starbase super-compute facility"}') then bad := bad || ' turbines'; end if;
  if public.map_site_is_datacenter_type('{"use_type":"energy","label":"Combustion turbines to power the data center"}') then bad := bad || ' power-serving'; end if;
  if public.map_site_is_datacenter_type('{"use_type":"Data center","layer":"energy","registry_id":"110000000000","label":"x"}') is distinct from true then bad := bad || ' facility-class'; end if;
  if bad <> '' then raise exception 'map_site_is_datacenter_type post-check failed:%', bad; end if;
end
$check$;
commit;
