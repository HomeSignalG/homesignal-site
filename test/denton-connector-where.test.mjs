// The Denton audit takes its publisher predicate from the SHIPPED connector (scripts/denton-connector-where.mjs), not from a copy.
// Asserts: Fort Worth carries both its type whitelist and its 365-day recency window; Frisco has neither; the shipped source is untouched
// and the throw-away copy is gone afterwards.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + m); if (!c) fails++; };
const dir = join(root, 'supabase/functions/get-address-report/sources');
const before = readFileSync(join(dir, 'arcgis.ts'), 'utf8');
const out = JSON.parse(execFileSync('node', [join(root, 'scripts/denton-connector-where.mjs'), 'fort-worth-development-permits', 'frisco-active-building-permits', 'txdot-projects-info-all'], { encoding: 'utf8' }));
const fw = out['fort-worth-development-permits'].where;
ok(/Permit_Type IN \('Commercial Building Permit'/.test(fw), 'Fort Worth predicate carries its extra_where type list');
const m = /File_Date >= DATE '(\d{4}-\d\d-\d\d)'/.exec(fw);
ok(!!m, 'Fort Worth predicate carries the recency clause on File_Date');
if (m) {
  const days = Math.round((Date.now() - Date.parse(m[1])) / 86400000);
  ok(days >= 364 && days <= 367, `recency cutoff is 365 days back (measured ${days})`);
}
ok(out['frisco-active-building-permits'].where === '1=1', 'Frisco has no predicate beyond the status rule (1=1)');
ok(out['txdot-projects-info-all'].where.includes("PROJ_STG NOT IN ('Closed', 'Cancelled')"), 'TxDOT predicate is its extra_where');
ok(!out['fort-worth-development-permits'].where.startsWith('1=1'), 'the ZIP-independent remainder has no leading 1=1');
ok(readFileSync(join(dir, 'arcgis.ts'), 'utf8') === before, 'shipped arcgis.ts is unchanged');
ok(!readdirSync(dir).some((f) => f.includes('audit-copy')), 'the throw-away copy was removed');
process.exit(fails ? 1 : 0);
