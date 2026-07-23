// verify-geocodes.mjs — automated geofence check for every GEOCODED point on the dev tracker.
//
// WHY THIS EXISTS: point records are geocoded once at refresh time and cached. Census
// Public_AR_Current is address-range INTERPOLATION — it can land a point on the wrong segment
// of a road, in a neighbouring ZIP, or (the bug this guards) in the wrong county/state. Manual
// coordinate verification does not scale, so this surfaces bad geocodes automatically.
//
// WHAT COUNTS AS "WRONG" (the 2026-07-23 correction): a development is judged against the
// record's OWN address, not the ZIP PAGE it happens to render on. Several connectors use
// `spatial_zip_radius_mi` scoping, so a correctly-geocoded permit in ZIP A legitimately appears
// on neighbouring ZIP B's page (B's radius reaches A). Comparing the point's ZCTA to the PAGE
// zip (development_reports.zip) false-failed every such record. The verifier now derives the
// record's own ZIP (from its address / matched_address, which the engine already fenced to the
// filed ZIP) and fails a point only when it is proven wrong FOR ITS OWN ADDRESS — wrong state,
// wrong county (when county evidence exists), or the geocoder matched a different ZIP than the
// record's own address. USPS-ZIP-vs-Census-ZCTA boundary disagreement stays a review-only
// borderline. The rule is derived from record semantics, not any named connector.
//
// SCOPE — geocoded points only. It checks sites that carry a `match_type` (produced by our
// write-once geocode cache) plus every property_reports row. It deliberately does NOT geofence
// EPA FRS facilities: those come from EPA's own coordinates via a radius search around the ZIP
// centroid, so a facility legitimately sitting in an adjacent ZIP is expected, not an error.
//
// Runs where egress works (GitHub Actions). Zero-touch: reads the live development_reports +
// property_reports tables, so newly-cached points are covered with no code change. Anon-key only.
//
// Config via env: CENSUS_VINTAGE (default "Current_Current"), SAMPLE (cap points for a smoke
// run), FAIL_ON_OUTSIDE ("1" default — set "0" to report without failing CI).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VINTAGE = process.env.CENSUS_VINTAGE || 'Current_Current';
const SAMPLE = process.env.SAMPLE ? parseInt(process.env.SAMPLE, 10) : 0;
const FAIL_ON_OUTSIDE = (process.env.FAIL_ON_OUTSIDE ?? '1') !== '0';
const BATCH = 50; // lines per console write — avoids GitHub truncating one oversized write

// ───────────────────────────── pure helpers (exported for tests) ─────────────────────────────

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

/** Trailing 5-digit ZIP of a string (the ZIP always sits at the end of an address). */
export function zipOf(s) {
  const m = String(s || '').match(/(\d{5})(?:-\d{4})?\s*$/);
  return m ? m[1] : null;
}
/** 2-letter USPS state token immediately before the trailing ZIP (e.g. "…, WA 98665" → "WA"). */
export function stateOf(s) {
  const m = String(s || '').match(/\b([A-Za-z]{2})\b[ ,]+\d{5}(?:-\d{4})?\s*$/);
  if (!m) return null;
  const st = m[1].toUpperCase();
  return US_STATES.has(st) ? st : null;
}
/** County name → comparable token (drops the word "county", punctuation, case). */
export function normCounty(s) {
  return String(s || '').toLowerCase().replace(/\bcounty\b/g, '').replace(/[^a-z]/g, '').trim();
}

/**
 * Classify one geocoded point against its OWN address (pure — no I/O, unit-tested offline).
 *
 * p: { id, src, label, page_zip, matched_address, address, statedCounty, match_type,
 *      record_url, lat, lng, isRadiusScoped }
 * reverse: { zcta, county, state } | null   (null ⇒ reverse-lookup unavailable → skip)
 *
 * Returns { verdict:'pass'|'fail'|'borderline'|'skip', category, reason, ...derived }.
 */
