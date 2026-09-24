// dev_refresh_collect() must evaluate each HTTP response ONCE — never replay it on a
// later tick merely because it is still inside the 20-minute scan window.
//
// Offline: CI has no database, so this pins the SQL OF RECORD
// (docs/dev-refresh-collect-once-per-response.sql) against the body it superseded
// (docs/epa-decouple-phase1b-split-write.sql), and models the tick loop.
//
// WHY. Every step used to re-derive its input from "status 200, last 20 minutes, newest
// per ZIP". Job 14 ticks every 2 minutes, so each response was re-evaluated ~10 times:
// measured 2026-09-24, 1,401 responses -> 12,070 evaluations (avg 8.62, median 10), each
// accepted replay rewriting the whole `sites` array. The fix is a per-ZIP cursor,
// development_reports.last_collected_response_id, set for EVERY evaluated response
// (accepted or refused) in the same transaction as its diagnostics.
//
// THE STRONGEST PIN IS §1: remove the known additions from the new body and the old
// resp CTEs from the parked one, and the two must be IDENTICAL. That is what proves no
// guard, diagnostic or write expression moved.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawNew = readFileSync(join(root, 'docs/dev-refresh-collect-once-per-response.sql'), 'utf8');
const rawOld = readFileSync(join(root, 'docs/epa-decouple-phase1b-split-write.sql'), 'utf8');

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };

function collectBody(sql) {
  const i = sql.indexOf('create or replace function public.dev_refresh_collect()');
  if (i === -1) return '';
  const seg = sql.slice(i);
  const a = seg.indexOf('$function$');
  const b = seg.indexOf('$function$', a + 10);
  return a === -1 || b === -1 ? '' : seg.slice(a + 10, b);
}
/** Comments removed (whole-line AND trailing), whitespace collapsed, lower-cased. */
const norm = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const newBody = collectBody(rawNew);
const oldBody = collectBody(rawOld);
const N = norm(newBody);
const O = norm(oldBody);
ok('both bodies were found', N.length > 1000 && O.length > 1000);

// ─────────── §1 nothing but the named additions changed ───────────
const OLD_RESP = norm(`with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  )`);
const NEW_RESP = norm(`with resp as (
    select r.id as rid, r.content::jsonb as j
    from net._http_response r
    where r.id = any(_ids)
  )`);
const count = (h, n) => h.split(n).length - 1;
ok('the old body had exactly 4 window-derived resp CTEs', count(O, OLD_RESP) === 4);
ok('the new body has exactly 4 id-set resp CTEs', count(N, NEW_RESP) === 4);
ok('the new body has NO window-derived resp CTE left', count(N, OLD_RESP) === 0);

const ADDITIONS = [
  norm(`_ids bigint[];`),
  norm(`if not pg_try_advisory_xact_lock(hashtext('public.dev_refresh_collect')) then
    return 0;
  end if;`),
  norm(`select coalesce(array_agg(c.id order by c.id), '{}')
    into _ids
  from (
    select distinct on (content::jsonb->>'zip') id, content::jsonb->>'zip' as zip
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  ) c
  join public.development_reports d on d.zip = c.zip
  where c.id > coalesce(d.last_collected_response_id, 0);
  if cardinality(_ids) = 0 then
    return 0;
  end if;`),
  norm(`last_collected_response_id = resp.rid,`),
  norm(`and coalesce(d.last_collected_response_id, 0) < resp.rid`),
  norm(`update public.development_reports d
     set last_collected_response_id = r.id
    from net._http_response r
   where r.id = any(_ids)
     and d.zip = (r.content::jsonb->>'zip')
     and coalesce(d.last_collected_response_id, 0) < r.id;`),
];
for (const [i, a] of ADDITIONS.entries()) ok(`addition ${i + 1} appears exactly once`, count(N, a) === 1);

let stripped = N;
for (const a of ADDITIONS) stripped = stripped.split(a).join(' ');
stripped = stripped.split(NEW_RESP).join('<RESP>').replace(/\s+/g, ' ').trim();
const oldMarked = O.split(OLD_RESP).join('<RESP>').replace(/\s+/g, ' ').trim();
ok('§1 PARITY: new body minus the named additions == superseded body (every guard/diagnostic/write unchanged)',
   stripped === oldMarked);

