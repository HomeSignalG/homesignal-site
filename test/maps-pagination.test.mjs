// Maps uncap — the full-read contract for projects()/facilities().
//
// PHASE 1 (still pinned below, Part A): PostgREST silently caps un-paginated reads at
// 1,000 rows, so `fetchAllPages` re-issues a query in 1,000-row windows until a short
// page. That helper is still exported and still correct; these cases keep it honest.
//
// PHASE 2 (Part B): projects()/facilities() no longer USE it. The cap is service-side —
// `limit=5000` and `limit=25000` both return exactly 1,000 rows (measured live on
// app_projects?zip=eq.57104) — so a dense ZIP cost one round trip per 1,000 rows:
// 57104's 19,584 records meant TWENTY sequential requests and the page did not finish
// inside ~6.5 s (it did finish by 15 s — slow, never truncated). Both functions now call
// the `app_projects_for_zip` RPC, which returns ONE row carrying a jsonb array; a row cap
// cannot truncate a single row.
//
// ⛔ THE TRAP THIS FILE EXISTS TO PREVENT: "just raise PAGE_ROWS" is worse than no fix.
// fetchAllPages stops on `data.length < PAGE_ROWS`, so PAGE_ROWS=5000 would read the
// first capped 1,000-row response as a short page and return 1,000 of 19,584 records
// with complete:true — silent truncation reported as a complete read. Case A6 pins that.
//
// THE CONTRACT THAT MUST SURVIVE EITHER WAY: { rows, complete }. complete=false means the
// read failed, and callers must NEVER render the prefix as the full set — maps.html turns
// it into an honest load-error state. Cases B3/B4/B7 and B9 pin that end to end.
// Run: node test/maps-pagination.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

// --- supabase-js stand-in: from().select().eq().order().range() AND rpc() ---
function makeSb(fixture, opts) {
  opts = opts || {};
  const calls = { ranges: [], orders: [], rpcs: [] };
  function builder() {
    const b = {
      _filters: {},
      select() { return b; },
      eq(col, v) { b._filters[col] = v; return b; },
      order(col) { calls.orders.push(col); return b; },
      async range(from, to) {
        calls.ranges.push([from, to]);
        if (opts.failWindow != null && from === opts.failWindow) return { data: null, error: { message: 'boom' } };
        const rows = fixture.filter(r => Object.keys(b._filters).every(k => r[k] === b._filters[k]));
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return b;
  }
  return {
    client: {
      from: () => builder(),
      async rpc(fn, args) {
        calls.rpcs.push({ fn, args });
        // failRpc: 'always' | <n attempts to fail before succeeding> | 'nonarray'
        if (opts.failRpc === 'always') return { data: null, error: { message: 'rpc boom' } };
        if (opts.failRpc === 'nonarray') return { data: { not: 'an array' }, error: null };
        if (typeof opts.failRpc === 'number' && calls.rpcs.length <= opts.failRpc) {
          return { data: null, error: { message: 'rpc transient' } };
        }
        const rows = fixture.filter(r => r.zip === args.p_zip && r.record_kind === args.p_kind);
        return { data: rows, error: null };
      },
    },
    calls,
  };
}

function devFixture(n, zip) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'd' + String(i).padStart(5, '0'), zip: zip || '55407', record_kind: 'development',
    name: 'Permit ' + i, submitted_at: '2026-07-01', lat: null, lng: null,
  }));
}

async function loadData(sbClient) {
  delete require.cache[require.resolve('../lib/data.js')];
  global.window = {
    HS_CONFIG: { DATA_SOURCE: 'supabase', DEFAULT_ZIP: '55407' },
    HS: { state: { session: null, zip: '55407' } },
    supabase: { createClient: () => sbClient },
  };
  require('../lib/data.js');
  return global.window.HS;
}

console.log('A. fetchAllPages — the windowed helper is still exported and still correct');
{
  const sb = makeSb(devFixture(2437));
  const HS = await loadData(sb.client);
  const build = () => sb.client.from().select().eq('zip', '55407').eq('record_kind', 'development');
  const res = await HS.fetchAllPages(build);
  ok(res.rows.length === 2437 && res.complete === true, 'A1 dense: 2,437 rows across windows, complete');
  ok(sb.calls.ranges.length === 3 && sb.calls.ranges[0][0] === 0
     && sb.calls.ranges[1][0] === 1000 && sb.calls.ranges[2][0] === 2000, 'A2 dense: windows at 0/1000/2000');
  ok(new Set(res.rows.map(r => r.id)).size === 2437, 'A3 dense: no duplicate rows across windows');
}
{
  const sb = makeSb(devFixture(2437), { failWindow: 1000 });
  const HS = await loadData(sb.client);
  const build = () => sb.client.from().select().eq('zip', '55407').eq('record_kind', 'development');
  const res = await HS.fetchAllPages(build);
  ok(res.complete === false && res.rows.length === 1000, 'A4 mid-loop failure: prefix only, complete=false');
  ok(sb.calls.ranges.filter(r => r[0] === 1000).length === 2, 'A5 mid-loop failure: the window was retried once');
}
{
  // A6 — THE PAGE_ROWS TRAP, demonstrated rather than described. A server that caps at
  // 1,000 while the client asks for 5,000 returns a "short page", so a raised PAGE_ROWS
  // would report a TRUNCATED read as complete. This is why Phase 2 exists.
  const src = readFileSync(new URL('../lib/data.js', import.meta.url), 'utf8');
  const m = src.match(/const PAGE_ROWS = (\d+);/);
  ok(!!m && Number(m[1]) === 1000,
    'A6 PAGE_ROWS is 1000 and must stay 1000 — the server cap is 1,000, so a larger window '
    + 'makes the first capped response look like a short page and reports truncation as complete');
}

