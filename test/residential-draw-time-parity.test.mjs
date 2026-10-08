// RESIDENTIAL — THE DRAW-TIME CHECK JUDGES WHAT THE BUILDER JUDGED (2026-09-27).
//
// THE DEFECT. Map 1 checks Residential qualification twice: once where a site is BUILT
// (lib/zip-authoritative.js zipAuthSiteFromMarker, lib/n5-radius.js n5SiteFromRow, both with
// the full app_projects row) and again at DRAW time in render() (HS.residentialQualifySites).
// The draw-time check re-read the evidence off the site as `type_raw`. Neither builder puts
// the class field there: ZIP mode carries it as `permit_class` (data-centre significance
// only), address mode not at all. So every Residential record that qualified on its class
// field was built, typed Residential, and removed at draw time as UNRESOLVED.
//
// THE FIX. The builder records the evidence it judged on the site (`residential_evidence`,
// through ONE shared call, HS.residentialGateAtConstruction) and the draw-time adapter
// returns it. Same rule, same object, same verdict.
//
// Every case below drives the SHIPPED builders and the SHIPPED draw-time gate. A test that
// only built sites carrying `type_raw` could not fail on this defect - that is how the
// existing Residential suites stayed green while it shipped.
//
// Run: node test/residential-draw-time-parity.test.mjs
import fs from 'node:fs';
let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra != null && !c ? '  [' + extra + ']' : ''));
  if (!c) fails++;
};

global.window = { HS: {} };
await import('../lib/project-type.js');
await import('../lib/map.js');
await import('../lib/residential-qualify.js');
await import('../lib/n5-radius.js');
await import('../lib/zip-authoritative.js');
const HS = global.window.HS;
const V = HS.RESIDENTIAL_VOCABULARY;

const SLICES = ['proposed', 'approved', 'operating', 'unknown'];
const STATUS_FOR = { proposed: 'Proposed', approved: 'Approved', operating: 'Operating', unknown: 'On file' };
const isRes = (s) => { try { return HS.resolveTrackerMarker(s).typeKey === 'residential'; } catch (e) { return false; } };
const sliceOf = (s) => { try { return HS.resolveTrackerMarker(s, () => '').lifecycle || 'unknown'; } catch (e) { return 'unknown'; } };
const drawn = (sites) => HS.residentialQualifySites(sites);
const stripEvidence = (s) => { const c = Object.assign({}, s); delete c.residential_evidence; return c; };

let refN = 0;
function project(o) {
  refN++;
  return Object.assign({
    project_ref: 'ref-' + refN, source_ref: 'https://example.gov/r/' + refN,
    type: 'Residential', status: 'Approved', registry_id: 'x', lat: 30.1, lng: -97.6
  }, o);
}
function zipPayload(projects) {
  return {
    status: 'boundary_complete', projects: projects,
    markers: projects.map((p) => ({ project_ref: p.project_ref, lat: 30.1, lng: -97.6 }))
  };
}
const n5Sites = (projects) => HS.n5SitesFrom(
  projects.map((p) => ({ source_key: p.project_ref, feature_id: 'f', marker_lat: 30.1, marker_lng: -97.6, distance_mi: 0.5 })),
  projects.map((p) => Object.assign({ source_key: p.project_ref }, p)),
  { lat: 30.1, lng: -97.6 });

// ── 1. THE REPORTED SHAPE: evidence in the class field only ────────────────────────────────
// One real-shaped record per evidence path the ladder can take through `type_raw`, in every
// lifecycle slice. `name` is an address, so the class field is the ONLY evidence.
const CLASS_ONLY = [
  { registry_id: 'denton-county-dev-permits', type_raw: 'HOUSE', name: '1234 OAK ST' },            // FAMILY_TYPE_RAW
  { registry_id: 'dekalb-county-building-permits', type_raw: 'New Homes', name: '55 ELM DR' },      // FAMILY_TYPE_RAW
  { registry_id: 'miami-building-permits', type_raw: 'New Construction', name: '2 NW 5 AVE' },      // DEV_PHRASE in type_raw
  { registry_id: 'x', type_raw: 'NEW SFR', name: '9 PINE CT' },                                     // DEV_HEAD in type_raw
  { registry_id: 'x', type_raw: 'Preliminary Plat', name: '44 CEDAR LN' },                          // DEV_ANYWHERE in type_raw
];
const classOnly = [];
for (const k of SLICES) for (const c of CLASS_ONLY) classOnly.push(project(Object.assign({ status: STATUS_FOR[k] }, c)));
for (const p of classOnly) {
  ok(HS.residentialActivity(p).verdict === 'DEVELOPMENT',
    '1a canonical verdict on the full row is DEVELOPMENT: ' + p.registry_id + ' / ' + p.type_raw + ' / ' + p.status,
    HS.residentialActivity(p).rule);
}
const zipBuilt = HS.zipAuthSitesFrom(zipPayload(classOnly));
const zipRes = zipBuilt.filter(isRes);
ok(zipRes.length === classOnly.length, '1b ZIP mode builds every class-qualified record as Residential', zipRes.length);
ok(drawn(zipBuilt).filter(isRes).length === zipRes.length,
  '1c ZIP mode: the draw-time check keeps every site the builder qualified', drawn(zipBuilt).filter(isRes).length);
