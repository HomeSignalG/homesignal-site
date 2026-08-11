// PHASE 9D — SEC administrative order PDF extraction. OUTCOME: BLOCKED.
// This test guards a NEGATIVE result. Its job is to keep the block honest: that no extraction
// was fabricated, that the blocking receipts are recorded, and that the Phase 9C defect found
// on the way is written down rather than quietly patched.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const norm = s => s.replace(/\n--\s*/g, ' ').replace(/\s+/g, ' ').trim();
const p9d = norm(sql.slice(sql.indexOf('PHASE 9D (2026-08-11)')));
let fails = 0;
const ok  = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const has = (needle, n) => ok(p9d.includes(norm(needle)), n);

ok(p9d.length > 2000, 'Phase 9D section loaded');

// the outcome is a refusal to fabricate, stated plainly
has('OUTCOME: BLOCKED IN THIS ENVIRONMENT', 'the phase reports itself blocked');
has('NO EXTRACTION WAS PERFORMED, NO DATA WAS WRITTEN', 'nothing was written');
has('Rather than produce a partial or inferred extraction, nothing was written',
    'no partial or inferred extraction was substituted');

// the Phase 9C defect is disclosed, not quietly patched
has('A GENUINE PHASE 9C DEFECT, FOUND AND CORRECTED', 'the 9C defect is disclosed');
has('THE SECOND HALF IS WRONG', 'the wrong half of the 9C claim is named');
has('The canonical pattern — the one I had already used successfully for litigation releases in 9B — was never tried',
    'the cause of the 9C error is stated');
has('THE CONCLUSION SURVIVES, for a different reason than recorded',
    'the conclusion is separated from its corrected basis');

// the near-miss on keyword matching
has('A match is a lead, not a fact; the position had to be read',
    'the sidebar-nav false positive is recorded');
has('inside the SIDEBAR NAV', 'where the false positive came from');

// three independent blocking receipts, each measured
has('pg_net DESTROYS PDF BINARY', 'receipt 1: pg_net cannot carry a PDF');
has('444 stored of 126,786 declared = 0.35% retained', 'receipt 1 is measured against Content-Length');
has('ORGANISATION POLICY DENIAL', 'receipt 2: sandbox egress is a policy denial');
has('must be reported, not retried or worked around', 'the policy denial was not evaded');
has('Drupal’s JSON:API at /jsonapi returns 404'.replace('’',"'"), 'receipt 3: no structured alternative');

// what would unblock it
has('WHAT WOULD UNBLOCK PHASE 9D', 'the unblock path is specified');
has('None of these is a schema or architecture change to the evidence graph',
    'the block is capability, not design');

// prior phases preserved
has('113/113 months, 6,077 documents, 4,562 matters', 'Phase 9C presence coverage preserved');
has('litigation releases 2,795, complete', 'Phase 9B preserved');
has('Garfield 0/49/4', 'Phase 8 preserved');
has('DETAIL coverage is 0 of 6,077 documents', 'detail coverage is stated as zero, honestly');
has('The 46 cross-corpus candidate pairs remain candidates', 'the 46 pairs are not falsely resolved');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
