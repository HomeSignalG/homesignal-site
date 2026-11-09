// WHAT A ZIP'S EPA FACILITY COUNT MAY CLAIM (2026-11-09). HS.facilityInventory (lib/templates.js) is the one presenter
// for Map 1's counter and the ZIP page's strip; the state itself is decided in SQL (docs/zip-facility-inventory.sql,
// proven end to end through the collector in test/dev_collect_inventory_pg). This file drives the presenter on every
// state and pins that both pages read it.
//
// Run: node test/facility-inventory.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : '')); if (!c) fails++; };

const g = globalThis; g.window = { HS: {} };
new Function(readFileSync(join(root, 'lib/templates.js'), 'utf8')).call(g);
const F = g.window.HS.facilityInventory;
const J = (x) => JSON.stringify(x);

ok(typeof F === 'function', 'control — HS.facilityInventory is loaded');
// 1. complete
let r = F({ state: 'complete', member_count: 7, latest_refresh: 'ok' });
ok(r.tile === '7' && r.suffix === '' && r.note === '', '1. complete: a plain total, no qualifier', J(r));
// 2. complete zero
r = F({ state: 'complete', member_count: 0, latest_refresh: 'ok' });
ok(r.tile === '0' && r.note === '', '2. complete with zero members: a verified 0', J(r));
// 3. complete, then a failed refresh
r = F({ state: 'complete_as_of', member_count: 7, latest_refresh: 'failed', last_success_at: '2026-10-03T15:00:00Z' });
ok(r.tile === '7' && r.suffix === ' · complete as of Oct 3, 2026' && /as of Oct 3, 2026, not a current one/.test(r.note) && /did not answer/.test(r.note),
  '3. complete as of a date: the count, the date, and that the latest refresh failed', J(r));
r = F({ state: 'complete_as_of', member_count: 7, latest_refresh: 'failed', last_success_at: null });
ok(r.tile === '7+' && /not a complete count/.test(r.suffix), '3b. complete_as_of without a date is never shown as complete', J(r));
// 4. legacy
r = F({ state: 'not_complete', member_count: 3, latest_refresh: 'ok' });
ok(r.tile === '3+' && r.suffix === ' · not a complete count' && /^Not a complete count/.test(r.note) && !/did not answer/.test(r.note),
  '4. legacy list: "3+", not a complete count', J(r));
r = F({ state: 'not_complete', member_count: 0, latest_refresh: 'ok' });
ok(r.tile === '—' && /not yet counted/.test(r.suffix), '4b. legacy zero: a dash, never 0', J(r));
// 5. missing boundary / unresolved retrieval
r = F({ state: 'not_measured', member_count: null });
ok(r.tile === '—' && /no mapped boundary/.test(r.note), '5. no boundary: a dash', J(r));
r = F({ state: 'not_complete', member_count: 0, latest_refresh: 'failed' });
ok(r.tile === '—' && /did not answer/.test(r.note), '5b. unresolved retrieval: a dash and the failure', J(r));
// unread / unknown
r = F(null, null);
ok(r.tile === '—' && /count not available/.test(r.suffix), '6. unread inventory, no count: a dash, "count not available"', J(r));
r = F(null, 4);
ok(r.tile === '4+' && /not a complete count/.test(r.suffix), '6b. unread inventory with a drawn count: never a total', J(r));
r = F({ state: 'something_new', member_count: 4 });
ok(r.tile === '4+', '6c. an unrecognised state is never a total', J(r));
ok(F({ state: 'complete', member_count: 9 }, 2).tile === '2', '7. an explicit member count (Map 1: the drawn set) wins over the object');

// The two pages read it, and the empty-page sentence needs a complete zero.
const map = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
const comm = readFileSync(join(root, 'lib/community-page.js'), 'utf8');
const data = readFileSync(join(root, 'lib/data.js'), 'utf8');
ok(/HS\.facilityInventory\(data\.facInventory \|\| null, _facN\)/.test(map) && /facInventory: \(rs && rs\.facility_inventory\) \|\| null/.test(map),
  'Map 1 presents the facility_inventory that zip_mode_report_sites returns');
ok(/sb\(\)\.rpc\('zip_facility_inventory', \{ p_zip: zip \}\)/.test(data), 'HS.data.facilityInventory reads public.zip_facility_inventory');
ok(/var facPres = HS\.facilityInventory \? HS\.facilityInventory\(facInv, null\) : null;/.test(comm)
   && /if \(facPres\) \{ facTile = facPres\.tile; facLabel = 'Regulated facilities' \+ facPres\.suffix; \}/.test(comm),
  'the ZIP page strip presents the inventory, not the materializer count');
ok(/facInvState === 'complete' && Number\(facInv\.member_count\) === 0/.test(comm),
  'the "we checked the EPA facility registry and found nothing" sentence needs a complete inventory of zero');

delete g.window;
console.log(fails ? `\n${fails} FAILURE(S) — facility-inventory` : '\nALL PASS — facility-inventory');
process.exit(fails ? 1 : 0);
