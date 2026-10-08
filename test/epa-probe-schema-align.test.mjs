// Probe ↔ ingest health alignment (2026-09-27).
//
// The probe used to call a body healthy on HTTP 200 + the text "Results" + no "Error".
// Ingest accepted any 2xx and any parseable JSON. {"Results":{}} passed both.
// Ingest now requires a recognized FRS envelope and HTTP 200. This file pins the
// parked probe SQL to the same envelope rule.
//
// Run: node test/epa-probe-schema-align.test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const aligned = readFileSync(join(root, 'docs/epa-frs-probe-schema-align.sql'), 'utf8');
const original = readFileSync(join(root, 'docs/epa-frs-probe-migration.sql'), 'utf8');
const ingest = readFileSync(join(root, 'supabase/functions/get-address-report/sources/epa-frs.ts'), 'utf8');

const failures = [];
const ok = (name, cond, detail) => {
  if (cond) console.log(`PASS — ${name}`);
  else {
    console.log(`FAIL — ${name}${detail ? `\n     ${detail}` : ''}`);
    failures.push(name);
  }
};

const executable = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const norm = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function tickBody(sql) {
  const i = sql.indexOf('create or replace function public.epa_frs_probe_tick()');
  if (i === -1) return '';
  const seg = sql.slice(i);
  const a = seg.indexOf('$function$');
  const b = seg.indexOf('$function$', a + 10);
  return a === -1 || b === -1 ? '' : seg.slice(a + 10, b);
}

const NEW = norm(tickBody(aligned));
const OLD = norm(tickBody(original));
const OLD_OK = norm(`(resp.status_code = 200
            and resp.content is not null
            and position('"Results"' in resp.content) > 0
            and position('"Error"'   in resp.content) = 0)`);
const NEW_OK = norm(`(resp.status_code = 200
            and resp.content is not null
            and position('"Results"' in resp.content) > 0
            and (position('"FRSFacility"' in resp.content) > 0
                 or position('"Facilities"' in resp.content) > 0)
            and position('"Error"'   in resp.content) = 0)`);

console.log('\n== probe harvest predicate ==');
ok('both tick bodies were found', NEW.length > 200 && OLD.length > 200);
ok('the aligned file is one transaction and does not reschedule cron or recreate the table',
   /^begin;/m.test(executable(aligned)) && /^commit;/m.test(executable(aligned))
   && !/cron\.(schedule|alter_job|unschedule)/.test(executable(aligned))
   && !/create table/i.test(executable(aligned)));
ok('the new ok predicate requires FRSFacility or Facilities inside Results',
   NEW.includes(NEW_OK) && (NEW.split(NEW_OK).length - 1) === 1);
ok('the old "Results and not Error" predicate is gone from the aligned body',
   !NEW.includes(OLD_OK));
ok('§1 PARITY: aligned tick minus the ok predicate == original tick',
   NEW.split(NEW_OK).join(OLD_OK) === OLD,
   `len ${NEW.split(NEW_OK).join(OLD_OK).length} vs ${OLD.length}`);
ok('still text-matched, never jsonb-cast',
   !/content\s*::\s*jsonb/.test(NEW) && /position\('"results"'/.test(NEW));
ok('still fires both named targets at the same radii',
   /sheridan-rural/.test(NEW) && /atlanta-dense/.test(NEW)
   && /3::numeric/.test(NEW) && /1::numeric/.test(NEW));
ok('the original migration file names the aligned SQL as the function of record',
   /epa-frs-probe-schema-align\.sql/.test(original)
   && /HARVEST PREDICATE SUPERSEDED/.test(original));

console.log('\n== ingest matches the probe on status ==');
ok('ingest treats any status other than 200 as transient',
   /if \(r\.status !== 200\) return TRANSIENT;/.test(ingest)
   && !/r\.status >= 500 \|\| r\.status === 429/.test(ingest));
ok('recognizedFrsPayload still requires Results+list or a bare FRSFacility array',
   /function recognizedFrsPayload/.test(ingest)
   && /r\.FRSFacility \?\? r\.Facilities/.test(ingest));

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — probe schema align`);
if (failures.length) process.exit(1);
