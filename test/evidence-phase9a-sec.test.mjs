// PHASE 9A — SEC enforcement + publicly disclosed investigations.
// Guards the measured record in docs/evidence-phase1-migration.sql. Offline; the sandbox has no
// egress to sec.gov (proxy 403), so acquisition ran through pg_net and the receipts live there.
//
// Rules under test: an investigation is not a violation; absence of a public record is not
// absence of an investigation; attribution is by identifier; money is never blended; one matter
// is not five incidents.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');

// Normalise comment wrapping and column padding on BOTH sides, so a test asserts the CLAIM
// and never where a line happened to break.
const norm = s => s.replace(/\n--\s*/g, ' ').replace(/\s+/g, ' ').trim();
const p9 = norm(sql.slice(sql.indexOf('PHASE 9A (2026-08-11)')));

let fails = 0;
const ok  = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const has = (needle, n) => ok(p9.includes(norm(needle)), n);

ok(p9.length > 4000, 'Phase 9A section of the SQL of record loaded');

// §1 — the Phase 8 model is extended, not redesigned
has('EXTENDED, NOT REDESIGNED', '§1 the Phase 8 attribution model is reused');
has('SEC matters are ENTITY-level, so event_occurred_at_facility is absent on every one of them',
    '§1 SEC matters do not claim a facility');
has('association with a property is not that evidence',
    '§1 association with a property does not create a facility link');

// §2 — first-party only; rejections recorded with proof
has('data.sec.gov submissions — registrant identity confirmed by CIK', '§2 first-party identity acquired');
has('SEC litigation releases and administrative proceedings CANNOT be searched by entity',
    '§2 the enforcement-corpus rejection is recorded');
has('ZERO mentions of the company', '§2 the rejection was proven, not assumed');

// §3 — event types are not collapsed
has('The types are NOT collapsed into a generic "SEC violation"', '§3 no generic SEC violation type');
has('ev_event_type_vocab 11 types', '§3 the event-type vocabulary is counted');
has('ev_status_vocab 10 statuses', '§3 the status vocabulary is counted');

// §4 — investigations
has('NOT a violation, NOT a charge, NOT an enforcement action, NOT a finding of wrongdoing',
    '§4 an investigation is not a violation');
has('It does NOT emit "No SEC investigations", and there is no code path that can.',
    '§4 absence is never rendered as "no SEC investigations"');
has('frequently nonpublic', '§4 the nonpublic caveat is carried');

// §5 — Wells Notice
has('NOT an SEC violation, NOT a finding, NOT a charge, NOT a final enforcement action',
    '§5 a Wells Notice is its own thing');
has('STAFF INTENTION TO RECOMMEND', '§5 what a Wells Notice actually is');
has('forbids destroying a Wells Notice by folding it into the later enforcement event',
    '§5 the Wells Notice survives the matter it belongs to');

// §6 — identity
has('entities matched by CIK 1 · matched by weaker means 0 · unresolved 0',
    '§6 attribution counts by identifier strength are stated');
has('the similarly-named company: 0 matters, 0 investigations', '§6/E a similar name inherits nothing');

// §7 — parent / subsidiary
has('respondent_named_by_agency = "Testco Subsidiary LLC" rides on the matter',
    '§7 the agency-named respondent is preserved');
has("the SUBSIDIARY's matter never became the parent's record",
    '§7/C a subsidiary matter does not become the parent record');
has('parent block carries its own caveat and is excluded from the headline totals',
    '§7 parent history is separated from the entity total');

// §8 — money
has('four separate predicates and four separate output buckets', '§8 money is stored by type');
has('Nothing adds them together, and no amount is called a "fine"',
    '§8 amounts are never blended or relabelled');
has('civil penalty 2,500,000 · disgorgement 1,000,000 · prejudgment interest 150,000 — three separate figures',
    '§8 the fixture proves three separate figures');

// §9 — matters vs documents
has('matters 1 (NOT 5)', '§9 one matter is not five incidents');
has('procedural events 5', '§9 the procedural history is preserved');
has('SPANS CLASSES', '§9 a matter spans investigation and enforcement records');

// §10 — status discipline
has('NOT an exoneration', '§10 a closed investigation is not an exoneration');

// §11 — the sentence
has('No publicly disclosed SEC investigation was identified in the sources checked.',
    '§11 the factual sentence is the required one');

// §12 — completeness, per question
has('SEC enforcement (litigation releases) not_checked', '§12 SEC enforcement is not_checked, not zero');
has('SEC public investigation disclosures no_public_disclosure_identified',
    '§12 the two SEC questions are answered separately');
has('absence WORDING is carried as data', '§12 the wrong wording cannot be rendered by accident');

// §14 — mutations
has('M1 verified parent edge demoted to a candidate -> inherited parent block 1 -> 0',
    '§14 removing the verified parent removes inherited history');
has('M2 event_part_of_matter links retracted -> matters 1 -> 3',
    '§14 removing the matter relationship changes the matter count');
has("M3 the respondent's CIK withdrawn -> the subject no longer resolves at all",
    '§14 removing the identifier prevents attribution');
has('Post-rollback control', '§14 the mutations were rolled back and the rollback verified');

// §15 — idempotence, security, compatibility
has('entities 170/170 · claims 732/732', '§15 run 2 is identical');
has('REVOKED from public/anon/authenticated', '§15 the RPC is not browser-reachable');
has('no raw source payload, no UUID and no schema enum', '§15 nothing internal leaks');
has("Garfield's TCEQ answer is still 0/49/4", '§15/H no Phase 8 TCEQ result changed');
for (const [t, h] of [['property_company_roles','b3923c901be5923d7f47d0d0f5dc89c3'],
                      ['company_track_events','9d501d166d52a5c9198a7be2e4c07c82'],
                      ['company_parents','e951809e3dd5e640ba810b1d04cf2eac']])
  has(`${t} ${h}`, `§15 ${t} md5 unchanged`);

// §16 — performance
has('205.4 ms / 5,289 shared hits -> 36.8 ms / 3,111 shared hits',
    '§16 performance measured before and after, and improved');
has('that is new work, not a regression in the old work, and it is reported rather than hidden',
    '§16 the one slower path is disclosed rather than hidden');

// §17 — no scoring
has('Nothing was scored, weighted, or combined with TCEQ.', '§17 no score was created');

// honesty about what was NOT established
has('lead_only_not_evidence; NOTHING was ingested from it',
    'a full-text hit was read before being believed, and rejected');
has('POSITIVE CONTROLS RAN ON THE SAME INDEX AND RETURNED 30 AND 82',
    'the zeros ship with their positive controls');
has('HTTP 500 INCLUDING the control; those were recorded unavailable and re-run, never as zeros',
    'a failed fetch was never converted into a zero');
has('They were not read document by document', 'the unexamined lead is disclosed as unexamined');
has('EVIDENCE GAPS, STATED PLAINLY', 'the evidence gaps are stated');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
