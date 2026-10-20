// FOUNDER RULING (2026-10-20, Texas pre-launch): Austin's issued construction permits are ON for
// ZIP pages, but only New / Addition / Demolition building permits that carry the publisher's own
// coordinates. Trade permits, repairs, remodels and rows without a point never reach a page, and
// nothing is geocoded. This pins the registry entry to that ruling.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(
  join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('PASS — ' + msg); } else { fail++; console.log('FAIL — ' + msg); } }

const e = (reg.socrata || []).find((x) => x.registry_id === 'austin-issued-construction-permits');
ok(!!e, 'the entry exists in the socrata block');
if (e) {
  ok(e.zip_mode !== false, 'zip_mode is not false: the entry runs on ZIP pages');
  ok(!('_zip_mode_note' in e), 'the retired property-page reservation note is gone');
  ok(e.column_map.lat === 'latitude' && e.column_map.lng === 'longitude', 'lat/lng read the publisher columns');
  const w = String(e.extra_where || '');
  ok(/permit_type_desc\s*=\s*'Building Permit'/.test(w), 'only Building Permit rows');
  const m = w.match(/work_class\s+IN\s*\(([^)]*)\)/i);
  const classes = m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort() : [];
  ok(JSON.stringify(classes) === JSON.stringify(['Addition', 'Demolition', 'New']),
     'work_class is exactly New, Addition, Demolition (got ' + JSON.stringify(classes) + ')');
  ok(/latitude\s+IS\s+NOT\s+NULL/i.test(w) && /longitude\s+IS\s+NOT\s+NULL/i.test(w),
     'rows without both coordinates are excluded at source');
  ok(!/\bOR\b/i.test(w), 'the filter has no OR that could widen it');
  ok(e.recency_days === 365, 'the 365-day window is unchanged');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
