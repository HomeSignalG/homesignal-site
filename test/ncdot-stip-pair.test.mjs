// Offline regression checks for the `ncdot-stip-projects-{points,lines}` pair — NCDOT's
// 2026-2035 State Transportation Improvement Program.
// No network: the registry is read from disk and asserted against measurements taken live
// on 2026-08-26 (receipts in each entry's `_receipts` + docs/source-registry.md "NORTH CAROLINA").
//
// WHY THIS EXISTS. Four facts a config diff cannot show, each of which silently breaks the
// wire if it drifts:
//
//   • THE WINDOW MUST BE A YEAR WHITELIST, NEVER `>= '2026'`. ConstructionYear is a STRING
//     carrying 'NOT FUNDED' and 'FUNDED FOR PRELIMINARY ENGINEERING ONLY' alongside years.
//     Lexically 'N'(78) and 'F'(70) both sort ABOVE '2'(50), so the comparison form ADMITS
//     them. Measured live: whitelist L0 556 / L1 755 vs naive '>=' L0 598 / L1 958 — L0's
//     +42 is exactly NOT FUNDED 4 + FUNDED FOR PE 38. A reviewer reading `>= '2026'` would
//     see a forward window; the data would carry every unfunded project in the programme.
//
//   • POINTS YIELDS TO LINES, on a MEASURED 12-of-3,051 overlap. Distinct TIPs: L0 1,120 ·
//     L1 1,943 · shared 12 · union 3,051. Non-zero, so declaring is correct (the NE case);
//     had it been zero, declaring would DROP records (the NY counter-case). The direction
//     and the match key are both load-bearing.
//
//   • STATUS IS A CONST BECAUSE THE LAYER HAS NO STATUS COLUMN. Every row surviving the
//     window has a future construction year, so `proposed` asserts nothing unevidenced.
//     Nothing may claim approved/operating: the layer cannot evidence that.
//
//   • BOTH ENTRIES CARRY AN IDENTICAL type_map. A shared project must not render as a
//     different use_type depending on which geometry published it (the NE rule).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : ''));
  if (!c) fails++;
};

const SRC = join(root, 'supabase/functions/get-address-report/sources/arcgis.ts');
let coverageMatches, arcgisForZip;
try {
  ({ coverageMatches, arcgisForZip } = await import(SRC));
} catch (err) {
  console.log('FAIL — import sources/arcgis.ts (needs Node >= 22.18 type stripping)\n     ' + err.message);
  process.exit(1);
}

const REG = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const P = REG.arcgis.find((e) => e.registry_id === 'ncdot-stip-projects-points');
const L = REG.arcgis.find((e) => e.registry_id === 'ncdot-stip-projects-lines');

if (!P || !L) {
  console.log('FAIL — one or both ncdot-stip-projects entries missing from jurisdiction-registry.json');
  process.exit(1);
}

// ── 1. Both entries exist, read the right layers, statewide NC ──────────────────
{
  ok(/\/NCDOT_STIP\/MapServer\/0$/.test(P.service_url), 'points reads NCDOT_STIP layer 0');
  ok(/\/NCDOT_STIP\/MapServer\/1$/.test(L.service_url), 'lines reads NCDOT_STIP layer 1');
  ok(!/FeatureServer/.test(P.service_url + L.service_url),
    'neither entry points at the NCDOT_STIP FeatureServer — that endpoint returns HTTP 500; only the MapServer answers');
  for (const [n, e] of [['points', P], ['lines', L]]) {
    ok(e.coverage.length === 1 && e.coverage[0].state === 'NC' && !e.coverage[0].county,
      `${n}: coverage is exactly [{state: NC}] — statewide, no county narrowing`);
    ok(e.spatial_zip_radius_mi === 3, `${n}: spatial ZIP scoping at 3 mi — neither layer has a ZIP column`);
    ok(e.record_url_precision === 'dataset' && !e.column_map.record_url,
      `${n}: dataset precision — no per-record URL column exists on either layer`);
    ok(!e.record_url_template, `${n}: no templated record_url — templating one would be guessing`);
  }
  ok(P.jurisdiction.includes('—') && P.jurisdiction.split('—')[0].trim() === 'North Carolina Department of Transportation (NCDOT)',
    'jurisdiction uses an em-dash so the user-visible county-sources label truncates to the agency name alone');
}

