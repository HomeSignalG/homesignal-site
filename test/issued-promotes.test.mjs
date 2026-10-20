// Arizona pre-launch (2026-10-20): an ISSUED Phoenix permit is "Approved", not "Proposed".
//
// Founder ruling §7.12a: an issued permit is Approved. Phoenix's permit layer keeps the
// status word OPEN from intake to final inspection, so its issued-but-unfinished permits
// were drawn on Map 1 as unapproved proposals (measured: 843 of 987 "proposed" Phoenix
// records in ZIP 85008 carried the city's own PER_ISSUE_DATE). sources/issued-promotes.ts
// promotes such a row ONLY from its own issue-date column, and fails closed otherwise.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issuedPromotedBucket } from '../supabase/functions/get-address-report/sources/issued-promotes.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rule = { statuses: ['OPEN'], column: 'PER_ISSUE_DATE' };
const today = '2026-10-20';
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS', name); };

ok('issued OPEN permit is approved', () =>
  assert.equal(issuedPromotedBucket(rule, 'OPEN', 'proposed', '2026-09-03', today), 'approved'));
ok('status match is trimmed and case-insensitive', () =>
  assert.equal(issuedPromotedBucket(rule, ' open ', 'proposed', '2026-09-03', today), 'approved'));
ok('OPEN with no issue date stays proposed', () =>
  assert.equal(issuedPromotedBucket(rule, 'OPEN', 'proposed', null, today), 'proposed'));
ok('unparseable issue date stays proposed', () =>
  assert.equal(issuedPromotedBucket(rule, 'OPEN', 'proposed', '9/3/2026', today), 'proposed'));
ok('issue date tomorrow is tolerated (date-sanity +1 day)', () =>
  assert.equal(issuedPromotedBucket(rule, 'OPEN', 'proposed', '2026-10-21', today), 'approved'));
ok('issue date two days out stays proposed', () =>
  assert.equal(issuedPromotedBucket(rule, 'OPEN', 'proposed', '2026-10-22', today), 'proposed'));
ok('a status not named by the rule is untouched', () =>
  assert.equal(issuedPromotedBucket(rule, 'PENDING', 'proposed', '2026-09-03', today), 'proposed'));
ok('only proposed is ever promoted (DONE/operating stays operating)', () =>
  assert.equal(issuedPromotedBucket({ statuses: ['DONE'], column: 'X' }, 'DONE', 'operating', '2026-09-03', today), 'operating'));
ok('no rule = byte-identical behaviour', () =>
  assert.equal(issuedPromotedBucket(undefined, 'OPEN', 'proposed', '2026-09-03', today), 'proposed'));

// Registry wiring: Phoenix declares the rule on a column it actually requests.
const reg = JSON.parse(readFileSync(join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const phx = reg.arcgis.find((e) => e && e.registry_id === 'phoenix-building-permits');
ok('Phoenix declares issued_promotes on PER_ISSUE_DATE for OPEN', () =>
  assert.deepEqual(phx.issued_promotes, rule));
ok('Phoenix requests the issue-date column (out_fields)', () =>
  assert.ok(phx.out_fields.includes('PER_ISSUE_DATE')));
ok('every issued_promotes rule names statuses its own map buckets as proposed', () => {
  for (const plat of ['arcgis']) for (const e of reg[plat]) {
    if (!e || !e.issued_promotes) continue;
    const prop = (e.status_to_bucket.proposed || []).map((s) => s.toLowerCase());
    for (const s of e.issued_promotes.statuses) assert.ok(prop.includes(s.toLowerCase()), `${e.registry_id}: ${s}`);
    if (e.out_fields) assert.ok(e.out_fields.includes(e.issued_promotes.column), `${e.registry_id}: column not fetched`);
  }
});
// The connector applies the rule at bucket resolution (structural pin, comments stripped).
const src = readFileSync(join(root, 'supabase/functions/get-address-report/sources/arcgis.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('arcgis.ts routes the mapped bucket through issuedPromotedBucket', () =>
  assert.match(src, /const bucket = mapped === undefined \? undefined : issuedPromotedBucket\(\s*entry\.issued_promotes/));
console.log(`${n} checks passed`);
