// PHASE 2 — Travis County Clerk registration + ownership resolution contract guards.
// CI has no database; these assert against the SQL of record. The live results
// (2 synthetic scenarios + the 292354 proof) are in docs/evidence-phase2-report.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const p2 = sql.slice(sql.indexOf('PHASE 2 ADDITIONS'));

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

ok(p2.length > 1500, 'Phase 2 section of the SQL of record loaded');

// the adapter was NOT built, and the reason is recorded with receipts
ok(/THE CLERK ADAPTER WAS NOT BUILT/.test(p2), 'the block is stated, not glossed');
ok(/User-agent: ClaudeBot \/ Disallow: \//.test(p2), 'the ClaudeBot exclusion is recorded verbatim');
ok(/Allow: \/\$" \+ "Disallow: \//.test(p2), 'the publicsearch robots rule is recorded verbatim');
ok(/Nothing was scraped\. Zero Clerk claims exist\./.test(p2), 'no data was taken from a source that forbids it');

// deed parties must never become owners
ok(/NOT automatically the current owner/.test(p2), 'grantee is not the current owner');
ok(/NOT 'former owner'/.test(p2), 'grantor is not a former owner');
ok(/Candidates are ownership-BEARING claims only/.test(p2), 'only ownership-bearing predicates resolve');

// source authority is scoped
ok(/explicitly NOT authoritative for values, acreage or classification/.test(p2),
  'the Clerk is not made authoritative for unrelated predicates');
ok(/Declaring authority is not the same as holding evidence/.test(p2),
  'declared authority is distinguished from actual evidence');

// abstention
ok(/'unavailable' is explicitly NOT "the instrument does not exist"/.test(p2),
  'a failed lookup never becomes "no deed"');
ok(/One per TCAD-reported instrument/.test(p2), 'all four instruments were attempted and recorded');

// resolution policy
ok(/RECENCY FIRST/.test(p2) && /older recorded deed does NOT override a newer assessor/.test(p2),
  'an older deed cannot override a newer roll');
ok(/"Clerk always wins" is deliberately not implemented/.test(p2), 'no hardcoded source supremacy');
ok(/state = 'disagreement'/.test(p2) && /Both survive; neither is deleted/.test(p2),
  'same-period disagreement is surfaced and both claims survive');
ok(/historical deed chain is NOT a conflict/.test(p2), 'chronology is not mislabelled as conflict');
ok(/`supporting` always returns EVERY candidate claim/.test(p2), 'resolution never drops a claim');
ok(/No score of any kind is produced/.test(p2), 'no confidence/trust score');

// phase 1 invariants must still be stated
ok(/'OWNER block' -> project_owner_as_filed/.test(sql), 'TDLR project owner stays distinct');
ok(/Storage never arbitrates; display does, at read time/.test(sql), 'storage still never arbitrates');

process.exit(fails ? 1 : 0);
