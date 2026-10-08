#!/usr/bin/env node
// STEP 3C — THE RESIDENT DATA-CENTRE RECONCILIATION REPORT.
//
// The ledger view (public.dc_resident_lineage_ledger, docs/dc-step3c-ledger-distinct-record-grain.sql)
// holds LINEAGE at the grain of one publisher-native source identity. It deliberately does not
// decide "is this a data centre": three shipped readers answer that, they disagree on real rows,
// and a SQL copy would be a second decider. This report closes the gap by RUNNING the shipped
// classifier (lib/map.js) on each candidate's raw inputs, then assigning every identity exactly
// one outcome from a closed vocabulary.
//
// NON-AUTHORITATIVE. It writes nothing. It is a verification of authoritative state, and its
// output is only as good as the authorities it calls -- which is the point: it calls them.
//
//   node scripts/dc-step3c-reconcile.mjs            # live: reads the ledger via the Management API
//   node test/dc-step3c-reconcile.test.mjs          # the pure core, offline
//
// Needs SUPABASE_ACCESS_TOKEN (+ optional SUPABASE_PROJECT_REF) for the live mode. Refuses,
// loudly, without them: a report that could not read the ledger must not print a reconciliation.

// ── THE CLOSED VOCABULARIES ─────────────────────────────────────────────────────────────────
// Every identity in the ledger lands in EXACTLY ONE of: a DISPOSITION (it is resident Data
// Centre truth, and here is where its evidence stands) or an EXCLUSION (it is in storage but is
// not resident Data Centre truth, and here is why). Adding a value is a deliberate edit.
export const DISPOSITIONS = Object.freeze([
  'BACKED_BY_CANONICAL_EVIDENCE',
  'REACQUIRED_FROM_ORIGINAL_SOURCE',
  'LEGACY_SOURCE_KNOWN_RECORD_GONE',
  'LEGACY_WITHOUT_RECOVERABLE_PROVENANCE',
  'DERIVED_DUPLICATE',
  'PROVEN_NON_DC_OR_ERRONEOUS',
  'UNRESOLVED_BLOCKER',
  'UNEXPLAINED',
]);
export const EXCLUSIONS = Object.freeze([
  'NOT_DC_ON_ANY_SHIPPED_READER',       // a regex candidate that no resident reader draws as a DC
  'OSM_NEVER_SERVED_NOT_MAP_ELIGIBLE',  // national_dc_for_zip filters map_eligible
  'OSM_SERVED_TO_NO_ADMITTED_ZIP',      // eligible, but the RPC returns it for no Fix-29 page
]);
export const BLOCKERS = Object.freeze([
  'PUBLISHER_NOT_REGISTERED_AS_DC_SOURCE',  // not in the evidence-plane source registry; never acquired
]);

// The populations the ledger MUST carry, with the grain each one is. A population that goes
// missing is a REFUSAL, never a smaller denominator: dropping a whole class and still printing
// UNEXPLAINED = 0 is the defect this list exists to make impossible.
export const POPULATIONS = Object.freeze({
  osm:                { grain: 'PHYSICAL_SITE',         plane: 'national_dc_records' },
  legacy_facility:    { grain: 'FACILITY_REGISTRATION', plane: 'app_projects' },
  legacy_development: { grain: 'DEVELOPMENT_FILING',    plane: 'app_projects' },
});

// Publisher verdicts are EVIDENCE a probe returned (e.g. "OSM says this element was deleted").
// They are optional input; without one, an unregistered source stays UNRESOLVED_BLOCKER.
export const PUBLISHER_VERDICTS = Object.freeze(['RECORD_GONE', 'PUBLISHER_SAYS_NOT_DC']);

