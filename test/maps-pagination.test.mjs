// Maps uncap Phase 1 — pins lib/data.js fetchAllPages + the projects()/facilities()
// range-windowed full read. PostgREST silently caps un-paginated reads at 1,000 rows,
// so once app_refresh_zip's LIMIT 48/16 lift, these reads MUST page or dense ZIPs
// (worst live: 5,424 dev records) silently truncate at 1,000. Contract pinned here:
//   * all windows are fetched until a short page (complete=true, no dupes, in order)
//   * <=1,000 rows -> exactly ONE window (byte-identical to the pre-pagination read)
//   * a window that fails twice -> complete=false (callers must NOT render the prefix
//     as the full set; maps.html turns this into its honest load-error state)
//   * ordering carries the .order('id') tiebreak so windows are stable
// Run: node test/maps-pagination.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

// --- a minimal supabase-js stand-in: from().select().eq().order().range() over a fixture ---
// Records every range() call + every order() column so the tests can assert both.
function makeSb(fixture, opts) {
  opts = opts || {};
  const calls = { ranges: [], orders: [] };
  function builder() {
    const b = {
      _filters: {},
      select() { return b; },
      eq(col, v) { b._filters[col] = v; return b; },
      order(col, o) { calls.orders.push(col); return b; },
      async range(from, to) {
        calls.ranges.push([from, to]);
        if (opts.failWindow != null && from === opts.failWindow) {
          return { data: null, error: { message: 'boom' } };
        }
        const rows = fixture.filter(r =>
          Object.keys(b._filters).every(k => r[k] === b._filters[k]));
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return b;
  }
  return {
    client: { from: () => builder() },
    calls,
  };
}

function devFixture(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'd' + String(i).padStart(5, '0'), zip: '55407', record_kind: 'development',
    name: 'Permit ' + i, submitted_at: '2026-07-01', lat: null, lng: null,
  }));
}

async function loadData(sbClient) {
  // fresh module instance per scenario: bust the require cache + rebuild window
  delete require.cache[require.resolve('../lib/data.js')];
  global.window = {
    HS_CONFIG: { DATA_SOURCE: 'supabase', DEFAULT_ZIP: '55407' },
    HS: { state: { session: null, zip: '55407' } },
    supabase: { createClient: () => sbClient },
  };
  require('../lib/data.js');
  return global.window.HS;
}

// --- 1. dense ZIP: 2,437 rows -> three windows, all rows, in order, no dupes ---
{
  const sb = makeSb(devFixture(2437));
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('55407', null);
  ok(out.length === 2437, 'dense: all 2,437 rows fetched (got ' + out.length + ')');
  ok(out.complete === true, 'dense: complete=true after a clean loop');
  ok(sb.calls.ranges.length === 3 &&
     sb.calls.ranges[0][0] === 0 && sb.calls.ranges[1][0] === 1000 && sb.calls.ranges[2][0] === 2000,
     'dense: exactly 3 windows at offsets 0/1000/2000');
  const ids = new Set(out.map(r => r.id));
  ok(ids.size === 2437, 'dense: no duplicate rows across windows');
  ok(out[0].id === 'd00000' && out[2436].id === 'd02436', 'dense: fixture order preserved end-to-end');
  ok(sb.calls.orders.includes('id'), "dense: the .order('id') tiebreak is applied (stable total order)");
}

// --- 2. today's shape: 48 rows -> ONE window (pre-pagination behavior unchanged) ---
{
  const sb = makeSb(devFixture(48));
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('55407', null);
  ok(out.length === 48 && out.complete === true, 'capped: 48 rows, complete');
  ok(sb.calls.ranges.length === 1, 'capped: exactly ONE window — no behavior change at <=1,000 rows');
}

// --- 3. exact window boundary: 1,000 rows -> complete, no phantom rows ---
{
  const sb = makeSb(devFixture(1000));
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('55407', null);
  ok(out.length === 1000 && out.complete === true, 'boundary: exactly 1,000 rows, complete');
}

// --- 4. a later window fails twice -> prefix returned but complete=false ---
{
  const sb = makeSb(devFixture(2437), { failWindow: 1000 });
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('55407', null);
  ok(out.complete === false, 'mid-loop failure: complete=false (prefix must NOT pass as the full set)');
  ok(out.length === 1000, 'mid-loop failure: only the clean prefix is present (got ' + out.length + ')');
  const retries = sb.calls.ranges.filter(r => r[0] === 1000).length;
  ok(retries === 2, 'mid-loop failure: the failing window was retried once (got ' + retries + ' attempts)');
}

// --- 5. first window fails twice -> empty + complete=false ---
{
  const sb = makeSb(devFixture(500), { failWindow: 0 });
  const HS = await loadData(sb.client);
  const out = await HS.data.projects('55407', null);
  ok(out.length === 0 && out.complete === false, 'first-window failure: empty + complete=false');
}

// --- 6. facilities() pages the same way, ordered name + id tiebreak ---
{
  const fixture = Array.from({ length: 1203 }, (_, i) => ({
    id: 'f' + String(i).padStart(5, '0'), zip: '60614', record_kind: 'facility',
    name: 'Facility ' + i, lat: null, lng: null,
  }));
  const sb = makeSb(fixture);
  const HS = await loadData(sb.client);
  const out = await HS.data.facilities('60614', null);
  ok(out.length === 1203 && out.complete === true, 'facilities: all 1,203 rows fetched, complete');
  ok(sb.calls.ranges.length === 2, 'facilities: two windows');
  ok(sb.calls.orders.includes('name') && sb.calls.orders.includes('id'),
     "facilities: ordered by name with the .order('id') tiebreak");
}

// --- 7. seed mode untouched (no supabase call at all) ---
{
  delete require.cache[require.resolve('../lib/data.js')];
  global.window = {
    HS_CONFIG: { DATA_SOURCE: 'seed', DEFAULT_ZIP: '55407' },
    HS: { state: { session: null, zip: '55407' } },
    HS_SEED: { projects: [{ id: 's1', name: 'Seed permit', lat: null, lng: null }] },
  };
  require('../lib/data.js');
  const out = await global.window.HS.data.projects('55407', null);
  ok(out.length === 1 && out[0].id === 's1', 'seed mode: unchanged, no paging');
}

process.exit(fails ? 1 : 0);