export function classifyPoint(p, reverse) {
  const page_zip = p.page_zip != null ? String(p.page_zip) : null;
  const matched_zip = zipOf(p.matched_address);
  const own_address_zip = zipOf(p.address);                 // the source's own stated ZIP (may be null)
  const own_state = stateOf(p.matched_address) || stateOf(p.address);
  const own_zip = own_address_zip || matched_zip || page_zip; // the record's OWN ZIP (not the page)
  const reverse_zcta = reverse && reverse.zcta != null ? String(reverse.zcta) : null;
  const reverse_state = reverse && reverse.state ? String(reverse.state).toUpperCase() : null;
  const reverse_county = reverse && reverse.county != null ? String(reverse.county) : null;
  const neighbor_page = !!(own_zip && page_zip && own_zip !== page_zip);
  const base = {
    id: p.id, src: p.src, label: p.label, lat: p.lat, lng: p.lng, match_type: p.match_type,
    record_url: p.record_url, page_zip, matched_zip, own_address_zip, own_zip, own_state,
    reverse_zcta, reverse_state, reverse_county, isRadiusScoped: !!p.isRadiusScoped, neighbor_page,
  };

  if (!reverse) return { ...base, verdict: 'skip', category: 'reverse_unavailable', reason: 'reverse-lookup unavailable' };

  // FAIL 1 — the geocoder matched a DIFFERENT ZIP than the record's own stated address.
  if (own_address_zip && matched_zip && own_address_zip !== matched_zip)
    return { ...base, verdict: 'fail', category: 'matched_zip_disagrees_own_address',
      reason: `geocoder matched ZIP ${matched_zip} but the record's own address states ZIP ${own_address_zip}` };

  // FAIL 2 — point reverse-geocodes to a STATE inconsistent with the record's own address.
  if (reverse_state && own_state && reverse_state !== own_state)
    return { ...base, verdict: 'fail', category: 'wrong_state',
      reason: `point is in state ${reverse_state}, record's address is in ${own_state}` };

  // FAIL 3 — point reverse-geocodes to the WRONG COUNTY, when the record states a county.
  if (p.statedCounty && reverse_county && normCounty(reverse_county) !== normCounty(p.statedCounty))
    return { ...base, verdict: 'fail', category: 'wrong_county',
      reason: `point is in county "${reverse_county}", record filed "${p.statedCounty}"` };

  // PASS — the coordinate sits in the record's OWN ZIP. Correct, regardless of which page shows
  // it (this is the radius-scoped neighbouring-page case, and the ordinary same-page case).
  if (reverse_zcta == null || reverse_zcta === String(own_zip))
    return { ...base, verdict: 'pass', category: neighbor_page ? 'own_zip_neighbor_page' : 'own_zip',
      reason: neighbor_page ? `in its own ZIP ${own_zip} (radius-scoped onto page ${page_zip})` : `in its own ZIP ${own_zip}` };

  // BORDERLINE — reverse ZCTA differs from the record's OWN ZIP, but same state and the forward
  // geocoder agreed on the record's ZIP → USPS ZIP vs Census ZCTA boundary. Review-only, as
  // before; applies whether the record is on its own page or radius-scoped onto a neighbour.
  return { ...base, verdict: 'borderline', category: 'usps_vs_zcta',
    reason: `USPS ZIP ${own_zip} vs Census ZCTA ${reverse_zcta} (same state; forward geocoder agrees on the record's ZIP)` };
}

// ───────────────────────────── live-data helpers (I/O) ─────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getConfig() {
  const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
  const grab = (name) => {
    const m = html.match(new RegExp(`var ${name}\\s*=\\s*["']([^"']+)["']`));
    if (!m) throw new Error(`Could not read ${name} from homesignalmap.html`);
    return m[1];
  };
  const ENDPOINT = grab('ENDPOINT');
  const APIKEY = grab('APIKEY');
  const SUPABASE_URL = ENDPOINT.replace(/\/functions\/v1\/.*$/, '');
  return { SUPABASE_URL, APIKEY };
}

/** Connectors that use spatial_zip_radius_mi (records legitimately render on neighbouring ZIP
 *  pages). Read from the registry for DIAGNOSTICS only — the pass/fail decision is semantic. */
function loadRadiusConnectors() {
  try {
    const reg = JSON.parse(readFileSync(
      new URL('../supabase/functions/get-address-report/jurisdiction-registry.json', import.meta.url), 'utf8'));
    const set = new Set();
    for (const v of Object.values(reg)) {
      if (!Array.isArray(v)) continue;
      for (const e of v) {
        if (e && typeof e === 'object' && e.registry_id && e.spatial_zip_radius_mi != null) set.add(e.registry_id);
      }
    }
    return set;
  } catch { return new Set(); }
}

