// PHASE 9B — SEC identity coverage + a completeness-proven enforcement corpus.
// Guards the measured record in docs/evidence-phase1-migration.sql. Offline; acquisition ran
// through pg_net and the receipts live in evidence.ev_sec_corpus_page / _release / _release_gap.
//
// The rule under test: checked_no_records is only legitimate when completeness is PROVEN.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const norm = s => s.replace(/\n--\s*/g, ' ').replace(/\s+/g, ' ').trim();
const p9b = norm(sql.slice(sql.indexOf('PHASE 9B (2026-08-11)')));
let fails = 0;
const ok  = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const has = (needle, n) => ok(p9b.includes(norm(needle)), n);

ok(p9b.length > 3000, 'Phase 9B section of the SQL of record loaded');
has('The Phase 9A architecture is unchanged', 'the 9A architecture was not redesigned');

// §B corpus acquisition strategy
has('acquires the WHOLE INDEX once, materializes it, and answers entity questions locally',
    '§B corpus is acquired once, not searched per entity');
has('The Property Card never issues a live SEC request', '§L no live SEC call on the request path');

// §C completeness must be proven, not assumed
has('coverage 2017-04-13 .. 2026-08-10 (LR-23803 .. LR-26606)', '§C the coverage window is exact');
has('2,795 held + 9 never-published = 2,804 = the exact span', '§C the completeness identity closes');
has('unresolved numbers 0', '§C no release number is left unresolved');
has('pages acquired 28 pages failed 0', '§C page acquisition is accounted');

// the three defects the acquisition found in itself
has('SILENT ROW DROP', 'defect 1: the parser was dropping real rows');
has('including LR-26606, which is NEWER than the maximum the corpus claimed to hold',
    'defect 1 was proven with a specific missing release');
has('PAGINATION IS NOT COMPLETENESS', 'defect 2: pagination can drop rows');
has('LR-25605 (SEC v. Cooper J. Morgen, 2023-01-04) is live at its own URL and pagination never returned it',
    'defect 2 was proven with a specific recovered release');
has('THE FAILURE BRANCH HAD NEVER RUN', 'defect 3: the failure path was untested until it fired');
has('Completeness is therefore established per RELEASE NUMBER, never per page',
    'completeness is per release number');

// §A identity
has('Matching is EXACT legal-name key against the SEC’s own registrant index'.replace('’',"'"),
    '§A identity binds on exact legal name only');
has('Fuzzy similarity is never used', '§A no fuzzy matching');
has('corporate-family (verified parent) 1 row', '§A the family mapping is recorded as family');
has('recorded as FAMILY, never as its own SEC identity',
    '§F a parent identity never becomes the subsidiary’s own');
has('no SEC registrant identified 34 rows', '§A the unresolved count is stated');
has('ARRAY(0x557db278f648)', '§A the rejected source carries its defect receipt');

// §D the enforcement result and its limits
has('ZERO matched', '§D no HomeSignal entity appears in the corpus');
has('The positive control on the same scan returned 21', '§D the zero ships with its control');
has('a different party entirely, and the similar-name negative control appearing unprompted in real data',
    '§I the similar-name control occurred in real data');
has('earned, not asserted', '§C checked_no_records was earned');
has('administrative proceedings remain a SEPARATE unchecked question',
    '§D the answer states what it does not cover');

// §G the 62 hits
has('THE 62 "CIVIL PENALTY" HITS — ALL RESOLVED, NONE AN SEC MATTER', '§G all 62 hits disposed of');
has('59 are EX-95 exhibits', '§G the 59 are identified');
has('The remaining 3 (two 2011 10-Qs and one EX-99.01) were FETCHED AND READ',
    '§G the remaining 3 were read, not inferred');
has('Zero of the 62 concern the SEC', '§G none is an SEC record');

// §J mutations
has('M1 drop one acquired page -> is_complete FALSE', '§J a failed page degrades completeness');
has('M2 rescan while incomplete -> availability degrades to INCOMPLETE, never to a zero',
    '§J incomplete coverage never becomes a zero');
has('M3 withdraw the CIK -> 0 active SEC identifiers', '§J removing the identifier stops attribution');
has('M4 demote the verified parent -> corporate-family mappings 1 -> 0',
    '§J demoting the parent removes inherited mapping');
has('Post-rollback', '§J mutations were rolled back and verified');

// §K idempotence and compatibility
has('all identical', '§K run 2 is identical');
has('no Phase 8 or Phase 9A result moved', '§K earlier phases unchanged');
has('Garfield still 0/49/4', '§K the Phase 8 answer is unchanged');

// §L performance
has('32.6 ms / 2,778 buffers with no outbound request', '§L serving is local and measured');

// remaining gaps
has('Administrative proceedings are NOT yet acquired', 'the remaining gap is stated');
has('Coverage starts 2017-04-13; earlier matters are outside the window and say so',
    'the window boundary is disclosed');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
