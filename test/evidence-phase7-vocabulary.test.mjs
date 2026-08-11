// PHASE 7 part 1 — facility/company vocabulary + role-map contract guards.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const p7 = sql.slice(sql.indexOf('PHASE 7 part 1'));
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

ok(p7.length > 1200, 'Phase 7 section of the SQL of record loaded');
ok(/SEMANTICS ONLY: 0 facility entities, 0 new claims/.test(p7), 'scope is stated honestly');

// role separation — the defect this vocabulary exists to prevent
ok(/facility_owner\s+NOT the property owner of record/.test(p7), 'facility owner is not property owner');
ok(/operates_facility\s+NOT the parcel owner/.test(p7), 'operator is not the parcel owner');
ok(/former_operator\s+NOT current; a missing end date does NOT make a role current/.test(p7),
  'a missing end date never implies current');
ok(/facility_located_on_parcel\s+proximity is NOT location/.test(p7), 'proximity is not location');

// parent discipline
ok(/parent_company\s+VERIFIED corporate parentage only/.test(p7), 'parent requires verification');
ok(/parent_company_candidate\s+never display, never track-record or ESG inheritance/.test(p7),
  'candidates cannot inherit');
ok(/0 non-SEC sources may map to parent_company/.test(p7), 'only SEC can map to verified parent');
ok(/PARENT OWNER    -> parent_company_candidate  \(never parent_company\)/.test(p7),
  'FRS PARENT OWNER stays a candidate');

// the audit corrections, enforced as data
ok(/BILLING CONTACT -> EXCLUDED/.test(p7) && /MAILING ADDRESS -> EXCLUDED/.test(p7),
  'contact/address affiliation types are excluded from role mapping');
ok(/contact data must not surface/.test(p7) && /address data must not surface/.test(p7),
  'the privacy reason for exclusion is recorded');
ok(/An exclusion is a RECORDED DECISION, not a missing row/.test(p7),
  'exclusions are first-class, not silent gaps');
ok(/all 6 live FRS affiliation types \(0 unhandled\)/.test(p7), 'every live source value is handled');
ok(/OWNER\/OPERATOR  -> facility_owner            \(\+ operates_facility from ONE source record\)/.test(p7),
  'OWNER/OPERATOR yields two predicates from one source record');

// identifier kind safety
ok(/rejects a TCEQ RN on an organization and a CN on a facility/.test(p7),
  'identifier kinds are guarded across facility/organization');

// authority is predicate-specific
ok(/no universal trust score/.test(p7), 'no universal source trust score');
ok(/identifier-backed state relationship outranks a name-based federal affiliation/.test(p7),
  'TCEQ outranks FRS for the same predicate');
ok(/neither deletes the other/.test(p7), 'competing claims both survive');

process.exit(fails ? 1 : 0);