async function loadDevReports(sb) {
  // KEYSET-paginated with ADAPTIVE page size (page cost is dominated by row SIZE — a dense-metro
  // row can carry thousands of sites). zip=gt.<last> is O(1) per page on the zip index.
  const rows = [];
  let step = 40, last = '', clean = 0, floorRetries = 0;
  for (;;) {
    const res = await sb(`development_reports?select=zip,sites&order=zip.asc&limit=${step}` + (last ? `&zip=gt.${encodeURIComponent(last)}` : ''));
    if (!res.ok) {
      const body = await res.text();
      if (step > 1) { step = Math.max(1, Math.floor(step / 2)); clean = 0; continue; }
      floorRetries++;
      if (floorRetries > 3) throw new Error(`development_reports read failed at floor page size: ${res.status} ${body}`);
      await sleep(2500 * floorRetries);
      continue;
    }
    floorRetries = 0;
    const page = await res.json();
    rows.push(...page);
    if (page.length < step) break;
    last = page[page.length - 1].zip;
    if (++clean >= 3 && step < 40) { step = Math.min(40, step * 2); clean = 0; }
  }
  return rows;
}
async function loadPropertyReports(sb) {
  const res = await sb('property_reports?select=address,zip,county,lat,lng,sites');
  if (!res.ok) return [];
  return res.json();
}

/** Reverse point → { zcta, county, state } via the Census geographies API (same provider we
 *  geocode with). Returns null on a transient/parse failure so a flaky lookup is skipped. */
async function containing(lat, lng) {
  const q = new URLSearchParams({ x: String(lng), y: String(lat), benchmark: 'Public_AR_Current', vintage: VINTAGE, layers: 'all', format: 'json' });
  let data;
  try {
    const r = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${q}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    data = await r.json();
  } catch { return null; }
  const geos = (data && data.result && data.result.geographies) || {};
  const findLayer = (re) => Object.keys(geos).find((k) => re.test(k));
  const zctaKey = findLayer(/zip code tabulation/i);
  const countyKey = findLayer(/^counties$/i) || findLayer(/^counties/i);
  const stateKey = findLayer(/^states$/i) || Object.keys(geos).find((k) => /\bstates\b/i.test(k) && !/united/i.test(k));
  const zcta = zctaKey && geos[zctaKey][0] ? (geos[zctaKey][0].ZCTA5 || geos[zctaKey][0].BASENAME) : null;
  const county = countyKey && geos[countyKey][0] ? geos[countyKey][0].BASENAME : null;
  const state = stateKey && geos[stateKey][0] ? (geos[stateKey][0].STUSAB || geos[stateKey][0].BASENAME) : null;
  return { zcta: zcta ? String(zcta) : null, county: county ? String(county) : null, state: state ? String(state) : null };
}

/** Every geocoded point across both caches, with the identity + fields classifyPoint needs. */
export function collectPoints(devReports, propReports, radiusConnectors = new Set()) {
  const pts = [];
  for (const dr of devReports) {
    for (const s of dr.sites || []) {
      if (s.match_type == null) continue;                                  // geocoded points only (skips facilities/area)
      if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
      const connector = s.source_registry_id || null;
      pts.push({
        id: s.source_id || s.case_number || s.project_no || s.record_url || s.url || '(no id)',
        src: connector || 'development_reports', label: s.label,
        page_zip: dr.zip, matched_address: s.matched_address || '', address: s.address || '',
        statedCounty: s.location_county || '', match_type: s.match_type,
        record_url: s.record_url || s.url || '', lat: s.lat, lng: s.lng,
        isRadiusScoped: !!(connector && radiusConnectors.has(connector)),
      });
    }
  }
  for (const pr of propReports) {
    if (typeof pr.lat !== 'number' || typeof pr.lng !== 'number') continue;
    pts.push({
      id: pr.address, src: 'property_reports', label: pr.address,
      page_zip: pr.zip, matched_address: pr.address || '', address: pr.address || '',
      statedCounty: pr.county || '', match_type: (pr.sites || []).find((s) => s.match_type)?.match_type || 'unknown',
      record_url: pr.address, lat: pr.lat, lng: pr.lng, isRadiusScoped: false,
    });
  }
  return pts;
}

// ───────────────────────────── runner ─────────────────────────────

function emitBatched(lines, log) {
  for (let i = 0; i < lines.length; i += BATCH) log(lines.slice(i, i + BATCH).join('\n'));
}

