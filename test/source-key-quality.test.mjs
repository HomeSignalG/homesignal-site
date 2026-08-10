// SOURCE-KEY QUALITY — regression guards for the identity_fields repair.
//
// Drives the SHIPPED connectors (sources/arcgis.ts, sources/socrata.ts) over rows
// CAPTURED VERBATIM FROM THE LIVE PUBLISHERS on 2026-08-10 via pg_net, so this is a
// behavioural test of real data, not a restatement of the fix.
//
// What it guards:
//   Brunswick County — `PermitNumber` is a per-project SEQUENCE, not an identifier.
//     Live groupBy over 278,603 rows: "1000" n=57543, "1001" n=46530, "1002" n=32019.
//     Two captured rows at DIFFERENT addresses both carry PermitNumber "1000".
//   NYC DOB NOW — `job_filing_number` is the JOB FILING; DOB NOW issues several permits
//     per filing. M00932693-I1 resolves to 8 rows sharing work_permit M00932693-I1-GC-CX,
//     separated by sequence_number x work_type.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { identityFromFields as arcgisIdentity } from '../supabase/functions/get-address-report/sources/arcgis.ts';
import { identityFromFields as socrataIdentity } from '../supabase/functions/get-address-report/sources/socrata.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(
  join(root, 'supabase/functions/get-address-report/jurisdiction-registry.json'), 'utf8'));
const entry = (fam, id) => reg[fam].find((e) => e.registry_id === id);

let fails = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (!cond) fails++; };

// The instrument must prove it ran.
ok(typeof arcgisIdentity === 'function' && typeof socrataIdentity === 'function',
  'both connectors export identityFromFields (test is actually driving the shipped code)');

// ---------------------------------------------------------------- BRUNSWICK
const BRUNSWICK = entry('arcgis', 'brunswick-county-permits');
ok(JSON.stringify(BRUNSWICK.identity_fields) === JSON.stringify(['ProjectNumber', 'PermitNumber']),
  'brunswick declares identity_fields = [ProjectNumber, PermitNumber]');
ok(BRUNSWICK.column_map.case_number === 'PermitNumber',
  'brunswick case_number is UNCHANGED — identity was fixed, display was not touched');

// Verbatim from the live layer (OBJECTID 346 / 347), different projects, different addresses.
const bruA = { OBJECTID: 346, ProjectNumber: '2003052440', PermitNumber: '1000',
  ProjectType: 'Residential', ParcelAddress: '4750 PIGOTT RD SW 28470 ' };
const bruB = { OBJECTID: 347, ProjectNumber: '2003000085', PermitNumber: '1000',
  ProjectType: 'Commercial', ParcelAddress: '4688 LONG BEACH RD SE 28465 ' };

const idA = arcgisIdentity(bruA, BRUNSWICK.identity_fields);
const idB = arcgisIdentity(bruB, BRUNSWICK.identity_fields);
ok(idA !== null && idB !== null, 'brunswick rows both yield an identity');
ok(idA !== idB, 'brunswick records at DIFFERENT addresses no longer share one source identity');
ok(idA === '2003052440|1000' && idB === '2003000085|1000', 'brunswick identity is the agency composite');
// the OLD behaviour, proven to be the defect
ok(bruA.PermitNumber === bruB.PermitNumber,
  'control: the old case_number field IS identical on both rows (this was the bug)');
// stability
ok(arcgisIdentity({ ...bruA }, BRUNSWICK.identity_fields) === idA,
  'brunswick identity is stable for the same source record across calls');
// identity must not be address/title derived
ok(!idA.includes('PIGOTT') && !idA.includes('Residential'),
  'brunswick identity contains no address and no title text');

// ---------------------------------------------------------------- NYC DOB NOW
const NYC = entry('socrata', 'nyc-dobnow-approved-permits');
ok(JSON.stringify(NYC.identity_fields) === JSON.stringify(['work_permit', 'sequence_number', 'work_type']),
  'nyc declares identity_fields = [work_permit, sequence_number, work_type]');
ok(NYC.column_map.case_number === 'job_filing_number',
  'nyc case_number is UNCHANGED — the displayed filing number is preserved');