// ── THE PURE CORE ──────────────────────────────────────────────────────────────────────────
export function reconcile(ledgerRows, { isResidentDC, publisherVerdicts = {}, controls } = {}) {
  if (typeof isResidentDC !== 'function') throw new Error('reconcile() needs isResidentDC');
  const problems = [];
  const rows = Array.isArray(ledgerRows) ? ledgerRows : [];
  if (!rows.length) problems.push('the ledger returned 0 rows -- a failed read, not an empty universe');

  // CONTROLS COUNTED STRAIGHT FROM THE SOURCE TABLES, NOT THROUGH THE VIEW. A view that
  // silently drops rows (a WHERE on a nullable key, a lost UNION branch) produces a ledger
  // that reconciles perfectly with itself. Only an independent count can see the omission.
  if (!controls) {
    problems.push('no independent source controls supplied -- an omitted record would be invisible');
  } else {
    const legacy = rows.filter((r) => r.resident_storage_plane === 'app_projects').length;
    const osm = rows.filter((r) => r.resident_storage_plane === 'national_dc_records').length;
    if (legacy !== controls.app_projects_candidate_identities) {
      problems.push(`ledger carries ${legacy} app_projects identities; the table has ${controls.app_projects_candidate_identities} -- a resident record was omitted or invented`);
    }
    if (osm !== controls.national_dc_records_rows) {
      problems.push(`ledger carries ${osm} OSM identities; national_dc_records has ${controls.national_dc_records_rows}`);
    }
    if (Number.isInteger(controls.osm_reachable_via_rpc)) {
      const reach = rows.filter((r) => r.source_population === 'osm' && r.resident_reachable).length;
      if (reach !== controls.osm_reachable_via_rpc) problems.push(`ledger marks ${reach} OSM reachable; the RPC returns ${controls.osm_reachable_via_rpc}`);
    }
  }

  const seen = new Map();
  for (const r of rows) seen.set(r.record_key, (seen.get(r.record_key) || 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (dup.length) problems.push(`DUPLICATE_DENOMINATOR_ROWS: ${dup.length} record_key(s) appear twice: ${dup.slice(0, 5).join(', ')}`);

  for (const [pop, spec] of Object.entries(POPULATIONS)) {
    const n = rows.filter((r) => r.source_population === pop).length;
    if (!n) problems.push(`population ${pop} is ABSENT from the ledger -- a whole record class cannot vanish behind UNEXPLAINED = 0`);
    const wrong = rows.filter((r) => r.source_population === pop && (r.record_grain !== spec.grain || r.resident_storage_plane !== spec.plane));
    if (wrong.length) problems.push(`${wrong.length} ${pop} row(s) carry a grain/plane other than ${spec.grain}/${spec.plane}`);
  }
  const unknown = rows.filter((r) => !POPULATIONS[r.source_population]);
  if (unknown.length) problems.push(`UNCLASSIFIED_RESIDENT_GRAINS: ${unknown.length} row(s) in unknown population(s) ${[...new Set(unknown.map((r) => r.source_population))].join(', ')}`);

  const records = [];
  for (const r of rows) {
    if (!POPULATIONS[r.source_population]) continue;
    const out = { record_key: r.record_key, source_population: r.source_population, record_grain: r.record_grain };
    if (r.source_population === 'osm') {
      if (r.resident_reachable && r.osm_map_eligible === false) {
        problems.push(`${r.record_key}: reachable but not map_eligible -- the RPC filters those, so this is a broken read`);
      }
      if (!r.resident_reachable) {
        out.exclusion = r.osm_map_eligible ? 'OSM_SERVED_TO_NO_ADMITTED_ZIP' : 'OSM_NEVER_SERVED_NOT_MAP_ELIGIBLE';
        records.push(out); continue;
      }
    } else {
      if (!r.resident_reachable) problems.push(`${r.record_key}: legacy row not reachable -- app_projects is anon-readable, so this is a broken read`);
      const verdict = isResidentDC(r);
      out.dc_paths = verdict.paths;
      if (!verdict.dc) { out.exclusion = 'NOT_DC_ON_ANY_SHIPPED_READER'; records.push(out); continue; }
    }
    // In the denominator. Evidence is linked ONLY through the ledger's scoped join.
    const pv = publisherVerdicts[r.record_key];
    if (pv !== undefined && !PUBLISHER_VERDICTS.includes(pv)) problems.push(`${r.record_key}: unknown publisher verdict ${pv}`);
    if (r.source_observation_id) out.disposition = 'BACKED_BY_CANONICAL_EVIDENCE';
    else if (!r.has_source_native_key) out.disposition = 'LEGACY_WITHOUT_RECOVERABLE_PROVENANCE';
    else if (pv === 'RECORD_GONE') out.disposition = 'LEGACY_SOURCE_KNOWN_RECORD_GONE';
    else if (pv === 'PUBLISHER_SAYS_NOT_DC') out.disposition = 'PROVEN_NON_DC_OR_ERRONEOUS';
    else if (!r.dc_source_key) { out.disposition = 'UNRESOLVED_BLOCKER'; out.blocker = 'PUBLISHER_NOT_REGISTERED_AS_DC_SOURCE'; }
    else out.disposition = 'UNEXPLAINED';
    records.push(out);
  }

  const inDen = records.filter((x) => x.disposition);
  const byDisp = Object.fromEntries(DISPOSITIONS.map((d) => [d, inDen.filter((x) => x.disposition === d).length]));
  const byExcl = Object.fromEntries(EXCLUSIONS.map((e) => [e, records.filter((x) => x.exclusion === e).length]));
  const offVocab = records.filter((x) => (x.disposition && !DISPOSITIONS.includes(x.disposition)) || (x.exclusion && !EXCLUSIONS.includes(x.exclusion)) || (!x.disposition === !x.exclusion));
  if (offVocab.length) problems.push(`${offVocab.length} record(s) have no single closed-vocabulary outcome`);

  const residentTotal = inDen.length;
  const dispSum = Object.values(byDisp).reduce((a, b) => a + b, 0);
  const exclSum = Object.values(byExcl).reduce((a, b) => a + b, 0);
  if (dispSum !== residentTotal) problems.push(`dispositions sum to ${dispSum}, RESIDENT_TOTAL is ${residentTotal}`);
  if (dispSum + exclSum !== records.length) problems.push(`dispositions ${dispSum} + exclusions ${exclSum} != ${records.length} ledger identities`);
  if (byDisp.UNEXPLAINED) problems.push(`UNEXPLAINED = ${byDisp.UNEXPLAINED}`);

  const byPop = {};
  for (const pop of Object.keys(POPULATIONS)) byPop[pop] = inDen.filter((x) => x.source_population === pop).length;
  const safe = byDisp.BACKED_BY_CANONICAL_EVIDENCE + byDisp.REACQUIRED_FROM_ORIGINAL_SOURCE;
  return {
    records,
    problems,
    summary: {
      LEDGER_IDENTITIES: records.length,
      RESIDENT_TOTAL: residentTotal,
      RESIDENT_BY_POPULATION: byPop,
      ...byDisp,
      EXCLUSIONS: byExcl,
      ACCOUNTED_FOR_RESIDENT_RECORDS: residentTotal - byDisp.UNEXPLAINED,
      SAFE_FOR_CANONICAL_CUTOVER: safe,
      BLOCKING_CANONICAL_CUTOVER: residentTotal - safe,
    },
  };
}

// ── THE SHIPPED CLASSIFIER, CALLED — NOT COPIED ──────────────────────────────────────────────
// Two resident paths read app_projects rows:
//   raw   the dossier / dashboard / project lists pass the row itself to HS.resolveMarker,
//         whose class fields include type_raw;
//   site  Map 1 ZIP mode turns a DEVELOPMENT row into a site via HS.zipAuthSiteFromMarker
//         (type -> use_type, name -> label; type_raw deliberately NOT mapped) and resolves
//         HS.trackerSiteItem(site). zipAuthSiteFromMarker is development-only ("never a
//         facility", rule 2), so a facility never takes this path -- running it on one
//         manufactures a data centre no resident sees (measured: EPA FRS 110038203734).
// A record is resident Data Centre truth if ANY shipped path draws it as one.
// MAPS (homesignal-ingest bluesky/lib/maps-datacenter.mjs) is a verbatim port of the raw
// path's statedDataCenter plus TYPE_EXACT, over the same rows; measured 2026-09-22 it added
// no row the raw path lacked. It lives in the other repo, so this report cannot import it --
// stated here rather than implied.
export async function shippedClassifier() {
  const g = globalThis;
  if (!g.window) g.window = { HS: {} };
  const base = new URL('../lib/', import.meta.url);
  for (const f of ['templates.js', 'project-type.js', 'map.js', 'residential-qualify.js', 'zip-authoritative.js']) {
    await import(new URL(f, base).href);
  }
  const HS = g.window.HS;
  if (typeof HS.resolveMarker !== 'function' || typeof HS.zipAuthSiteFromMarker !== 'function' || typeof HS.trackerSiteItem !== 'function') {
    throw new Error('the shipped classifier did not load -- refusing rather than classifying nothing');
  }
  const isDC = (m) => !!m && m.categoryKey === 'datacenter';
  return function isResidentDC(row) {
    const inputs = Array.isArray(row.classifier_inputs) ? row.classifier_inputs : [];
    const paths = new Set();
    for (const inp of inputs) {
      if (isDC(HS.resolveMarker(inp))) paths.add('raw');
      if (inp.record_kind === 'development') {
        const site = HS.zipAuthSiteFromMarker({ lat: 1, lng: 1 }, inp);
        if (site && isDC(HS.resolveMarker(HS.trackerSiteItem(site)))) paths.add('site');
      }
    }
    return { dc: paths.size > 0, paths: [...paths].sort() };
  };
}

// ── LIVE MODE ──────────────────────────────────────────────────────────────────────────────
export async function query(sql) {
  const token = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  const ref = (process.env.SUPABASE_PROJECT_REF || 'qwnnmljucajnexpxdgxr').trim();
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set -- refusing rather than reporting a reconciliation it never read');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json',
      // Cloudflare in front of api.supabase.com rejects default client signatures with 403/1010
      // before authentication (db-sql.yml carries the receipt).
      'User-Agent': 'HomeSignal-dc-step3c-reconcile/1.0 (+https://homesignal.net)',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// The ONE reader of the reconciliation plane. Anything else that needs the ledger (e.g. the
// publisher probe) calls this, so the isolation gate can keep a single permitted reader.
export async function readLedger() {
  return query('select * from public.dc_resident_lineage_ledger');
}

function md5(s) { return import('node:crypto').then((c) => c.createHash('md5').update(s).digest('hex')); }

// The candidate superset, restated here ONLY to count it independently of the view. It must
// stay byte-identical to the view's filter; test/dc-step3c-reconcile.test.mjs pins that.
export const SUPERSET_SQL = "p.type ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server' or p.type_raw ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server' or p.name ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server'";

export const CONTROLS_SQL = `select
  (select count(distinct coalesce(p.source_key, 'app_projects:' || p.id::text)) from public.app_projects p where ${SUPERSET_SQL})::int as app_projects_candidate_identities,
  (select count(*) from public.national_dc_records)::int as national_dc_records_rows,
  (select count(distinct r.source_key) from geo.maps_zip_geography_status s
     join public.development_reports d on d.zip = s.zip
     cross join lateral public.national_dc_for_zip(s.zip, 5) r
    where s.status = 'boundary_complete')::int as osm_reachable_via_rpc`;

async function main() {
  const ledger = await readLedger();
  const [controls] = await query(CONTROLS_SQL);
  const isResidentDC = await shippedClassifier();
  const { summary, problems, records } = reconcile(ledger, { isResidentDC, controls });
  console.log('independent source controls .....', JSON.stringify(controls));
  const den = records.filter((r) => r.disposition).map((r) => r.record_key).sort();
  // JS sort is codepoint order == Postgres collate "C" (CLAUDE.md claims rule 9).
  summary.RESIDENT_DENOMINATOR_FP = await md5(den.join(','));
  summary.DC_PATHS = {};
  for (const r of records.filter((x) => x.dc_paths)) {
    const k = r.dc_paths.join('+') || 'none';
    summary.DC_PATHS[k] = (summary.DC_PATHS[k] || 0) + 1;
  }
  console.log('ledger rows read (control) ......', ledger.length);
  console.log(JSON.stringify(summary, null, 2));
  if (problems.length) {
    console.log('\nFAIL:');
    for (const p of problems) console.log('  - ' + p);
    process.exit(1);
  }
  console.log('\nPASS: every ledger identity has exactly one closed-vocabulary outcome; UNEXPLAINED = 0.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('REFUSED: ' + e.message); process.exit(1); });
}