// POSITIVE CONTROL — the same sites without the recorded evidence reproduce the defect, so
// 1c passing is the fix and not a corpus that never exercised it.
ok(drawn(zipBuilt.map(stripEvidence)).filter(isRes).length === 0,
  '1d CONTROL: without the recorded evidence the old draw-time read drops all ' + zipRes.length);
const n5Built = n5Sites(classOnly);
const n5Res = n5Built.filter(isRes);
ok(n5Res.length === classOnly.length, '1e address mode builds every class-qualified record as Residential', n5Res.length);
ok(drawn(n5Built).filter(isRes).length === n5Res.length,
  '1f address mode: the draw-time check keeps every site the builder qualified');
ok(drawn(n5Built.map(stripEvidence)).filter(isRes).length === 0,
  '1g CONTROL: address mode had the same defect');

// ── 2. THE ACCEPTANCE GATE, per lifecycle slice ────────────────────────────────────────────
// assigned (builder output) = qualified (canonical verdict on the row) = drawn (draw-time).
function tally(sites) {
  const t = Object.fromEntries(SLICES.map((k) => [k, 0]));
  sites.forEach((s) => { t[sliceOf(s)]++; });
  return t;
}
const assigned = tally(zipRes);
const qualified = tally(zipRes.filter((s) => HS.residentialActivity(classOnly.find((p) => p.project_ref === s.zip_project_ref)).verdict === 'DEVELOPMENT'));
const drawnT = tally(drawn(zipBuilt).filter(isRes));
for (const k of SLICES) {
  ok(assigned[k] === CLASS_ONLY.length && assigned[k] === qualified[k] && qualified[k] === drawnT[k],
    '2 ' + k + ': assigned ' + assigned[k] + ' = qualified ' + qualified[k] + ' = drawn ' + drawnT[k]);
}

// ── 3. PROPERTY over a corpus generated from the rule's own vocabulary ─────────────────────
// Every phrase the ladder knows, placed in `type_raw` and in `name`, across ordinary, label,
// provenance and family-rule registries and every lifecycle slice. For every record:
//   built as Residential  =>  drawn, and its draw-time verdict equals the verdict on the row.
//   not built             =>  the row's verdict is not DEVELOPMENT (the builder is the gate).
const REGISTRIES = ['x', 'miami-building-permits', 'seattle-land-use-permits',
  Object.keys(V.name_kind_label)[0], Object.keys(V.dev_provenance)[0], Object.keys(V.family_rules)[0]];
const PHRASES = [].concat(V.dev_anywhere, V.dev_phrase_anywhere, V.dev_head, V.routine_anywhere,
  V.routine_object, V.dev_head_weak.map((w) => w + ' single family'))
  .map((p) => p.trim()).filter(Boolean);
