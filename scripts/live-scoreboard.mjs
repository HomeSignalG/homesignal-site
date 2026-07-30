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
  scoreStates, rankRegistryWork, rankDiscoveryWork, isFloorSource, LIVE_THRESHOLD,
} from './lib/live-scoreboard-core.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const REGISTRY = `${ROOT}/supabase/functions/get-address-report/jurisdiction-registry.json`;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';
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
async function fetchZipPages() {
  if (!SUPABASE_URL || !KEY) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const rows = [];
  let last = '';
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/communities`
      + `?select=zip_codes,state,county&level=eq.zip&order=id.asc&limit=1000`
      + (last ? `&id=gt.${encodeURIComponent(last)}` : '');
    const r = await fetch(`${url}&select=id,zip_codes,state,county`, { headers: hdr });
    if (!r.ok) throw new Error(`communities read failed: HTTP ${r.status}`);
    const page = await r.json();
    if (!page.length) break;
    for (const c of page) {
      if (!c.state) continue;
      rows.push({ zip: (c.zip_codes || [])[0] || c.id, state: c.state, county: c.county || null });
    }
    last = page[page.length - 1].id;
    if (page.length < 1000) break;
  }
  return rows;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;

(async () => {
  const entries = flattenRegistry(REGISTRY);
  const zips = await fetchZipPages();
  const wiredIds = new Set(entries.map((e) => e.registry_id));

  let research = [];
  const rp = process.env.RESEARCH_ROWS;
  if (rp && existsSync(rp)) research = JSON.parse(readFileSync(rp, 'utf8'));

  const states = scoreStates(entries, zips);
  const registryWork = rankRegistryWork(entries, zips);
  const discovery = rankDiscoveryWork(research, zips, wiredIds);
  const live = states.filter((s) => s.live);

  if (AS_JSON) {
    console.log(JSON.stringify({ threshold: LIVE_THRESHOLD, states, registryWork, discovery }, null, 2));
    return;
  }

  console.log(`\nLIVE SCOREBOARD — 90%+ of a state's ZIP PAGES covered by >=1 entry with BOTH maps complete`);
  console.log(`(EPA-FRS tracked, never counted — ${entries.filter((e) => isFloorSource(e.registry_id)).length} floor entr(y/ies) excluded)\n`);
  console.log(`LIVE: ${live.length} of ${states.length} states — ${live.map((s) => s.state).join(', ') || '(none)'}\n`);

  console.log(`state  pages  complete   %      any-source  convertible-by-completion  LIVE`);
  for (const s of states) {
    console.log(
      `${String(s.state).padEnd(6)} ${String(s.zip_pages).padStart(5)} ${String(s.covered_complete).padStart(9)} `
      + `${pct(s.pct_complete).padStart(6)} ${String(s.covered_any).padStart(11)} `
      + `${String(s.convertible_by_completion).padStart(26)}  ${s.live ? 'YES' : ''}`);
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
  console.log('\nList 2 is never merged into List 1: a NOT_WIRED row is discovery, and "Needs Connector"');
  console.log('is a new connector family — a founder gate, not a quick win.\n');
})().catch((e) => { console.error(`live-scoreboard failed: ${e.message}`); process.exit(1); });