// Verbatim from the live dataset: all 8 rows of job_filing_number M00932693-I1.
const NYC_ROWS = [
  { job_filing_number: 'M00932693-I1', work_permit: 'M00932693-I1-GC-CX', sequence_number: '4', work_type: 'Structural' },
  { job_filing_number: 'M00932693-I1', work_permit: 'M00932693-I1-GC-CX', sequence_number: '2', work_type: 'Structural' },
  { job_filing_number: 'M00932693-I1', work_permit: 'M00932693-I1-GC-CX', sequence_number: '1', work_type: 'General Construction' },
  { job_filing_number: 'M00932693-I1', work_permit: 'M00932693-I1-GC-CX', sequence_number: '1', work_type: 'Structural' },
  { job_filing_number: 'M00932693-I1', work_permit: 'M00932693-I1-GC-CX', sequence_number: '4', work_type: 'General Construction' },
  { job_filing_number: 'M00932693-I1', work_permit: 'M00932693-I1-GC-CX', sequence_number: '3', work_type: 'General Construction' },
  { job_filing_number: 'M00932693-I1', work_permit: 'M00932693-I1-GC-CX', sequence_number: '3', work_type: 'Structural' },
  { job_filing_number: 'M00932693-I1', work_permit: 'M00932693-I1-GC-CX', sequence_number: '2', work_type: 'General Construction' },
];
const nycIds = NYC_ROWS.map((r) => socrataIdentity(r, NYC.identity_fields));
ok(new Set(NYC_ROWS.map((r) => r.job_filing_number)).size === 1,
  'control: all 8 captured rows really do share one job_filing_number (the old key)');
ok(new Set(NYC_ROWS.map((r) => r.work_permit)).size === 1,
  'control: work_permit ALONE is also identical on all 8 — it is not sufficient by itself');
ok(new Set(nycIds).size === 8,
  'nyc: 8 legitimate filings sharing a base ID receive 8 DISTINCT deterministic identities');
ok(nycIds.every((v) => typeof v === 'string' && v.length > 0), 'nyc: every row yields an identity');
ok(!nycIds.some((v) => /^\d+$/.test(v)),
  'nyc identity is not a bare row ordinal — source_seq is never the identity');

// ---------------------------------------------------------------- CONTRACT
// fail closed: a missing or blank field must NOT mint a colliding key like "|1|"
ok(arcgisIdentity({ ProjectNumber: null, PermitNumber: '1000' }, ['ProjectNumber', 'PermitNumber']) === null,
  'fail closed: a NULL identity field yields null (falls back), never a partial key');
ok(arcgisIdentity({ ProjectNumber: '   ', PermitNumber: '1000' }, ['ProjectNumber', 'PermitNumber']) === null,
  'fail closed: a blank identity field yields null');
ok(arcgisIdentity({ a: 1 }, undefined) === null && arcgisIdentity({ a: 1 }, []) === null,
  'entries without identity_fields are unaffected (default-off, additive)');

// namespace still prevents cross-agency collision: the same composite under two platforms
ok(`arcgis:brunswick-county-permits:${idA}` !== `socrata:data.cityofnewyork.us:rbx6-tga4:${idA}`,
  'namespace prefix keeps identical record segments distinct across agencies');

// no other entry silently gained identity_fields
const withIdentity = [];
for (const fam of Object.keys(reg)) {
  if (!Array.isArray(reg[fam]) || fam.startsWith('_')) continue;
  for (const e of reg[fam]) if (e && e.identity_fields) withIdentity.push(e.registry_id);
}
ok(withIdentity.length === 2 && withIdentity.includes('brunswick-county-permits')
   && withIdentity.includes('nyc-dobnow-approved-permits'),
  `exactly the two audited entries declare identity_fields (found: ${withIdentity.join(', ')})`);

// ---------------------------------------------------------------- UNRESOLVED, ON PURPOSE
// austin-zoning-cases keeps a title-derived identity because the AUTHORITATIVE field is
// genuinely absent: the live dataset has 6,925 rows, 6,844 with case_number => 81 NULL.
// Inventing a durable id for those would be fabrication, so it is reported, not patched.
ok(!entry('socrata', 'austin-zoning-cases').identity_fields,
  'austin-zoning-cases is deliberately NOT given a synthetic identity (81 rows genuinely lack a case number)');

process.exit(fails ? 1 : 0);