const corpus = [];
for (const rid of REGISTRIES) {
  for (const ph of PHRASES) {
    const k = SLICES[corpus.length % SLICES.length];
    corpus.push(project({ registry_id: rid, type_raw: ph, name: '10 MAIN ST', status: STATUS_FOR[k] }));
    corpus.push(project({ registry_id: rid, type_raw: 'Residential', name: ph, status: STATUS_FOR[k] }));
  }
  for (const fam of Object.values(V.family_rules)) {
    for (const tr of fam.dev_type_raw) corpus.push(project({ registry_id: rid, type_raw: tr, name: '12 MAIN ST' }));
  }
}
let builtRes = 0, drawnRes = 0, verdictMismatch = 0, builtNotDev = 0, devNotBuilt = 0, oldDrops = 0;
for (const builder of ['zip', 'n5']) {
  const sites = builder === 'zip' ? HS.zipAuthSitesFrom(zipPayload(corpus)) : n5Sites(corpus);
  const byRef = Object.create(null);
  sites.forEach((s) => { byRef[s.zip_project_ref || s.n5_source_key] = s; });
  const keep = new Set(drawn(sites));
  const keepOld = new Set(drawn(sites.map(stripEvidence)).map((s) => s.zip_project_ref || s.n5_source_key));
  for (const p of corpus) {
    const s = byRef[p.project_ref];
    const verdict = HS.residentialActivity(p).verdict;
    if (!s) {
      // Not built: only a Residential-typed record the rule does not qualify may be absent.
      if (verdict === 'DEVELOPMENT') devNotBuilt++;
      continue;
    }
    if (!isRes(s)) continue;
    builtRes++;
    if (verdict !== 'DEVELOPMENT') builtNotDev++;
    if (keep.has(s)) drawnRes++;
    if (HS.residentialActivity(HS.residentialEvidenceFromSite(s)).verdict !== verdict) verdictMismatch++;
    if (!keepOld.has(p.project_ref)) oldDrops++;
  }
}
ok(builtRes > 200, '3a the corpus reaches the Residential population (control): ' + builtRes + ' built sites');
ok(drawnRes === builtRes, '3b every Residential site the builders emit is drawn', drawnRes + ' of ' + builtRes);
ok(verdictMismatch === 0, '3c the draw-time verdict equals the verdict on the row for every built site', verdictMismatch);
ok(builtNotDev === 0, '3d the builders emit no Residential site the rule does not qualify', builtNotDev);
ok(devNotBuilt === 0, '3e every record the rule qualifies is built', devNotBuilt);
ok(oldDrops > 0, '3f CONTROL: the pre-fix draw-time read drops ' + oldDrops + ' of these sites');

// ── 4. THE EVIDENCE PROJECTION IS EXACTLY WHAT THE RULE READS ──────────────────────────────
// Record every property HS.residentialActivity reads, over the whole corpus. If the rule ever
// starts reading a field the projection does not carry, the draw-time check would judge less
// than the builder did - the same defect by a different road.
const read = new Set();
for (const p of corpus) {
  HS.residentialActivity(new Proxy(p, { get(t, k) { if (typeof k === 'string') read.add(k); return t[k]; } }));
}
const projKeys = Object.keys(HS.residentialEvidenceFromProject(corpus[0])).sort();
ok(JSON.stringify(projKeys) === JSON.stringify(['name', 'registry_id', 'type_raw']),
  '4a the projection carries type_raw, name, registry_id', projKeys.join(','));
ok([...read].every((k) => projKeys.indexOf(k) !== -1),
  '4b the rule reads nothing the projection does not carry: read {' + [...read].sort().join(', ') + '}');
ok(read.has('type_raw') && read.has('name') && read.has('registry_id'), '4c ...and it does read all three (control)');
let projMismatch = 0;
for (const p of corpus) {
  const a = HS.residentialActivity(p), b = HS.residentialActivity(HS.residentialEvidenceFromProject(p));
  if (a.verdict !== b.verdict || a.rule !== b.rule) projMismatch++;
}
ok(projMismatch === 0, '4d the verdict and rule on the projection equal those on the full row, for all ' + corpus.length);
ok(HS.residentialActivity(HS.residentialEvidenceFromProject(null)).verdict === 'UNRESOLVED'
   && HS.residentialActivity(HS.residentialEvidenceFromProject({})).verdict === 'UNRESOLVED',
  '4e a missing row projects to no evidence, never to development');

// ── 5. WHAT DID NOT CHANGE ──────────────────────────────────────────────────────────────────
const s5 = HS.zipAuthSiteFromMarker({ lat: 30, lng: -97, project_ref: 'p5' },
  project({ project_ref: 'p5', type: 'Data center', type_raw: 'SIGN  PERMIT', name: 'DC sign' }));
ok(s5 && s5.permit_class === 'SIGN  PERMIT', '5a ZIP mode still carries the class as permit_class (data-centre significance)');
ok(s5 && !Object.prototype.hasOwnProperty.call(s5, 'type_raw'),
  '5b no site gains a top-level type_raw key, so the frozen data-centre classifier sees nothing new');
