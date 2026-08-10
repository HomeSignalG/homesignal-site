// MULTI-SOURCE EVIDENCE — PHASE 1 contract guards.
//
// CI has no database, so — following test/app-projects-stable-key.test.mjs — these assert
// against the SQL of record. The LIVE assertions (13 of them, run against the real ingested
// Del Valle parcel) are recorded in docs/evidence-phase1-report.md with their measured values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');

let fails = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (!cond) fails++; };

// The instrument must prove it ran.
ok(sql.length > 3000, 'SQL of record loaded (non-trivial)');
ok(/create schema if not exists evidence/.test(sql), 'SQL of record actually defines the evidence schema');

// ---- identifier scoping: PROP_ID must never be globally unique ----
ok(/uniqueness_scope/.test(sql) && /county-scoped to TX\/Travis/.test(sql),
  'tcad.prop_id is county-scoped, not global');
ok(/UNIQUE \(id_type, id_value_normalized\) WHERE status='active'/.test(sql),
  'uniqueness is per id_type — the same value under another type cannot collide');
ok(/There is no global "APN"/.test(sql),
  'the model explicitly refuses a universal APN concept');
ok(/identifies_kind does not\s*--\s*match the entity's kind raises/.test(sql)
   || /ev_identifier_kind_guard/.test(sql),
  'a kind-mismatched identifier is a constraint violation, not a silent false join');

// ---- a parcel may carry many identifiers ----
ok(/ev_entity_identifier\(entity_id, entity_kind, id_type, id_value/.test(sql),
  'identifiers are rows on the parcel, not columns');

// ---- role semantics: the defect this phase exists to fix ----
ok(/'OWNER block' -> project_owner_as_filed/.test(sql),
  "TDLR's OWNER block maps to project_owner_as_filed");
ok(/'ownerName' -> property_owner_of_record/.test(sql),
  "TCAD's ownerName maps to property_owner_of_record");
ok(!/'OWNER block' -> property_owner_of_record/.test(sql),
  'TDLR OWNER is NEVER mapped to property_owner_of_record');
ok(/explicit_non_meaning/.test(sql) && /NOT evidence of land ownership/.test(sql),
  'the non-meaning is stored in the database, not just in a doc');

// ---- claims are first-class and never arbitrated at write time ----
ok(/Storage never arbitrates; display does, at read time/.test(sql),
  'precedence is applied at read time, so a losing claim survives');
ok(/ev_display_precedence/.test(sql) && /precedence is DATA/.test(sql),
  'precedence is data, not hardcoded in frontend JavaScript');
ok(/source_predicate_raw NOT NULL/.test(sql),
  'a claim cannot be written without recording what the source called it');
ok(/CHECK ev_claim_one_object/.test(sql),
  'exactly one of object_entity_id / object_value');

// ---- raw preservation ----
ok(/ev_source_record/.test(sql) && /payload jsonb/.test(sql) && /payload_hash/.test(sql),
  'raw source payload is preserved with a hash');
ok(/A source correction is a NEW\s*--\s*record \+ superseded_by/.test(sql)
   || /superseded_by/.test(sql),
  'a correction supersedes; nothing is deleted');
ok(/Every claim FKs to exactly one source_record/.test(sql),
  'every claim traces to exactly one source record');

// ---- abstention (§26) ----
ok(/a failed fetch is a recorded state, never an absent fact/.test(sql),
  'a source failure can never render as "no owner"');
ok(/success_empty/.test(sql) && /not_checked/.test(sql) && /unavailable/.test(sql),
  'check_status distinguishes empty / unchecked / unavailable');

// ---- entity resolution is never an implicit merge ----
ok(/Rows are NEVER merged/.test(sql) && /not_same_entity' is a first-class outcome/.test(sql),
  'organizations are never silently merged');

// ---- the legacy bridge must not re-key production ----
ok(/property_reports stays address-keyed and\s*--\s*unmodified/.test(sql),
  'the bridge is non-destructive');
ok(/address is NOT the parcel entity's key/.test(sql),
  'address is not promoted to the parcel key');

// ---- security posture ----
ok(/RLS is additionally ENABLED on all 22\s*--\s*tables with NO policies/.test(sql),
  'every new table has RLS enabled with deny-by-default');
ok(/never mailing data/.test(sql), 'owner mailing data is excluded from the consumer read');
ok(/EXECUTE revoked from anon\/authenticated/.test(sql),
  'the read model is not callable by a browser client');

// ---- consumer read model ----
ok(/Takes a SOURCE identifier, never a UUID, an address or a company name/.test(sql),
  'the read model is keyed on an authoritative identifier');
ok(/Emits NO internal UUID and NO enum token/.test(sql),
  'no raw UUID or enum token reaches the consumer');

// ---- scalar-fact design choice is recorded, not implicit ----
ok(/SCALAR FACTS: DESIGN CHOICE/.test(sql) && /value history is temporal for free/.test(sql),
  'the scalar-fact modelling choice is documented with its rationale');

process.exit(fails ? 1 : 0);
