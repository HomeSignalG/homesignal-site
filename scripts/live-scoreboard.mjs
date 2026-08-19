// live-scoreboard.mjs — which states are Live, and what is the ranked work to make more of them.
//
// METRIC (workbook Instructions row 272, verbatim):
//   "States where 90%+ of ZIPs have at least one development source with COMPLETE type_map AND
//    status_to_bucket. EPA-FRS is tracked but does NOT count toward Live."
// Row 264: type_map = pin ICON, status_to_bucket = pin COLOR.
//
// Emits TWO SEPARATE ranked lists, never merged:
//   1. WIRED_INCOMPLETE — additive registry work on an existing connector (inside the grant)
//   2. NOT_WIRED        — discovery/wire work, each row carrying its BLOCKERS
//
// Run:  node scripts/live-scoreboard.mjs [--json]
// Env:  SUPABASE_URL, SUPABASE_ANON_KEY (a runner has egress; the sandbox does not).
//       RESEARCH_ROWS — optional path to a JSON array of NOT_WIRED research rows.
//
// The registry is read from disk, so completeness is computable offline; only the ZIP-page
// denominator needs the DB.

import { readFileSync, existsSync } from 'node:fs';
import {
  scoreStates, rankRegistryWork, rankDiscoveryWork, rankUncoveredCounties,
  isFloorSource, LIVE_THRESHOLD,
} from './lib/live-scoreboard-core.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const REGISTRY = `${ROOT}/supabase/functions/get-address-report/jurisdiction-registry.json`;
// Credentials: env first, else the committed anon key in config.js -- the same path
// source-monitor.mjs uses. The anon key is public and RLS-gated, so this needs no secret
// plumbing and the scoreboard can ride the existing nightly run.
function fromConfigJs(name) {
  try {
    const cfg = readFileSync(`${ROOT}/config.js`, 'utf8');
    return (cfg.match(new RegExp(`${name}\\s*:\\s*'([^']+)'`)) || [])[1] || '';
  } catch { return ''; }
}
const SUPABASE_URL = (process.env.SUPABASE_URL || fromConfigJs('SUPABASE_URL') || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || fromConfigJs('SUPABASE_ANON_KEY') || '';
const AS_JSON = process.argv.includes('--json');

function flattenRegistry(path) {
  const reg = JSON.parse(readFileSync(path, 'utf8'));
  const out = [];
  for (const [family, v] of Object.entries(reg)) {
    if (family.startsWith('_') || !Array.isArray(v)) continue;
    for (const e of v) if (e && e.registry_id) out.push({ ...e, platform: e.platform || family });
  }
  return out;
}

// Keyset-paginated: PostgREST caps un-paginated reads at 1,000 rows, and a silent truncation
// here would understate every denominator (the documented verifier defect).
// Same one-constant rule as ZIP_SOURCE_PAGE below: the URL limit and the loop terminator are
// the SAME number by construction. Two literals that must agree is how a paged read silently
// truncates — lower one and the loop stops after page 1, reporting a partial set as complete.
const COMMUNITIES_PAGE = 1000;

async function fetchZipPages() {
  if (!SUPABASE_URL || !KEY) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const rows = [];
  let last = '';
  for (;;) {
    // ONE select, and it MUST include `id` — the keyset cursor. A second `select` param makes
    // PostgREST take the first, `id` comes back undefined, the cursor never advances and this
    // loop re-reads page 1 forever. That is not hypothetical: it burned a run before this guard.
    const url = `${SUPABASE_URL}/rest/v1/communities`
      + `?select=id,zip_codes,state,county&level=eq.zip&order=id.asc&limit=${COMMUNITIES_PAGE}`
      + (last ? `&id=gt.${encodeURIComponent(last)}` : '');
    const r = await fetch(url, { headers: hdr });
    if (!r.ok) throw new Error(`communities read failed: HTTP ${r.status}`);
    const page = await r.json();
    if (!page.length) break;
    const cursor = page[page.length - 1].id;
    if (cursor === undefined || cursor === null) {
      throw new Error('keyset cursor missing: `id` not returned — refusing to loop');
    }
    for (const c of page) {
      if (!c.state) continue;
      rows.push({ zip: (c.zip_codes || [])[0] || c.id, state: c.state, county: c.county || null });
    }
    last = cursor;
    if (page.length < COMMUNITIES_PAGE) break;
  }
  return rows;
}

/**
 * Per-ZIP PAGE record evidence, via the read-only `dev_zip_source_ids` RPC.
 *
 * LIVE MEANS PAGES (founder, 2026-07-31). The RPC's data is `app_projects` — the table pages
 * actually serve — NOT `development_reports`, which is the connector's cache. Those two
 * disagree for as long as it takes app_refresh_zip() to materialize, and reading the cache is
 * how Delaware got reported Live at 68/68 while its pages were still 46/68 with zero rows from
 * the new source. Wired + merged + emitting is not Live.
 *
 * Since 2026-08-19 the RPC reads `app_zip_source_ids`, a 9,374-row per-ZIP summary that
 * app_refresh_zip() maintains AT WRITE TIME, instead of grouping app_projects (3.08M rows /
 * 4.2 GB) on every call. Same rows, same order, same semantics — verified before the swap by
 * per-leading-digit md5 parity against the live GROUP BY, 0 mismatches across all 9,374 ZIPs.
 *
 * Keyset-paginated on `zip` — and that pagination is NOT boilerplate: a single un-paginated
 * call returned the first 5,000 ZIPs only, NV's 89xxx range sorted past the end, and every
 * NV page read as dark. The zero looked exactly like a real finding.
 */
// PAGE SIZE IS ONE CONSTANT, USED IN BOTH PLACES ON PURPOSE (2026-08-02).
//
// ⛔ THE HALVING LADDER IS GONE (2026-08-19, founder call: "it isn't a lever and only triples
// time to failure"). It was built for a timeout whose cause is now removed at the source. It
// never once succeeded on a retry: every run from 2026-08-15 through 2026-08-19 walked
// 250 → 125 → 50 and then threw anyway, because the statement was not marginally too big — it
// was aggregating the whole of app_projects, and a page a fifth the size still exceeded 3s.
// A ladder over a cost that is not dominated by page size only spends three timeouts instead of
// one, and it does it in the step that fails the job.
//
// Measured as anon after the summary-table swap: p_limit 250 → 1.6 ms · 1000 → 0.8 ms ·
// 5000 → 3.1 ms, against anon's `statement_timeout=3s` (pg_db_role_setting, confirmed live).
// Three orders of magnitude of headroom, and flat rather than linear in page size, because the
// read is now an index scan over 9,374 rows rather than a grouped scan over 3.08M.
//
// ⚠️ THIS MUST STAY STRICTLY BELOW THE RPC'S OWN `least(..., 5000)` CLAMP. The loop terminates
// on a short page, so if the request ever equalled or exceeded the clamp, a full page would
// come back SHORT and the walk would stop after one page — ranking on a fraction of the ZIPs
// with no error at all. That is the same silent-truncation class the pagination exists to
// prevent, just entered from the other side.
//
// The two uses MUST move together. Lowering only the request would leave the terminator at the
// old size, so the loop would break after the first page and the scoreboard would rank on a
// fraction of the ZIPs — a wrong answer that looks like a right one, which is worse than the
// timeout it replaced, because the timeout was loud.
const ZIP_SOURCE_PAGE = 1000;

async function fetchZipSourceIds() {
  const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const map = new Map();
  let after = '';
  for (;;) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dev_zip_source_ids`, {
      method: 'POST', headers: hdr,
      body: JSON.stringify({ p_after: after, p_limit: ZIP_SOURCE_PAGE }),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`dev_zip_source_ids failed: HTTP ${r.status} ${body}`);
    }
    const page = await r.json();
    if (!page.length) break;
    for (const row of page) map.set(String(row.zip), row.source_ids || []);
    const cursor = page[page.length - 1].zip;
    if (cursor === undefined || cursor === null) {
      throw new Error('keyset cursor missing: `zip` not returned — refusing to loop');
    }
    after = cursor;
    if (page.length < ZIP_SOURCE_PAGE) break;
  }
  return map;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;

(async () => {
  const entries = flattenRegistry(REGISTRY);
  const zips = await fetchZipPages();
  const srcByZip = await fetchZipSourceIds();
  for (const z of zips) z.source_ids = srcByZip.get(String(z.zip)) || [];

  // ASSERT THE INSTRUMENT RAN. A failed or truncated fetch makes every state read 0% — a
  // success-shaped output attesting to nothing, which is the defect this step was rebuilt to
  // stop reproducing. Refuse to report rather than publish a zero we cannot stand behind.
  const withRecords = zips.filter((z) => z.source_ids.length).length;
  if (!srcByZip.size) throw new Error('dev_zip_source_ids returned 0 rows — refusing to report a scoreboard of zeroes');
  if (!withRecords) throw new Error(`dev_zip_source_ids returned ${srcByZip.size} rows but matched 0 of ${zips.length} ZIP pages — join is broken, refusing to report`);
  console.log(`record evidence: ${srcByZip.size} cached ZIP reports read; ${withRecords} of ${zips.length} modelled ZIP pages carry >=1 sourced record`);

  const wiredIds = new Set(entries.map((e) => e.registry_id));

  let research = [];
  const rp = process.env.RESEARCH_ROWS;
  if (rp && existsSync(rp)) research = JSON.parse(readFileSync(rp, 'utf8'));

  const states = scoreStates(entries, zips);
  const registryWork = rankRegistryWork(entries, zips);
  const discovery = rankDiscoveryWork(research, zips, wiredIds);
  const counties = rankUncoveredCounties(entries, zips);
  const live = states.filter((s) => s.live);

  if (AS_JSON) {
    console.log(JSON.stringify({ threshold: LIVE_THRESHOLD, states, registryWork, discovery, counties }, null, 2));
    return;
  }

  console.log(`\nLIVE SCOREBOARD — 90%+ of a state's ZIP PAGES carrying a RECORD from an entry with BOTH maps complete`);
  console.log(`(page evidence read from app_projects AFTER deploy + materialize — never the development_reports cache)`);
  console.log(`(ranked on RECORDS LANDING, not the coverage gate — workbook rows 419/429; the gate is shown beside it)`);
  console.log(`(EPA-FRS tracked, never counted — ${entries.filter((e) => isFloorSource(e.registry_id)).length} floor entr(y/ies) excluded)\n`);
  console.log(`LIVE: ${live.length} of ${states.length} states — ${live.map((s) => s.state).join(', ') || '(none)'}\n`);

  console.log(`state  pages  records   record%   gate  gate%   gate-overstates  convertible  LIVE`);
  for (const s of states) {
    console.log(
      `${String(s.state).padEnd(6)} ${String(s.zip_pages).padStart(5)} ${String(s.covered_records).padStart(8)} `
      + `${pct(s.pct_records).padStart(8)} ${String(s.covered_gate).padStart(6)} ${pct(s.pct_gate).padStart(6)} `
      + `${String(s.gate_overstatement).padStart(16)} ${String(s.convertible_by_completion).padStart(12)}  ${s.live ? 'YES' : ''}`);
  }

  console.log(`\n--- LIST 1: WIRED + INCOMPLETE — additive registry work (${registryWork.length}) ---`);
  if (!registryWork.length) console.log('  (none — every wired entry has both maps)');
  for (const w of registryWork) {
    console.log(`  ${String(w.zip_pages_affected).padStart(5)} pages  ${w.registry_id}  [${w.platform}]  missing: ${w.missing.join(' + ')}`);
  }

  console.log(`\n--- LIST 2: NOT WIRED — discovery/wire work (${discovery.length}) ---`);
  if (!discovery.length) console.log('  (none supplied — set RESEARCH_ROWS to a JSON array)');
  for (const d of discovery) {
    console.log(`  ${String(d.zip_pages_potential).padStart(5)} pages  ${d.registry_id}  [${d.platform || '?'}]  `
      + (d.ready ? 'READY' : `BLOCKED: ${d.blockers.join('; ')}`));
  }
  console.log(`\n--- LIST 3: uncovered COUNTIES per state, cheapest state first (${counties.length}) ---`);
  for (const c of counties.slice(0, 14)) {
    console.log(`  ${String(c.state).padEnd(4)} ${String(c.covered_complete).padStart(4)}/${String(c.zip_pages).padEnd(5)} `
      + `${pct(c.pct_complete).padStart(6)}  need +${String(c.to_reach_90).padStart(3)} pages via ${c.counties_needed} count(y/ies): `
      + c.counties.slice(0, c.counties_needed || 1).map((x) => `${x.county}(${x.zip_pages})`).join(', '));
  }

  console.log('\nList 2 is never merged into List 1: a NOT_WIRED row is discovery, and "Needs Connector"');
  console.log('is a new connector family — a founder gate, not a quick win.\n');
})().catch((e) => { console.error(`live-scoreboard failed: ${e.message}`); process.exit(1); });
