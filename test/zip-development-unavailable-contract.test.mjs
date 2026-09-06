// UNAVAILABLE, ZERO, AND FAILED ARE THREE DIFFERENT ANSWERS — pinned at the data layer.
//
// THE DEFECT THIS IS THE CONTROL FOR (2026-09-06). Two canonical ZIPs with the SAME truthful
// geography state — `not_measured / NO_ZCTA_IN_TIGER_2025`, meaning the pinned TIGER contract
// holds no ZCTA for them so whole-ZIP measurement never happened — meant two different things
// to a resident, decided by whether a historical cutover row happened to exist:
//
//   10015  stale cutover enabled -> authoritative branch -> 0 rows -> reads as a MEASURED ZERO
//   01004  no cutover row        -> LEGACY branch        -> 90 rows of centroid/proxy geography
//
// The read path now gates on the CURRENT geography state and answers with a self-describing
// object instead of an array. This file pins the client half of that contract: the object must
// be recognised, must NOT be retried (it is a definite answer, not a failure), and must stay
// distinguishable from a genuine zero AND from a failed read. Collapsing any two of those three
// is how the defect comes back.
//
// Run: node test/zip-development-unavailable-contract.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (detail !== undefined ? '  [' + detail + ']' : ''));
  if (!c) fails++;
};

// A minimal window the data layer will accept, plus a counting rpc stub.
function load(rpcImpl) {
  const calls = { n: 0 };
  const win = {
    HS: {},
    HS_CONFIG: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'y', DATA_SOURCE: 'supabase', DEFAULT_ZIP: '78617' },
    supabase: { createClient: () => ({ rpc: async (fn, args) => { calls.n++; return rpcImpl(fn, args); } }) }
  };
  new Function('window', readFileSync(join(root, 'lib/data.js'), 'utf8'))(win);
  return { HS: win.HS, calls };
}

// ── 1. THE UNAVAILABLE OBJECT IS RECOGNISED, AND NOT RETRIED ─────────────────────────────
{
  const { HS, calls } = load(() => ({
    data: { unavailable: true, zip_geography_status: 'not_measured', projects: null }, error: null }));
  const r = await HS.rpcAllRows('10015', 'development');
  ok(r.unavailable === 'not_measured', '1: the status is carried through verbatim', r.unavailable);
  ok(r.complete === false, '1: an unavailable read is not reported complete');
  ok(Array.isArray(r.rows) && r.rows.length === 0, '1: it yields no rows to render');
  // A definite answer must cost ONE round trip. Retrying it would double every not_measured
  // page's load for an answer that cannot change between attempts.
  ok(calls.n === 1, '1: a definite answer is NOT retried', 'rpc calls=' + calls.n);
}

// ── 2. A GENUINE MEASURED ZERO IS STILL A MEASURED ZERO ──────────────────────────────────
// This is the distinction that matters most: `boundary_complete` with an empty authoritative
// result is a real finding of zero, and must NOT acquire the unavailable stamp.
{
  const { HS } = load(() => ({ data: [], error: null }));
  const r = await HS.rpcAllRows('01009', 'development');
  ok(r.complete === true, '2: an empty ARRAY is a complete read — a measured zero');
  ok(!r.unavailable, '2: ...and carries no unavailable stamp', String(r.unavailable));
}

// ── 3. A FAILED READ STAYS A FAILED READ ─────────────────────────────────────────────────
// `complete:false` alone cannot mean "not measured", or the page cannot tell a network failure
// from a ZIP that has no geography to read.
{
  const { HS, calls } = load(() => ({ data: null, error: { message: 'network' } }));
  const r = await HS.rpcAllRows('28456', 'development');
  ok(r.complete === false, '3: a failed read is incomplete');
  ok(!r.unavailable, '3: ...and is NOT labelled unavailable — the two never merge');
  ok(calls.n === 2, '3: a failure IS retried once, as before', 'rpc calls=' + calls.n);
}

// ── 4. projects() CARRIES THE STAMP ONTO THE RENDERED ARRAY ──────────────────────────────
{
  const { HS } = load(() => ({
    data: { unavailable: true, zip_geography_status: 'not_measured', projects: null }, error: null }));
  const out = await HS.data.projects('10015', null);
  ok(Array.isArray(out) && out.length === 0, '4: projects() returns an empty array');
  ok(out.unavailable === 'not_measured', '4: ...stamped with WHY it is empty', out.unavailable);
  ok(out.complete === false, '4: ...and not complete');
}
{
  const { HS } = load(() => ({ data: [], error: null }));
  const out = await HS.data.projects('01009', null);
  ok(out.unavailable === null, '4: a measured zero stamps unavailable=null, never a string', String(out.unavailable));
}

// ── 5. THE COPY NEVER CLAIMS ZERO, AND NEVER PROMISES A CIRCLE ───────────────────────────
{
  const { HS } = load(() => ({ data: [], error: null }));
  for (const st of ['not_measured', 'unknown', 'boundary_complete_not_cut_over']) {
    const t = HS.zipDevelopmentUnavailableNote(st, '10015');
    ok(typeof t === 'string' && t.length > 40, '5: ' + st + ' has copy');
    ok(!/\bno (permit|planning|development) records\b/i.test(t),
       '5: ' + st + ' never says there are no records — that would assert a measurement');
    ok(/ZIP 10015/.test(t), '5: ' + st + ' names the ZIP');
  }
  const nm = HS.zipDevelopmentUnavailableNote('not_measured', '10015');
  ok(/not a finding of zero/i.test(nm), '5: not_measured says outright that it is not a zero');
  ok(/circle around the ZIP centre/i.test(nm), '5: ...and refuses the centroid substitute');
  ok(/facilit/i.test(nm), '5: ...and says what IS still there, so empty-development is not empty-page');
}

console.log(fails ? `\n${fails} check(s) failed` : '\nzip-development-unavailable-contract: all checks passed');
process.exit(fails ? 1 : 0);
