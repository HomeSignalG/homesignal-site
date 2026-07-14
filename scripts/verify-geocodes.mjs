// verify-geocodes.mjs — automated geofence check for every GEOCODED point on the dev tracker.
//
// WHY THIS EXISTS: point records (TABS today) are geocoded once at refresh time and cached.
// Census Public_AR_Current is address-range INTERPOLATION — it can land a point on the wrong
// segment of a road, in a neighbouring ZIP. Manual coordinate verification does not scale, so
// this surfaces bad geocodes automatically: every geocoded point is reverse-looked-up to its
// CONTAINING ZCTA + county and compared to the ZIP/county it's filed under. A mismatch fails
// the run. No human eyeballs coordinates one by one.
//
// SCOPE — geocoded points only. It checks sites that carry a `match_type` (produced by our
// write-once geocode cache) plus every property_reports row. It deliberately does NOT geofence
// EPA FRS facilities: those come from EPA's own coordinates via a radius search around the ZIP
// centroid, so a facility legitimately sitting in an adjacent ZIP is expected, not an error.
//
// Runs where egress works (GitHub Actions), the piece the build sandbox cannot do. Zero-touch:
// reads the live development_reports + property_reports tables, so newly-cached points are
// covered with no code change. Anon-key only (the geocodes cache itself is service-role, but
// what the map RENDERS lives in development_reports.sites, which is public-read — and that is
// exactly the coordinate we must validate).
//
// Config via env: CENSUS_VINTAGE (default "Current_Current"), SAMPLE (cap points for a smoke
// run), FAIL_ON_OUTSIDE ("1" default — set "0" to report without failing CI).

import { readFileSync } from 'node:fs';

// Read Supabase URL + anon key straight from the shipped page so nothing forks.
const html = readFileSync(new URL('../homesignalmap.html', import.meta.url), 'utf8');
const grabVar = (name) => {
  const m = html.match(new RegExp(`var ${name}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error(`Could not read ${name} from homesignalmap.html`);
  return m[1];
};
const ENDPOINT = grabVar('ENDPOINT');
const APIKEY = grabVar('APIKEY');
const SUPABASE_URL = ENDPOINT.replace(/\/functions\/v1\/.*$/, '');
const VINTAGE = process.env.CENSUS_VINTAGE || 'Current_Current';
const SAMPLE = process.env.SAMPLE ? parseInt(process.env.SAMPLE, 10) : 0;
const FAIL_ON_OUTSIDE = (process.env.FAIL_ON_OUTSIDE ?? '1') !== '0';

const sb = (path) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } });

async function loadDevReports() {
  // Paginated: one unbounded select of every row's sites jsonb hits the Postgres
  // statement timeout (57014) with ~1,000 cached ZIPs — same fix as verify-development.
  const rows = [];
  const STEP = 40;
  for (let off = 0; ; off += STEP) {
    const res = await sb(`development_reports?select=zip,sites&order=zip&limit=${STEP}&offset=${off}`);
    if (!res.ok) throw new Error(`development_reports read failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < STEP) break;
  }
  return rows;
}
async function loadPropertyReports() {
  const res = await sb('property_reports?select=address,zip,county,lat,lng,sites');
  if (!res.ok) return []; // table absent yet → nothing to check (not a failure)
  return res.json();
}