// ── 2. THE WINDOW — a year whitelist, never a lexical comparison ────────────────
{
  const YEARS = ['2026', '2027', '2028', '2029', '2030', '2031', '2032', '2033', '2034', '2035'];
  for (const [n, e] of [['points', P], ['lines', L]]) {
    const w = e.extra_where;
    ok(typeof w === 'string' && /ConstructionYear\s+IN\s*\(/i.test(w),
      `${n}: extra_where is an IN whitelist on ConstructionYear`);
    ok(!/>=|<=|>|</.test(w),
      `${n}: NO comparison operator — 'NOT FUNDED'(N=78) and 'FUNDED FOR…'(F=70) both sort ABOVE '2026' in a STRING compare, so >= would admit the very rows the founder excluded`);
    for (const y of YEARS) ok(w.includes(`'${y}'`), `${n}: window includes ${y}`);
    ok(!/'20(0|1|2[0-5])/.test(w), `${n}: window contains NO past year`);
    ok(!/NOT FUNDED/i.test(w) && !/PRELIMINARY/i.test(w),
      `${n}: the excluded text values are absent by construction, not by an extra clause`);
  }
  ok(P.extra_where === L.extra_where, 'both entries carry the IDENTICAL window');
}

// ── 3. THE YIELD — measured 12-of-3,051, direction and key both load-bearing ────
{
  ok(P.yields_to === 'ncdot-stip-projects-lines',
    'POINTS yields_to LINES — 12 TIPs of a 3,051 union appear in both layers, so omitting the yield double-emits them');
  ok(!L.yields_to, 'LINES yields to nothing — the relation is one-directional');
  ok(P.column_map.case_number === 'TIP' && L.column_map.case_number === 'TIP',
    'both key case_number on TIP, which is what the yield hook matches on');
}

// ── 4. STATUS — a const, because the layer has no status column ─────────────────
{
  for (const [n, e] of [['points', P], ['lines', L]]) {
    ok(typeof e.status_const === 'string' && /Programmed/i.test(e.status_const) && /2026-2035/.test(e.status_const),
      `${n}: status_const is the self-describing programme string`);
    ok(!e.column_map.status_raw, `${n}: no status_raw — the STIP layer has NO status column at all`);
    ok(e.status_to_bucket.proposed.length === 1 && e.status_to_bucket.proposed[0] === e.status_const,
      `${n}: the one status value buckets to proposed`);
    ok(e.status_to_bucket.approved.length === 0 && e.status_to_bucket.operating.length === 0,
      `${n}: nothing is claimed approved or built — the layer cannot evidence either`);
  }
  ok(P.status_const === L.status_const, 'both entries carry the identical status_const');
}

// ── 5. No fabricated dates — ConstructionYear is a bare year, not a day ─────────
{
  for (const [n, e] of [['points', P], ['lines', L]]) {
    ok(!e.column_map.file_date && !e.column_map.decision_date,
      `${n}: no date mapping — ConstructionYear is a bare fiscal year (and free text), never a day`);
    ok(!e.file_date_kind, `${n}: no file_date_kind without a file_date`);
    ok(!e.recency_days,
      `${n}: no recency_days — it emits a DATE literal, and there is no date column to compare (the Anaheim string-date lesson)`);
  }
}

// ── 6. type_map — complete, closed vocabulary, identical on both ────────────────
{
  const TYPES = new Set(['Residential', 'Commercial', 'Utility', 'Development', 'Industrial', 'Civic/Public']);
  const MODES = ['Highway', 'Rail', 'Bike & Ped', 'Aviation', 'Ferry', 'Public Transportation (Transit)'];
  for (const [n, e] of [['points', P], ['lines', L]]) {
    ok(Object.keys(e.type_map).length === 6, `${n}: all 6 live Mode values mapped (got ${Object.keys(e.type_map).length})`);
    for (const m of MODES) ok(e.type_map[m], `${n}: Mode "${m}" is mapped`);
    ok(Object.values(e.type_map).every((v) => TYPES.has(v)),
      `${n}: every use_type is in the closed six-value vocabulary`,
      [...new Set(Object.values(e.type_map))].filter((v) => !TYPES.has(v)).join(', '));
    ok(!Object.values(e.type_map).includes('Other'), `${n}: no off-vocabulary "Other"`);
    ok(!('' in e.type_map),
      `${n}: the single empty-string Mode is deliberately UNMAPPED — mapping '' to a use_type would be a guess`);
  }
  ok(JSON.stringify(P.type_map) === JSON.stringify(L.type_map),
    'both entries carry the IDENTICAL type_map — a shared project must not change use_type with its geometry');
  ok(P.type_map['Ferry'] === 'Civic/Public' && P.type_map['Public Transportation (Transit)'] === 'Civic/Public',
    'public transport modes are Civic/Public, matching the WYDOT precedent');
}

// ── 7. out_fields projects every mapped column ──────────────────────────────────
{
  for (const [n, e] of [['points', P], ['lines', L]]) {
    const mapped = Object.entries(e.column_map)
      .filter(([k]) => k !== 'lat' && k !== 'lng')
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
    ok(mapped.every((c) => e.out_fields.includes(c)),
      `${n}: out_fields projects EVERY mapped column — a projection that drops one silently blanks it`,
      mapped.filter((c) => !e.out_fields.includes(c)).join(', '));
    ok(e.out_fields.includes('ConstructionYear'),
      `${n}: ConstructionYear is projected — it is what the window filters on`);
    ok(e.column_map.lat === '__lat' && e.column_map.lng === '__lng',
      `${n}: geometry rides the connector's flattened __lat/__lng`);
  }
}

// ── 8. Coverage gate, both directions — Fort Mill SC is the control ─────────────
{
  for (const [n, e] of [['points', P], ['lines', L]]) {
    ok(coverageMatches(e.coverage, [{ state: 'NC', county: 'Mecklenburg' }]), `${n}: gate ALLOWS NC`);
    ok(!coverageMatches(e.coverage, [{ state: 'SC', county: 'York' }]), `${n}: gate BLOCKS SC (Fort Mill)`);
    ok(!coverageMatches(e.coverage, [{ state: 'VA', county: 'Danville City' }]), `${n}: gate BLOCKS VA`);
    ok(!coverageMatches(e.coverage, [{ state: 'TN', county: 'Sullivan' }]), `${n}: gate BLOCKS TN`);
  }
}
{
  // Fort Mill SC 29715 sits ~2 mi from the Mecklenburg NC line, so its 3-mi radius genuinely
  // overlaps North Carolina. A coverage bug here could NOT hide behind an empty result.
  const calls = [];
  const stub = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ features: [] }) }; };
  const { sites } = await arcgisForZip(
    '29715', [{ state: 'SC', county: 'York' }], [P, L],
    { fetch: stub, zipCentroid: () => ({ lat: 35.0074, lng: -80.9451 }) },
  );
  ok(sites.length === 0 && calls.length === 0,
    'Fort Mill SC (29715) emits nothing AND NEVER FETCHES either layer — despite its 3-mi radius crossing into NC');
}

console.log(fails ? `\n${fails} ncdot-stip-pair assertion(s) FAILED.` : '\nAll ncdot-stip-pair assertions passed.');
process.exit(fails ? 1 : 0);