async function main() {
  const { SUPABASE_URL, APIKEY } = getConfig();
  const sb = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } });
  const radiusConnectors = loadRadiusConnectors();

  const [devReports, propReports] = await Promise.all([loadDevReports(sb), loadPropertyReports(sb)]);
  let points = collectPoints(devReports, propReports, radiusConnectors);
  if (SAMPLE > 0) points = points.slice(0, SAMPLE);

  const fails = [], borderline = [], skipped = [], exemptions = [];
  const failByCategory = {}, srcByCategory = {};
  let checked = 0, passed = 0;
  const tierCount = {};

  const fmt = (r) => `${r.label} [${r.id}] (${r.src}) @ ${r.lat},${r.lng} — ${r.reason} [${r.match_type}] ${r.record_url}`;
  const skipFmt = (r) => `[SKIP] id=${r.id} src=${r.src} page=${r.page_zip} matched=${r.matched_zip} own=${r.own_zip} @ ${r.lat},${r.lng} — ${r.reason}`;

  for (const p of points) {
    tierCount[p.match_type] = (tierCount[p.match_type] || 0) + 1;
    const reverse = await containing(p.lat, p.lng);
    await sleep(400); // be polite to the Census API
    const r = classifyPoint(p, reverse);
    if (r.verdict === 'skip') { skipped.push(r); continue; }
    checked++;
    if (r.verdict === 'pass') { passed++; if (r.neighbor_page) exemptions.push(r); continue; }
    if (r.verdict === 'borderline') { borderline.push(r); continue; }
    fails.push(r);
    failByCategory[r.category] = (failByCategory[r.category] || 0) + 1;
    (srcByCategory[r.category] = srcByCategory[r.category] || new Set()).add(r.src);
  }

  const tierLine = Object.entries(tierCount).sort().map(([k, v]) => `${k}: ${v}`).join(' · ') || '(none)';
  const catLine = Object.keys(failByCategory).length
    ? Object.entries(failByCategory).sort().map(([k, v]) => `${k}: ${v} {${[...(srcByCategory[k] || [])].sort().join(', ')}}`).join(' · ')
    : '(none)';
  const exemptSrc = [...new Set(exemptions.map((e) => e.src))].sort();

  const header = [
    `# Geocode geofence verification`,
    ``,
    `- Geocoded points found: **${points.length}**`,
    `- Reverse-checked: **${checked}**   (skipped/unavailable: ${skipped.length})`,
    `- Passed: **${passed}**   (radius-scoped neighbouring-page exemptions: ${exemptions.length} — sources: ${exemptSrc.join(', ') || 'none'})`,
    `- Match-quality tiers: ${tierLine}`,
    `- Outside own ZIP/county (FAIL): **${fails.length}**   by category: ${catLine}`,
    `- Borderline USPS-vs-ZCTA (review only): **${borderline.length}**`,
  ];
  console.log('\n' + header.join('\n'));
  if (fails.length) { console.log(`\n## Out-of-polygon geocodes — FAIL (wrong for the record's own address)`); emitBatched(fails.map((f) => `- ${fmt(f)}`), console.log); }
  if (borderline.length) { console.log(`\n## Borderline — USPS ZIP vs Census ZCTA boundary (forward geocoder agrees on the record's own ZIP; review, not a failure)`); emitBatched(borderline.map((b) => `- ${fmt(b)}`), console.log); }
  if (skipped.length) { console.log(`\n## Skipped — reverse-lookup unavailable (not a failure)`); emitBatched(skipped.map((s) => `- ${skipFmt(s)}`), console.log); }
  if (!fails.length) console.log(`\nEvery geocoded point falls inside its OWN address's ZIP/county (radius-scoped records checked against their own ZIP, not the page). ✓`);
  console.log(`\n> Note: a development is judged against its OWN address, not the ZIP page it renders on.`);
  console.log(`> Radius-scoped connectors (spatial_zip_radius_mi) legitimately show a record on a neighbouring`);
  console.log(`> ZIP page; that alone is never a failure. Only a coordinate proven wrong for the record's own`);
  console.log(`> address (wrong state, wrong county, or matched to a different ZIP) fails. A parcel/rooftop rung`);
  console.log(`> would empty the USPS-vs-ZCTA review queue.`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    const all = [...header, ``,
      ...(fails.length ? [`## Out-of-polygon geocodes — FAIL`, ...fails.map((f) => `- ${fmt(f)}`)] : []),
      ...(borderline.length ? [``, `## Borderline — USPS ZIP vs Census ZCTA`, ...borderline.map((b) => `- ${fmt(b)}`)] : []),
      ...(skipped.length ? [``, `## Skipped — reverse-lookup unavailable`, ...skipped.map((s) => `- ${skipFmt(s)}`)] : []),
    ];
    for (let i = 0; i < all.length; i += 200) appendFileSync(process.env.GITHUB_STEP_SUMMARY, all.slice(i, i + 200).join('\n') + '\n');
  }

  if (fails.length && FAIL_ON_OUTSIDE) process.exit(1);
}

// Only run the live check when executed directly; importing the module (tests) has no side effects.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