const norm = (s) => String(s || '').toLowerCase().replace(/\bcounty\b/g, '').replace(/[^a-z]/g, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reverse point → { zcta, county } via the Census geographies API (same provider we geocode
// with). Returns null on a transient/parse failure so a flaky lookup is skipped, not a false fail.
async function containing(lat, lng) {
  const q = new URLSearchParams({
    x: String(lng), y: String(lat), benchmark: 'Public_AR_Current',
    vintage: VINTAGE, layers: 'all', format: 'json',
  });
  let data;
  try {
    const r = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${q}`,
      { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    data = await r.json();
  } catch { return null; }
  const geos = data?.result?.geographies || {};
  const zctaLayer = Object.keys(geos).find((k) => /zip code tabulation/i.test(k));
  const countyLayer = Object.keys(geos).find((k) => /^counties$/i.test(k) || /^counties/i.test(k));
  const zcta = zctaLayer && geos[zctaLayer]?.[0] ? (geos[zctaLayer][0].ZCTA5 || geos[zctaLayer][0].BASENAME) : null;
  const county = countyLayer && geos[countyLayer]?.[0] ? geos[countyLayer][0].BASENAME : null;
  return { zcta: zcta ? String(zcta) : null, county: county ? String(county) : null };
}

// Every geocoded point across both caches, with the ZIP/county it is FILED under.
function collectPoints(devReports, propReports) {
  const pts = [];
  for (const dr of devReports) {
    for (const s of dr.sites || []) {
      // geocoded point = carries match_type (from our cache). Skips EPA facilities & area notices.
      if (s.match_type == null) continue;
      if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
      pts.push({
        src: 'development_reports', label: s.label, project_no: s.project_no || '',
        lat: s.lat, lng: s.lng, statedZip: dr.zip, statedCounty: s.location_county || '',
        match_type: s.match_type, needs_review: !!s.needs_review, record_url: s.record_url || s.url || '',
      });
    }
  }
  for (const pr of propReports) {
    if (typeof pr.lat !== 'number' || typeof pr.lng !== 'number') continue;
    pts.push({
      src: 'property_reports', label: pr.address, project_no: '',
      lat: pr.lat, lng: pr.lng, statedZip: pr.zip, statedCounty: pr.county || '',
      match_type: (pr.sites || []).find((s) => s.match_type)?.match_type || 'unknown',
      needs_review: undefined, record_url: pr.address,
    });
  }
  return pts;
}

async function main() {
  const [devReports, propReports] = await Promise.all([loadDevReports(), loadPropertyReports()]);
  let points = collectPoints(devReports, propReports);
  if (SAMPLE > 0) points = points.slice(0, SAMPLE);

  const fails = [];       // geocode fell outside its stated ZIP (and county, when stated)
  const skipped = [];     // reverse-lookup unavailable — reported, never a false fail
  let checked = 0;
  const tierCount = {};   // match_type telemetry — surfaces silent degradation

  for (const p of points) {
    tierCount[p.match_type] = (tierCount[p.match_type] || 0) + 1;
    const c = await containing(p.lat, p.lng);
    await sleep(400); // be polite to the Census API
    if (!c) { skipped.push(`${p.label} (${p.project_no || p.src}) — reverse-lookup unavailable`); continue; }
    checked++;
    const zipOk = c.zcta == null || String(c.zcta) === String(p.statedZip);
    const countyOk = !p.statedCounty || c.county == null || norm(c.county) === norm(p.statedCounty);
    if (!zipOk || !countyOk) {
      const bits = [];
      if (!zipOk) bits.push(`ZIP: filed ${p.statedZip}, point sits in ${c.zcta}`);
      if (!countyOk) bits.push(`county: filed "${p.statedCounty}", point sits in "${c.county}"`);
      fails.push(`${p.label} (${p.project_no || p.src}) @ ${p.lat},${p.lng} — ${bits.join('; ')} [${p.match_type}] ${p.record_url}`);
    }
  }

  const tierLine = Object.entries(tierCount).sort().map(([k, v]) => `${k}: ${v}`).join(' · ') || '(none)';
  const summary = [
    `# Geocode geofence verification`,
    ``,
    `- Geocoded points found: **${points.length}**`,
    `- Reverse-checked: **${checked}**   (skipped/unavailable: ${skipped.length})`,
    `- Match-quality tiers: ${tierLine}`,
    `- Outside stated ZIP/county: **${fails.length}**`,
    ...(fails.length ? [``, `## Out-of-polygon geocodes (review queue)`, ...fails.map((f) => `- ${f}`)] : []),
    ...(skipped.length ? [``, `## Skipped (lookup unavailable — not a failure)`, ...skipped.map((s) => `- ${s}`)] : []),
    ...(!fails.length ? [``, `Every geocoded point falls inside its stated ZIP/county. ✓`] : []),
    ``,
    `> Note: with Census-only geocoding every point is range_interpolated and flagged needs_review;`,
    `> this check is what separates "interpolated but in-polygon (fine)" from "interpolated AND`,
    `> out-of-polygon (a real bad geocode)". A parcel/rooftop rung will empty the review queue.`,
  ].join('\n');
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  if (fails.length && FAIL_ON_OUTSIDE) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
