// One wording for a record's verification date, in the Python page generator and the JS templates.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else console.log('ok   ' + m); };
const ctx = { window: {}, HS: {} }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext('var HS = window.HS = window.HS || {}; var self = window;', ctx);
vm.runInContext(readFileSync('lib/templates.js', 'utf8'), ctx);
const js = (d) => ctx.HS.tpl.lastUpdated(d);
const py = (d) => JSON.parse(execFileSync('python3', ['-c',
  'import sys,json;sys.path.insert(0,"scripts");import gen_zip_pages as g;print(json.dumps(g.last_updated(sys.argv[1])))', d]).toString());
for (const d of ['2026-09-28', '2026-01-05', '2026-12-31T08:00:00Z']) ok(js(d) === py(d.slice(0, 10)) && js(d).startsWith('Last updated: '), `JS and Python agree for ${d}: ${js(d)}`);
for (const d of ['', null, 'nope', '2026-13-01']) ok(js(d) === '' && py(String(d || '')) === '', `no date shown for ${JSON.stringify(d)}`);
const card = ctx.HS.tpl.lastUpdatedLine({ last_updated: '2026-09-28' });
ok(card.includes('Last updated: Sep 28, 2026'), 'the card line carries the label');
ok(ctx.HS.tpl.lastUpdatedLine({}) === '', 'a record with no verified date shows nothing (never the build day)');
ok(ctx.HS.tpl.lastUpdatedLine({ record_kind: 'national_project', last_seen_at: '2026-11-26T20:00:09Z' }) === '',
   'a national listing\'s last_seen_at (a row-insert time) is never shown as Last updated');
process.exit(fails ? 1 : 0);
