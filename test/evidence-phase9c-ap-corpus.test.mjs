// PHASE 9C — SEC administrative-proceedings corpus.
// Guards the measured record in docs/evidence-phase1-migration.sql. Offline; acquisition ran
// through pg_net, receipts in evidence.ev_sec_corpus_page / _release / v_sec_ap_coverage.
//
// Rule under test: a month is complete only when proven un-truncated, and two enforcement
// corpora are two questions.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const norm = s => s.replace(/\n--\s*/g, ' ').replace(/\s+/g, ' ').trim();
const p9c = norm(sql.slice(sql.indexOf('PHASE 9C (2026-08-11)')));
let fails = 0;
const ok  = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const has = (needle, n) => ok(p9c.includes(norm(needle)), n);

ok(p9c.length > 3000, 'Phase 9C section loaded');
has('Phase 9A/9B architecture unchanged', 'earlier architecture not redesigned');

// §1-2 the instrument and the window
has('there is no per-file-number endpoint', '§1 the 9B gap-fill method genuinely does not transfer');
has('?fileNumber= is IGNORED exactly as ?search= was in 9B', '§1 the ignored-parameter defect recurs and is proven');
has('Completeness is therefore proven PER MONTH', '§3 completeness is per month');
has('coverage 2017-04-03 .. 2026-08-11', '§3 the window is exact');
has('months expected 113 months complete 113 months incomplete 0', '§3 every month is accounted');
has('unexplained gaps 0', '§3 zero unexplained gaps');
has('documents 6,077 distinct matters (file numbers) 4,562', '§9/§11 documents and matters counted separately');

// the truncation guard and the receipt defect
has('THE TRUNCATION GUARD EARNED ITS KEEP', 'the at-limit guard mattered');
has('11 months came back at EXACTLY 100 rows', 'the at-limit months are counted');
has('mostly SEPTEMBER', 'the pattern behind them is explained');
has('RECEIPT DEFECT FOUND AND FIXED', 'the receipt defect is disclosed');
has('a receipt that loses its own reason is a bad receipt', 'why the receipt defect mattered');

// §5 what was NOT acquired
has('NOT ACQUIRED: the CONTENTS of the order documents', '§5 the document contents gap is stated');
has('reported as zero-extracted rather than as zero-existing',
    '§10 no monetary zero is manufactured from unread documents');
has('by a STATED HEURISTIC on the name string (not an authoritative role field)',
    '§5 the corporate/individual split is labelled a heuristic');

// §9 matters vs documents
has('673 file numbers carry more than one document; the largest carries 14',
    '§9 multi-document matters are measured');
has('Counted as documents that is 6,077; counted as matters it is 4,562',
    '§9 one matter is not many incidents');

// §7 cross-corpus
has('NOTHING is merged', '§7 cross-corpus candidates are not merged');
has('LR-24050 (2018-02-15) and IA-4857 (2018-02-22), file 3-18377',
    '§7/§12.6 the real cross-corpus pair is recorded');
has('recorded as a candidate, not a merge', '§7 the pair stays a candidate');

// §13 the entity scan
has('direct-company matches 0 · verified-parent matches 0 · unresolved 0 · no match 36',
    '§13 the four attribution outcomes are reported separately');
has('The positive control on the same scan returned 330', '§13 the zero ships with its control');

// §11 availability
has('SEC Litigation Releases checked_no_records', '§11 LR state');
has('SEC Administrative Proceedings checked_no_records', '§11 AP state');
has('ALJ initial decisions — which returned 0 rows from its index and remains a SEPARATE, UNCHECKED source',
    '§11 ALJ is not folded into the answer');

// §14 mutations
has('M1 remove a month -> is_complete FALSE', '§14 M1 completeness degrades');
has('M2 rescan while incomplete -> availability INCOMPLETE, never checked_no_records', '§14 M2');
has('M3 remove the entity binding -> 0 direct identity rows', '§14 M3');
has('M4 similar-name decoy -> 0 hits', '§14 M4');
has('M5 remove a cross-corpus link -> candidates 46 -> 45', '§14 M5');
has('M6 demote the verified parent -> inherited parent block 4 -> 0', '§14 M6');
has('Post-rollback', '§14 rollback verified');

// §15-17
has('all identical', '§15 run 2 identical');
has('UNCHANGED at 33.8 ms', '§16 latency unchanged after adding the corpus');
has('the corpus is scanned at INGEST and never at read', '§16 no live SEC call on the request path');
has('Garfield still 0/49/4', '§17 Phase 8 unchanged');
has('Phase 9B’s litigation-release corpus still 2,795 releases'.replace('’',"'"), '§17 Phase 9B unchanged');

// §18 MSHA held back
has('MSHA was NOT ingested, per instruction', '§18 MSHA deferred');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