// ─────────── §2 the lifecycle, structurally ───────────
ok('ONE response set: the scan window appears exactly once (step 0), not per step',
   count(N, `created > now() - interval '20 minutes'`) === 1);
ok('five consumers read the single id set (a, b, c, d, e)', count(N, 'r.id = any(_ids)') === 5);
ok('eligibility is newer-than-cursor, not in-window',
   N.includes('where c.id > coalesce(d.last_collected_response_id, 0)'));
ok('the lock is TRANSACTION-scoped (released with the commit/rollback that decides everything)',
   N.includes('pg_try_advisory_xact_lock') && !/pg_try_advisory_lock\(/.test(N));

// (e) must touch the cursor and NOTHING resident-facing: a refusal still leaves the ZIP
// stale so the unchanged fire side retries it with a FRESH request.
const e = N.slice(N.lastIndexOf('update public.development_reports d set last_collected_response_id = r.id'));
const eSet = e.slice(0, e.indexOf(' from '));
ok('(e) SET clause is exactly the cursor', eSet === 'update public.development_reports d set last_collected_response_id = r.id');
ok('(e) runs AFTER the write and its row count', N.indexOf('get diagnostics n = row_count') < N.lastIndexOf('set last_collected_response_id = r.id'));
ok('return value is still the accepted-write count', /get diagnostics n = row_count;.*return n; end\s*$/.test(N));

const exec = rawNew.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
ok('column + function ship in ONE transaction', /^begin;/m.test(exec) && /^commit;/m.test(exec)
   && exec.indexOf('add column if not exists last_collected_response_id bigint') < exec.indexOf('create or replace function public.dev_refresh_collect()'));
ok('no backfill of the cursor (NULL = not yet evaluated is the safe state)',
   !/update\s+public\.development_reports\s+set\s+last_collected_response_id/i.test(exec.replace(collectBody(rawNew), '')));
ok('SCOPE: the fire side, tick, cadence and materializer are not redefined',
   !/create or replace function public\.(dev_refresh_fire_batch|dev_refresh_tick|dev_refresh_log_fire_failures|app_refresh_zip|app_refresh_sweep)/i.test(exec)
   && !/cron\.(schedule|alter_job|unschedule)/.test(exec));

// ─────────── §3 the tick loop, modelled ───────────
// ticks every 2 min; a response is in-window for 20 min; the old collector evaluates the
// newest in-window response per ZIP on every tick, the new one only if id > cursor.
function simulate({ once, responses, ticks }) {
  const cursor = new Map(); const evals = new Map();
  for (const t of ticks) {
    const newest = new Map();
    for (const r of responses) if (r.at < t && r.at > t - 20)
      if (!newest.has(r.zip) || newest.get(r.zip).id < r.id) newest.set(r.zip, r);
    for (const r of newest.values()) {
      if (once && !(r.id > (cursor.get(r.zip) ?? 0))) continue;
      evals.set(r.id, (evals.get(r.id) ?? 0) + 1);
      cursor.set(r.zip, r.id);        // accepted OR refused: fully evaluated either way
    }
  }
  return evals;
}
const ticks = Array.from({ length: 60 }, (_, i) => i * 2 + 1);
const responses = [
  { id: 1, zip: 'A', at: 0.5 }, { id: 2, zip: 'B', at: 3.5 },
  { id: 3, zip: 'B', at: 25.5 },   // a FRESH request for B after the cooldown — the retry path
  { id: 5, zip: 'C', at: 40.5 }, { id: 4, zip: 'C', at: 41.5 }, // an older id landing late
];
const oldE = simulate({ once: false, responses, ticks });
const newE = simulate({ once: true, responses, ticks });
ok('MODEL old: a response is re-evaluated on ~10 ticks (the measured median)', oldE.get(1) === 10);
ok('MODEL new: every newest response is evaluated exactly once', [1, 2, 3, 5].every((id) => newE.get(id) === 1));
ok('MODEL new: a fresh request for the same ZIP is independently eligible (retry = new response)', newE.get(3) === 1);
ok('MODEL new: an older id landing after a newer one was evaluated is skipped, as "newest per ZIP" always did', !newE.has(4));

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — dev_refresh_collect once per response`);
if (failures.length) process.exit(1);