ok(s5 && Object.isFrozen(s5.residential_evidence), '5c the recorded evidence is frozen');
const n5a = n5Sites([project({ type_raw: 'HOUSE', registry_id: 'denton-county-dev-permits' })])[0];
ok(n5a && !Object.prototype.hasOwnProperty.call(n5a, 'type_raw') && !Object.prototype.hasOwnProperty.call(n5a, 'permit_class'),
  '5d address mode gains neither type_raw nor permit_class');
// Routine work is still removed at construction, so recording evidence cannot admit it.
const deck = project({ type_raw: 'Deck', name: '3 ELM', registry_id: 'overland-park-building-permits' });
ok(HS.zipAuthSitesFrom(zipPayload([deck])).length === 0 && n5Sites([deck]).length === 0,
  '5e a routine Residential record is still dropped by both builders');
// The draw-time check still EVALUATES a recorded evidence object; it does not trust a flag.
const forged = Object.assign({}, zipBuilt.filter(isRes)[0], {
  residential_evidence: Object.freeze({ type_raw: 'Deck', name: '3 ELM', registry_id: 'x' }) });
ok(drawn([forged]).length === 0, '5f routine evidence on a site is still removed at draw time (the check runs, it is not skipped)');
// Shape 3 — a cached report site carries no builder evidence and is judged on its own fields.
const opDeck = { scope: 'area', relevance: 'development', label: 'Building (Residential) 10925 GILLETTE ST',
  title: 'Building (Residential) 10925 GILLETTE ST', type_raw: 'Deck', use_type: 'Residential',
  source_registry_id: 'overland-park-building-permits', record_url: 'https://example.gov/r/1' };
const naper = { scope: 'area', relevance: 'development', label: 'RESIDENTIAL Single Family New Construction - Lot 168',
  title: 'RESIDENTIAL Single Family New Construction - Lot 168', type_raw: 'RESIDENTIAL', use_type: 'Residential',
  source_registry_id: 'naperville-building-permits', record_url: 'https://example.gov/r/2' };
ok(drawn([opDeck]).length === 0 && drawn([naper]).length === 1,
  '5g a cached report site is still judged on its own type_raw/title (deck removed, Naperville kept)');
// Other Types are never touched by the draw-time check.
const others = HS.zipAuthSitesFrom(zipPayload([
  project({ type: 'Commercial', type_raw: 'Commercial', name: 'Shop' }),
  project({ type: 'Industrial', type_raw: 'Industrial', name: 'Plant' })]));
ok(others.length === 2 && drawn(others).length === 2, '5h non-Residential sites pass the draw-time check untouched');

// ── 6. STRUCTURE: one call site per builder, and the census measures the draw-time half ────
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const zipSrc = strip(fs.readFileSync(new URL('../lib/zip-authoritative.js', import.meta.url), 'utf8'));
const n5Src = strip(fs.readFileSync(new URL('../lib/n5-radius.js', import.meta.url), 'utf8'));
ok(/HS\.residentialGateAtConstruction\(site, project\)/.test(zipSrc), '6a ZIP mode judges through the shared construction call');
ok(/HS\.residentialGateAtConstruction\(site, p\)/.test(n5Src), '6b address mode judges through the shared construction call');
ok(!/HS\.residentialGateDrops\(/.test(zipSrc) && !/HS\.residentialGateDrops\(/.test(n5Src),
  '6c neither builder calls the gate directly, so neither can judge without recording');
const rqSrc = strip(fs.readFileSync(new URL('../lib/residential-qualify.js', import.meta.url), 'utf8'));
const adapter = rqSrc.slice(rqSrc.indexOf('HS.residentialEvidenceFromSite = function'),
  rqSrc.indexOf('HS.residentialSiteGateDrops = function'));
ok(adapter.length > 50 && /return site\.residential_evidence;/.test(adapter),
  '6d the draw-time adapter returns the recorded evidence (control: the slice is the adapter, ' + adapter.length + ' chars)');
const measure = fs.readFileSync(new URL('../scripts/residential-measure.mjs', import.meta.url), 'utf8');
ok(/HS\.residentialQualifySites\(after\)/.test(measure) && /RESIDENTIAL DRAW-TIME PARITY/.test(measure),
  '6e scripts/residential-measure.mjs measures the draw-time check, not only the builder');
const page = fs.readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
ok((page.match(/HS\.residentialQualifySites\(/g) || []).length === 2,
  '6f the page still routes both funnels through the draw-time check (render + property)');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
