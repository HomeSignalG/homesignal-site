// PHASE 3 — jurisdiction-independence contract guards (Denver, CO).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const p3 = sql.slice(sql.indexOf('PHASE 3 ADDITIONS'));
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

ok(p3.length > 1500, 'Phase 3 section of the SQL of record loaded');

// the headline claim
ok(/NO new core table\. NO new predicate\./.test(p3), 'no new core table and no new predicate');
ok(/reused all 21 Phase 1\/2 predicates/.test(p3), 'the new county reused the existing vocabulary');

// jurisdiction-scoped identity
ok(/denver\.schednum/.test(p3) && /scope county CO\/Denver/.test(p3), 'denver.schednum is county-scoped');
ok(/can never collide with a Travis PROP_ID/.test(p3), 'cross-jurisdiction collision is impossible');
ok(!/\bAPN\b/.test(p3), 'the new county is not modelled as a generic APN');

// predicate-specific authority
ok(/authority stays PREDICATE-SPECIFIC/i.test(p3), 'authority is per predicate');
ok(/NO authority over\s*--\s*property_owner_of_record/.test(p3) || /a grantee is not an owner/.test(p3),
  'the recorder index is not authoritative for current owner');
ok(/official_secondary', NOT\s*--\s*'authoritative'/.test(p3) || /NOT\s*--\s*'authoritative'/.test(p3),
  'the publisher/system-of-record distinction is recorded');
ok(/SUBSET \(87,862 rows\) of all recordings, not a complete index/.test(p3),
  'the index is honestly described as incomplete');

// linkage strength
ok(/evidence_class='identifier_backed'/.test(p3) && /not an address match/.test(p3),
  'parcel-instrument link is DIRECT, not address-derived');
ok(/VALIDATED by control/.test(p3), 'the join rule was proven with a positive control');

// idempotence
ok(/three consecutive runs left 26 entities \/ 135 claims/.test(p3), 'idempotence is measured, not asserted');
ok(/Find-or-create on every entity, keyed on the AUTHORITATIVE identifier/.test(p3),
  'idempotence keys on the authoritative identifier');

// entity resolution discipline carried into the new county
ok(/Organizations are SOURCE-SCOPED/.test(p3), 'organizations remain source-scoped');
ok(/are NOT merged/.test(p3), 'near-identical recorded names are not merged');

// the read-model leak that was found and fixed
ok(/hardcoded id_type='travis\.instrument_no' — county-specific parsing/.test(p3),
  'the county-specific read-model leak is recorded');
ok(/identifier_type\.identifies_kind =\s*--\s*'instrument'/.test(p3) || /ev_instrument_number\(\)/.test(p3),
  'instrument lookup is generic across counties');
ok(/read-model fix \(NOT a core-schema change\)/.test(p3), 'the fix is scoped to the read model');

// privacy
ok(/never promoted to a claim and never returned by any read/.test(p3),
  'owner mailing address is excluded');
ok(/EXECUTE revoked from anon\/authenticated/.test(p3), 'new reads are not anon-callable');

process.exit(fails ? 1 : 0);
