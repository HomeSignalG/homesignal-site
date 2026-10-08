// docs/db-redundant-index-cleanup.sql drops three indexes. Offline pins that the file can
// only drop what was measured, only after the indexes that replace them are proven present,
// and always ships the statements that rebuild what it drops.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'docs/db-redundant-index-cleanup.sql'), 'utf8');
const exec = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };

const TARGETS = ['app_projects_zip_idx', 'app_projects_source_key_kind_idx', 'dc_obs_payload_gin'];
const COVERING = ['app_projects_zip_source_key_uidx', 'app_projects_zip_kind_date_idx', 'app_projects_skey_kind_id_idx'];

const drops = [...exec.matchAll(/drop index[^;]*?public\.([a-z_0-9]+)/gi)].map((m) => m[1]);
ok('drops EXACTLY the three measured indexes, nothing else', drops.length === 3 && TARGETS.every((t) => drops.includes(t)));
ok('never drops a covering index', !COVERING.some((c) => drops.includes(c)));

const guard = exec.indexOf('do $guard$');
const firstDrop = exec.search(/drop index/i);
ok('the guard runs BEFORE any drop', guard > -1 && firstDrop > guard);
ok('the guard asserts every covering index is valid with its exact definition',
   COVERING.every((c) => exec.includes(`('${c}',`)) && exec.includes('i.indisvalid and i.indisready'));
ok('the guard refuses a same-named target with another definition, or one backing a constraint',
   exec.includes('exists with an unexpected definition') && exec.includes('backs a constraint'));
ok('the guard checks for GIN-servable operators on raw_payload inside the database',
   exec.includes("raw_payload\\)?\\s*(@>|<@|\\?\\||\\?&|\\?|@\\?|@@)"));

ok('a short lock_timeout, so a drop never queues behind a long reader', /set lock_timeout = '\d+s';/.test(exec)
   && exec.indexOf('set lock_timeout') < firstDrop);
ok('no CONCURRENTLY in the executed part (the file runs as one transaction)', !/concurrently/i.test(exec));

const rollback = raw.slice(raw.indexOf('ROLLBACK / RECOVERY'));
ok('every dropped index has its rebuild statement in the rollback section',
   TARGETS.every((t) => new RegExp(`create index concurrently if not exists ${t}\\b`).test(rollback)));
ok('the surviving leading-source_key index gets a definition of record',
   /create index concurrently if not exists app_projects_skey_kind_id_idx\s*\n--\s+on public\.app_projects using btree \(source_key, record_kind, id\);/.test(rollback));

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — redundant index cleanup`);
if (failures.length) process.exit(1);
