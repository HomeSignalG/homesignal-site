// DATA-CENTRE LAYER FRESHNESS (founder, 2026-11-12), the offline half.
// The SQL half is test/map1_dc_source_freshness_pg (dc-source-freshness-suite.yml).
// Fixture rows are the reader's output computed read-only on production at 2026-11-12 14:12 UTC.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let fails = 0;
const ok = (c, name, detail) => {
  if (c) console.log('PASS — ' + name);
  else { fails++; console.log('FAIL — ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
};
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read('lib/dc-freshness.js'), ctx);
const HS = ctx.window.HS;

const AS_OF = '2026-11-12 14:12:37.997006+00';
const ROWS = [
  { source_key: 'compute_atlas', publisher: 'Compute Atlas (Edward Kubiak)', licence: 'CC BY 4.0',
    last_success_at: '2026-11-06 09:45:05.255227+00', last_success_release: '1.35.1',
    publisher_edition_at: '2026-11-05 18:24:03.746+00', last_attempt_at: '2026-11-12 09:44:17.109168+00',
    last_attempt_refreshed: false, scheduled: true, as_of: AS_OF },
  { source_key: 'epoch_ai', publisher: 'Epoch AI', licence: 'CC BY 4.0',
    last_success_at: '2026-11-12 10:16:29.144213+00', last_success_release: null,
    publisher_edition_at: '2026-11-05 00:00:00+00', last_attempt_at: '2026-11-12 10:16:27.38218+00',
    last_attempt_refreshed: true, scheduled: true, as_of: AS_OF },
  { source_key: 'openstreetmap', publisher: 'OpenStreetMap', licence: 'ODbL',
    last_success_at: '2026-09-15 18:46:03.003778+00', last_success_release: null,
    publisher_edition_at: null, last_attempt_at: null, last_attempt_refreshed: null, scheduled: false, as_of: AS_OF }
];
// Real ZIP 20147: Compute Atlas and OpenStreetMap pins, no Epoch pin.
const lines = HS.dcFreshnessLines(ROWS, ['Compute Atlas (Edward Kubiak)', 'OpenStreetMap', 'Compute Atlas (Edward Kubiak)']);

ok(lines.length === 2, '1 only sources with a pin on the page are named', lines);
ok(lines[0] === 'Compute Atlas (Edward Kubiak): last successful refresh November 6, 2026 (6 days ago).'
  + " Publisher's edition dated November 5, 2026."
  + ' Our last attempt to refresh it, November 12, 2026, did not complete; the pins show the earlier read.',
  '2 Compute Atlas: refresh date, age, edition, and the failed attempt said separately', lines[0]);
ok(lines[1] === 'OpenStreetMap: loaded once, September 15, 2026 (57 days ago); not refreshed since.',
  '3 OpenStreetMap: a one-time load is never called a refresh', lines[1]);

const ep = HS.dcFreshnessLines(ROWS, ['Epoch AI'])[0];
ok(ep === "Epoch AI: last successful refresh November 12, 2026 (today). Publisher's edition dated November 5, 2026.",
  '4 a refreshed source carries no failed-attempt sentence', ep);

const html = HS.dcFreshnessHTML(lines);
ok(/It does not mean each facility was checked on that date\./.test(html),
  '5 the panel says a refresh date is not a per-facility check');
ok(!/verified|checked on November/i.test(lines.join(' ')), '6 no line claims a facility was verified on a date');
ok(HS.dcFreshnessHTML([]) === '' && HS.dcFreshnessLines(null, ['x']).length === 0,
  '7 nothing to say renders nothing');
ok(HS.dcFreshnessLines(ROWS, []).length === 0, '8 no pins on the page: nothing is said');

// The failed reader renders nothing and is read again next time.
let calls = 0;
const el = { innerHTML: 'old' };
const failing = () => ({ rpc: () => { calls++; return Promise.resolve({ error: { message: 'PGRST202' }, data: null }); } });
await HS.mountDcFreshness(el, ['OpenStreetMap'], failing);
ok(el.innerHTML === '' && calls === 1, '9 a missing or failed reader renders nothing, never a guessed date', el.innerHTML);
const working = () => ({ rpc: () => { calls++; return Promise.resolve({ error: null, data: ROWS }); } });
await HS.mountDcFreshness(el, ['OpenStreetMap'], working);
ok(calls === 2 && /loaded once, September 15, 2026/.test(el.innerHTML), '10 the next render reads again after a failure');
await HS.mountDcFreshness(el, ['OpenStreetMap'], working);
ok(calls === 2, '11 a good answer is read once per page load');
await HS.mountDcFreshness(el, [], working);
ok(el.innerHTML === '', '12 a ZIP with no data-centre pins clears the panel');

// The page wires it after the development-source panel, and the reader name matches the SQL.
const page = read('homesignalmap.html');
ok(/<div id="srcFresh"><\/div>\s*<div id="dcFresh"><\/div>/.test(page), '13 the page has its own panel under the source panel');
ok(/HS\.mountDcFreshness\(\$\("dcFresh"\)/.test(page) && /lib\/dc-freshness\.js\?v=/.test(page), '14 the page loads and mounts it');
const sql = read('docs/map1-dc-source-freshness.sql');
ok(/create or replace function public\.map1_dc_source_freshness\(\)/.test(sql)
  && read('lib/dc-freshness.js').includes("rpc('map1_dc_source_freshness')"), '15 one reader name in SQL and page');
ok(/completeness_state = 'SUCCESS_COMPLETE' and a\.advanced_observations/.test(sql),
  '16 "last successful refresh" uses the same rule that chooses the records Map 1 shows');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
