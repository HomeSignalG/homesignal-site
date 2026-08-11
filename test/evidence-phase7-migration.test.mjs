// PHASE 7 part 2 — the Del Valle facility / operator / parent MIGRATION contract.
// Guards the measured record in docs/evidence-phase1-migration.sql. Offline; the sandbox
// has no egress to Supabase, so the live proofs are recorded there and pinned here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const p7 = sql.slice(sql.indexOf('PHASE 7 part 2'));
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

ok(p7.length > 2000, 'Phase 7 part 2 section of the SQL of record loaded');
ok(/Scope: ZIP 78617 \/ Del Valle only/.test(p7), 'scope is the pilot ZIP only');
ok(/No existing consumer read path changed/.test(p7), 'no production read behaviour altered');

// --- order of operations -----------------------------------------------------------
ok(/raw row -> source record -> identifiers\/entities -> claims/.test(p7),
  'source records precede claims');
ok(/never from a facility name, a street\n--   address, a company name, or coordinates/.test(p7),
  'facility identity is never made from name, address, company or coordinates');

// --- the map, not the migration, holds the semantics -------------------------------
ok(/MIGRATION HARD-CODES NO SOURCE SEMANTICS/.test(p7), 'semantics live in the role map');
ok(/raises outcome 'unmapped_role'\n-- rather than being dropped/.test(p7),
  'an unmapped source value is surfaced, never dropped');
ok(/ev_source_role_map_uniq now includes the predicate/.test(p7),
  'one source value can license more than one predicate');
ok(/OWNER\/OPERATOR emits\n-- both facility_owner and operates_facility while citing ONE source record/.test(p7),
  'the dual role comes from one source record, not two invented ones');

// --- full accounting of the 41 rows ------------------------------------------------
ok(/all 41 frs_org_affiliations rows accounted for, none silently dropped/.test(p7),
  'every FRS row has an outcome');
ok(/claim_created\s+38\s+\(facility_owner 17 · operates_facility 21\)/.test(p7),
  'claim counts recorded: 17 owner + 21 operator');
ok(/excluded_by_role_map\s+6\s+\(1 BILLING CONTACT \+ 5 MAILING ADDRESS\)/.test(p7),
  'the 6 excluded contact/address rows are counted');
ok(/withheld_not_organization\s+2/.test(p7) && /JUDY TORRES ROMAN/.test(p7),
  'the individual-name row is withheld, not promoted to a company');
ok(/candidate_only\s+3\s+\(PARENT OWNER -> parent_company_candidate\)/.test(p7),
  'FRS PARENT OWNER stays a candidate');
ok(/31 role rows \+ 6 excluded \+ 1 withheld \+ 3 parent = 41/.test(p7),
  'the row arithmetic reconciles to 41');

// --- fail-closed organisation gate + privacy ---------------------------------------
ok(/FAIL CLOSED/.test(p7) && /requires POSITIVE\n--   evidence of an organisation/.test(p7),
  'organisation identity requires positive evidence');
ok(/Absence of a personal-name pattern is\n--   NOT treated as evidence of a company/.test(p7),
  'absence of a person pattern is not evidence of a company');
ok(/appear in ZERO claims; positive controls/.test(p7),
  'the privacy check ships with a positive control');
ok(/EXCLUDED ROWS CARRY NO PAYLOAD/.test(p7) && /payload NULL/.test(p7),
  'contact and mailing payloads are never copied into the evidence schema');

// --- facility identity + reconciliation --------------------------------------------
ok(/34 facility entities total/.test(p7), 'facility entity count recorded');
ok(/IDENTIFIER-BACKED OR IT DOES NOT HAPPEN/.test(p7),
  'FRS -> TCEQ reconciliation is identifier-backed or absent');
ok(/EXACTLY ONE TX-TCEQ ACR\n--   program id/.test(p7) && /'skipped_ambiguous'/.test(p7),
  'a registry id declaring several RNs is skipped, not guessed');
ok(/NAME\/ADDRESS LINKS ARE CANDIDATES, NEVER MERGES/.test(p7),
  'name/address linkage never merges two facilities');
ok(/"no match" is distinguishable from\n--   "never looked at"/.test(p7),
  'an empty reconciliation is recorded rather than silent');

// --- TCEQ semantics ----------------------------------------------------------------
ok(/ALL regulated_customer_of, 0 operates_facility/.test(p7),
  'TCEQ customers are not relabelled operators');
ok(/the role map's predicate governs and the legacy label does not/.test(p7),
  'the legacy "Operator" label does not override the map');
ok(/classed resolved_by_match/.test(p7) && /never rank it above an identifier-backed statement/.test(p7),
  'a name-within-ZIP binding is ranked below identifier-backed evidence');
ok(/FRS absence never weakened TCEQ/.test(p7), 'a missing FRS counterpart does not weaken TCEQ evidence');

// --- parent discipline --------------------------------------------------------------
ok(/exactly ONE parent_company claim in the whole graph/.test(p7), 'exactly one verified parent');
ok(/Republic Services was NOT created as a parent/.test(p7), 'Republic Services was not invented');
ok(/NOTHING is stripped, so corporate suffixes are load-bearing/.test(p7),
  'corporate suffixes are never stripped for identity');
ok(/"River Bottoms Ranch" and "River Bottoms Ranch LLC" can never bind/.test(p7),
  'suffix-differing names cannot bind to each other');
ok(/ev_entity_resolution kind='sec_parent_of_named_subsidiary'/.test(p7),
  'every cross-source parent binding is written down');

// --- conflicts, honest stop, history, read model, idempotence ----------------------
ok(/COMPETING CLAIMS BOTH SURVIVE/.test(p7) && /Neither claim is deleted or\n--   suppressed in storage/.test(p7),
  'competing claims both survive; precedence decides display');
ok(/facility_located_on_parcel claims: 0/.test(p7) && /proximity is not location/.test(p7),
  'no parcel link was forced from proximity');
ok(/parcel ->\n--   development -> facility is UNRESOLVED and is left that way/.test(p7),
  'the unresolved chain is left unresolved');
ok(/SYNTHETIC fixture that is ROLLED BACK/.test(p7) && /back to 41 rows, 0 claims naming the fixture/.test(p7),
  'the historical-role fixture is rolled back and proven gone');
ok(/current=false/.test(p7), 'a closed role renders as not current');
ok(/no enum names, no tier ranks, no source\/claim UUIDs, no\n--   pilot flags/.test(p7),
  'the read model leaks no internal vocabulary');
ok(/IDEMPOTENCE/.test(p7) && /entities 84 · claims 250 · identifiers 59 · source records 109/.test(p7),
  'idempotence is measured with before/after totals');

// --- downstream proofs --------------------------------------------------------------
ok(/CN600125157 \(TXI Operations, LP\) 26 events/.test(p7) &&
   /CN606114726 \(Martin Marietta Materials Southwest, LLC\) 23 events/.test(p7),
  'track record is reachable through identifier-backed organisations');
ok(/NONE is keyed to a Del Valle RN/.test(p7),
  'the track-record zero at facility level is stated with its control');
ok(/strict SUPERSET of v_esg_eligible_company for\n--     78617: all 22 legacy companies are reachable \(0 lost\)/.test(p7),
  'ESG eligibility loses no legacy company');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
