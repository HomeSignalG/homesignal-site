// FIX 28 — DATA CENTER TYPE GEOGRAPHIC MEMBERSHIP (offline half)
//
// Fix 28 changes geographic ATTRIBUTION, never Type CLASSIFICATION. This file holds the two
// offline proofs of that:
//
//   §1-§2  CLASSIFICATION PARITY. The SHIPPED classifier (lib/map.js, through the page's own
//          HS.resolveTrackerMarker) is run over every DISTINCT classifier input behind the
//          1,218 point-scope Data-centre candidates in production, frozen BEFORE any
//          implementation. The expected column is NOT generated from lib/map.js: it is the
//          verdict of the production SQL projection, read back out of the database, so the
//          fixture cannot be circular and neither side can drift alone.
//   §3-§7  STRUCTURAL PINS on docs/fix28-datacenter-zip-membership.sql: its regexes are
//          lib/map.js's regexes (extracted from lib/map.js at test time, not retyped here),
//          its field mapping is HS.trackerSiteItem's, its predicate is the accepted
//          ST_Intersects membership, and it carries no buffer / radius / centroid / tolerance
//          and no way to touch a ZIP with no boundary.
//
// Run: node test/fix28-datacenter-membership.test.mjs
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

global.window = { HS: {}, sessionStorage: { _v: null, getItem() { return this._v; }, setItem(k, v) { this._v = v; } } };
await import('../lib/templates.js');
await import('../lib/map.js');
const HS = global.window.HS;

// The page's own normalizer + FRS id reader, verbatim from homesignalmap.html:
//   HS.resolveTrackerMarker(s, frsRid)  ·  frsRid(s) = String(s.registry_id).trim()
const frsRid = (s) => (s && s.registry_id != null) ? String(s.registry_id).trim() : '';
const isDataCenterType = (site) => HS.resolveTrackerMarker(site, frsRid).typeKey === 'datacenter';

const FIXTURE = new URL('./fixtures/fix28/datacenter-type-inputs.psv', import.meta.url);
const raw = readFileSync(FIXTURE, 'utf8');
const rows = raw.split('\n').filter((l) => /^[0-9]/.test(l)).map((l) => {
  // split on the first 7 pipes only — a label may legitimately contain one.
  const p = [];
  let rest = l;
  for (let i = 0; i < 7; i++) { const k = rest.indexOf('|'); p.push(rest.slice(0, k)); rest = rest.slice(k + 1); }
  p.push(rest);
  const [idx, expect, hasRid, use_type, layer, site_type, category, label] = p;
  return {
    idx: Number(idx),
    expect: expect === '1',
    site: {
      scope: 'point',
      type: site_type || undefined,
      use_type: use_type || undefined,
      layer: layer || undefined,
      category: category || undefined,
      label: label || undefined,
      registry_id: hasRid === '1' ? '110000000000' : undefined,
    },
  };
});

// ── §1. THE CORPUS IS THE ONE THAT WAS FROZEN ─────────────────────────────────────────
// md5 over `has_rid|use_type|layer|site_type|category|label`, one row per line, in the
// fixture's own order — recomputed in the database over the frozen cohort and equal there.
// A fingerprint, not an eyeball (CLAUDE.md rule 8): 411 plausible rows look exactly like 426.
const fingerprint = rows.map((r) => [
  r.site.registry_id ? '1' : '0',
  r.site.use_type || '', r.site.layer || '', r.site.type || '',
  r.site.category || '', r.site.label || '',
].join('|')).join('\n') + '\n';
const { createHash } = await import('node:crypto');
const md5 = createHash('md5').update(fingerprint).digest('hex');
ok(rows.length === 426, `§1a corpus holds all 426 distinct classifier inputs (got ${rows.length})`);
ok(md5 === '73541120b71351703d6fcde9b0988e1c',
  `§1b corpus fingerprint matches the database (${md5})`);

// ── §2. CLASSIFICATION PARITY, RECORD BY RECORD ───────────────────────────────────────
const disagreements = rows.filter((r) => isDataCenterType(r.site) !== r.expect);
ok(disagreements.length === 0,
  `§2a shipped lib/map.js agrees with the SQL projection on all 426 inputs` +
  (disagreements.length ? ` — first: #${disagreements[0].idx} ${JSON.stringify(disagreements[0].site.label)}` : ''));
const jsTrue = rows.filter((r) => isDataCenterType(r.site)).length;
ok(jsTrue === 411, `§2b 411 of 426 classify as Data center (got ${jsTrue})`);
// The 15 negatives are the classifier's own guards, and they are the half a bad projection
// would quietly lose. Named, so a regression says WHICH rule stopped working.
const neg = rows.filter((r) => !r.expect);
ok(neg.length === 15, `§2c exactly 15 frozen negatives (got ${neg.length})`);
ok(neg.filter((r) => (r.site.use_type || '') === 'other project').length === 12,
  '§2d 12 negatives are TERMINAL_NEUTRAL "other project" — an explicit unresolved type outranks the name');
ok(neg.some((r) => r.site.registry_id && (r.site.layer || '') === 'energy'),
  '§2e a facility stamped `energy` whose NAME says "DATA HALL" is NOT a data centre (classOnly)');
ok(neg.filter((r) => !r.site.registry_id && (r.site.use_type || '') === 'unclassified').length === 2,
  '§2f 2 negatives carry no data-centre string in any field trackerSiteItem maps');