console.log('\nB. projects()/facilities() read through the RPC — one payload, cap-proof');
{
  const sb = makeSb(devFixture(19544, '57104'));
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('57104', null);
  ok(out.length === 19544 && out.complete === true, 'B1 dense: all 19,544 records in ONE payload, complete');
  ok(sb.calls.rpcs.length === 1 && sb.calls.ranges.length === 0,
    'B2 dense: exactly ONE rpc call and ZERO range windows (20 round trips -> 1)');
  ok(sb.calls.rpcs[0].fn === 'app_projects_for_zip'
     && sb.calls.rpcs[0].args.p_zip === '57104' && sb.calls.rpcs[0].args.p_kind === 'development',
    'B3 dense: called app_projects_for_zip with the ZIP and kind, nothing else');
  ok(out[0].id === 'd00000' && out[19543].id === 'd19543', 'B4 dense: server order preserved end-to-end');
}
{
  // REQUIRED PLANTED FAILURE: the RPC fails every attempt. The read must report
  // complete=false and carry NO rows — never a partial set dressed as a whole one.
  const sb = makeSb(devFixture(19544, '57104'), { failRpc: 'always' });
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('57104', null);
  ok(out.complete === false, 'B5 PLANTED FAILURE: complete=false when the RPC fails');
  ok(out.length === 0, 'B6 PLANTED FAILURE: zero rows — no prefix can pass as the full set');
  ok(sb.calls.rpcs.length === 2, 'B7 PLANTED FAILURE: retried exactly once before giving up');
}
{
  const sb = makeSb(devFixture(120, '57104'), { failRpc: 1 });   // fails once, then succeeds
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('57104', null);
  ok(out.length === 120 && out.complete === true, 'B8 transient failure recovers on the single retry');
}
{
  // Fails closed on a malformed payload: a non-array is NOT an empty result set.
  const sb = makeSb(devFixture(5, '57104'), { failRpc: 'nonarray' });
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('57104', null);
  ok(out.complete === false && out.length === 0, 'B9 malformed payload -> complete=false (fails closed)');
}
{
  const fixture = Array.from({ length: 1203 }, (_, i) => ({
    id: 'f' + String(i).padStart(5, '0'), zip: '60614', record_kind: 'facility',
    name: 'Facility ' + i, lat: null, lng: null,
  }));
  const sb = makeSb(fixture);
  const HS = await loadData(sb.client);
  const out = await HS.data.facilities('60614', null);
  ok(out.length === 1203 && out.complete === true, 'B10 facilities: all 1,203 in one payload, complete');
  ok(sb.calls.rpcs.length === 1 && sb.calls.rpcs[0].args.p_kind === 'facility',
    'B11 facilities: ONE rpc call with kind=facility');
}
{
  // The two kinds stay separate — a development read must never return facilities.
  const mixed = devFixture(10, '57104').concat([{ id: 'fx', zip: '57104', record_kind: 'facility', name: 'Plant', lat: null, lng: null }]);
  const sb = makeSb(mixed);
  const HS = await loadData(sb.client);
  const dev = await HS.data.projects('57104', null);
  ok(dev.length === 10 && !dev.some(r => r.id === 'fx'),
    'B12 guardrail #3 holds: development read excludes facility rows');
}

console.log('\nC. the caller still refuses to render an incomplete read');
{
  const maps = readFileSync(new URL('../maps.html', import.meta.url), 'utf8');
  ok(/projects\.complete === false/.test(maps) && /throw new Error\('incomplete app_projects read'\)/.test(maps),
    'C1 maps.html still throws on complete===false — the honest load-error path survives the refactor');
}
{
  delete require.cache[require.resolve('../lib/data.js')];
  global.window = {
    HS_CONFIG: { DATA_SOURCE: 'seed', DEFAULT_ZIP: '55407' },
    HS: { state: { session: null, zip: '55407' } },
    HS_SEED: { projects: [{ id: 's1', name: 'Seed permit', lat: null, lng: null }] },
  };
  require('../lib/data.js');
  const out = await global.window.HS.data.projects('55407', null);
  ok(out.length === 1 && out[0].id === 's1', 'C2 seed mode untouched (no DB call at all)');
}

console.log(fails ? `\n${fails} maps-pagination assertion(s) FAILED.` : '\nAll maps-pagination assertions passed.');
process.exit(fails ? 1 : 0);