// ── §3. THE SQL PROJECTION USES lib/map.js's OWN REGEXES ──────────────────────────────
// Extracted from lib/map.js HERE rather than retyped, so editing either side fails this.
const mapSrc = readFileSync(new URL('../lib/map.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../docs/fix28-datacenter-zip-membership.sql', import.meta.url), 'utf8');
const jsRe = (name) => {
  const m = mapSrc.match(new RegExp('const ' + name + ' = /([\\s\\S]*?)/i;'));
  if (!m) throw new Error(`could not read ${name} from lib/map.js`);
  return m[1];
};
// JS -> POSIX ARE: non-capturing groups have no POSIX spelling, \b is \y, \d is [0-9].
const toPosix = (s) => s.replace(/\(\?:/g, '(').replace(/\\b/g, '\\y').replace(/\\d/g, '[0-9]');
for (const name of ['DATACENTER_RE', 'DATACENTER_NOT_RE', 'DATACENTER_SERVING_RE', 'DATACENTER_COMPETING_RE']) {
  const want = toPosix(jsRe(name));
  ok(sql.includes(want), `§3 ${name} appears in the SQL exactly as lib/map.js spells it`);
}
ok(sql.includes("'data\\s*center|hyperscale|server\\s*farm'"),
  '§3e the KEYWORD_RULES data-centre pattern is carried too');
for (const key of ['data center', 'datacenter', 'data-center', 'data centre']) {
  ok(sql.includes(`'${key}'`), `§3f TYPE_EXACT key "${key}" is carried (DATACENTER_RE cannot match "data-center")`);
}

// ── §4. THE FIELD MAPPING IS HS.trackerSiteItem's, INCLUDING ITS OMISSIONS ────────────
// type_raw travels as `permit_class` and is read ONLY by dataCenterSignificance; feeding it
// to the classifier would widen the frozen Type. The projection must not read it, and must
// not read `category` either — trackerSiteItem does not map it.
ok(!/site->>'type_raw'/.test(sql), "§4a the projection never reads site.type_raw (trackerSiteItem does not map it)");
ok(!/site->>'permit_class'/.test(sql), '§4b the projection never reads site.permit_class');
ok(!/site->>'category'/.test(sql), '§4c the projection never reads site.category (trackerSiteItem does not map it)');
ok(/site->>'use_type'/.test(sql) && /site->>'layer'/.test(sql) && /site->>'label'/.test(sql)
   && /site->>'registry_id'/.test(sql),
  '§4d the projection reads exactly use_type, layer, label and registry_id');
// trackerSiteItem sets item.type = s.use_type, so the classifier sees use_type TWICE in the
// KEYWORD join. Losing the repetition is invisible on today's corpus and wrong in principle.
ok(/nullif\(lower\(btrim\(use_type\)\),''\),\s*\n\s*nullif\(lower\(btrim\(use_type\)\),''\)/.test(sql),
  '§4e the KEYWORD join repeats use_type, because item.type IS item.use_type');

// ── §5. THE MEMBERSHIP PREDICATE IS THE ACCEPTED ONE, AND IT IS BOUNDARY-INCLUSIVE ────
ok(/ST_Intersects\(\s*\n?\s*ST_SetSRID\(ST_MakePoint\(\(site->>'lng'\)::float8, \(site->>'lat'\)::float8\), 4269\)/.test(sql),
  '§5a membership is ST_Intersects of ST_SetSRID(ST_MakePoint(lng, lat), 4269) — the N5 driver’s own expression');
ok(!/ST_Contains\s*\(/.test(sql) && !/ST_Within\s*\(/.test(sql),
  '§5b no boundary-EXCLUSIVE predicate: a point on a shared ZCTA edge must belong to both, never to neither');

// ── §6. NOTHING HERE MANUFACTURES GEOMETRY ────────────────────────────────────────────
for (const forbidden of ['ST_Buffer', 'ST_Centroid', 'ST_PointOnSurface', 'ST_Envelope', 'ST_DWithin', 'ST_Expand']) {
  ok(!new RegExp(forbidden, 'i').test(sql.replace(/^\s*--.*$/gm, '')),
    `§6 ${forbidden} never appears in executable SQL — distance from a boundary is diagnostic, not membership`);
}

// ── §7. THE FIX 29 FIREWALL IS STRUCTURAL ─────────────────────────────────────────────
// A ZIP with no usable boundary returns untouched BEFORE anything is counted or rebuilt.
const trig = sql.slice(sql.indexOf('dev_reports_enforce_dc_zip_membership'));
const firewall = trig.indexOf('if v_geom is null then');
const rebuild = trig.indexOf('jsonb_array_elements(new.sites)');
ok(firewall > 0 && rebuild > 0 && firewall < rebuild,
  '§7a the no-boundary return precedes the sites rebuild — an untestable ZIP is never rewritten');
ok(/ST_GeometryType\(b\.geom\) in \('ST_Polygon', 'ST_MultiPolygon'\)/.test(sql)
   && /not ST_IsEmpty\(b\.geom\)/.test(sql),
  '§7b "usable" means a non-empty areal geometry, the same test app_zcta_boundary applies');
ok(/jsonb_typeof\(new\.sites\) is distinct from 'array'/.test(sql),
  '§7c a non-array payload is left alone, never coerced (dev_refresh_collect’s own fail-safe)');
ok(/greatest\(/.test(sql) && /v_c \? 'facilities'/.test(sql),
  '§7d counts follow membership, clamped at 0, and only for keys the report already carries');

console.log(fails ? `\n${fails} FAILING` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
