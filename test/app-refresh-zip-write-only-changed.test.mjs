// app_refresh_zip() must stop rewriting every app_projects row on every refresh, WITHOUT
// changing the stale-row outcome. Offline: pins the SQL OF RECORD
// (docs/app-refresh-zip-write-only-changed.sql), a splice builder run against the live body.
//
// WHY. The upserts ended `do update set <all>, last_seen_at=excluded.last_seen_at` with no
// condition and the reaper deleted `last_seen_at < _run`, so the heartbeat WAS the reaper's
// input: every row had to be rewritten to survive. Measured 2026-09-25: ~250 rewrites per
// refresh against ~245 rows per ZIP, ~349 MB WAL per sweep tick.
//
// The behavioural proof is not here (CI has no database): it is the national rollback-only
// comparison of live vs candidate over all 12,722 ZIPs and the T1-T7 scenarios, recorded in
// the PR. What this file makes impossible is the SAFETY-CRITICAL part drifting silently:
//   * the conditional update without the reaper change (valid rows deleted as stale);
//   * the reaper change without capturing BOTH statements' keys (facilities deleted);
//   * a condition list typed by hand instead of parsed from each statement's own SET list.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'docs/app-refresh-zip-write-only-changed.sql'), 'utf8');
const exec = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const failures = [];
const ok = (name, cond) => { if (cond) console.log(`PASS — ${name}`); else { console.log(`FAIL — ${name}`); failures.push(name); } };
const count = (h, n) => h.split(n).length - 1;

const b0 = exec.indexOf('create or replace function pg_temp.app_refresh_zip_write_only_changed');
const b1 = exec.indexOf('end $b$;', b0);
const builder = exec.slice(b0, b1);
ok('the builder is present', b0 > -1 && b1 > b0);

// ── fail-closed on the audited live body ──
ok('builds ONLY from the audited original body (archived copy must carry its md5)',
   exec.includes("md5(_src) <> '821a951baefc0798ad46e87de1203f95'")
   && exec.includes("elsif md5(_live) <> 'e2c6dadc2c8292a7903d8b13f037e7bc' then"));
ok('archives the pre-change body before replacing it (rollback path)',
   exec.indexOf("values ('pre-write-only-changed'") > -1
   && exec.indexOf("values ('pre-write-only-changed'") < exec.indexOf("execute _b->>'fn'"));
ok('the archive table is not anon/authenticated readable',
   /revoke all on public\.app_refresh_zip_def_archive from anon, authenticated/.test(exec)
   && /app_refresh_zip_def_archive enable row level security/.test(exec));
ok('every anchor is required EXACTLY once (no silent no-op splice)',
   count(builder, "if n <> 1 then raise exception") >= 5 && builder.includes("if n <> 2 then raise exception 'reaper predicate"));

// ── the two halves that are only safe TOGETHER ──
ok('the conditional update is emitted', builder.includes("'\\n      where ('") || builder.includes("E'\\n      where ('"));
ok('... and in the same builder the heartbeat reaper is replaced (both occurrences)',
   builder.includes("old_reap constant text := '(p.last_seen_at is null or p.last_seen_at < _run)'")
   && builder.includes('d := replace(d, old_reap, new_reap)'));
ok('the new reaper is identity-based over BOTH development and facility keys',
   builder.includes("unnest(_dk || _fk, _ds || _fs) e(k, s) where e.k = p.source_key and e.s = p.source_seq"));
ok('both upserts are rewritten (loop over exactly the two statement anchors)',
   /for i in 1\.\.2 loop/.test(builder)
   && builder.includes("karr text[] := array['_dk', '_fk']") && builder.includes("sarr text[] := array['_ds', '_fs']"));
ok('the expected keys come from the SAME src CTE that feeds the insert (one source query)',
   builder.includes("E'    with src as (\\n' || subq || E'\\n    ), ins as (\\n'") && builder.includes("'    from src t'"));
ok('the compared columns are PARSED from each statement\'s own SET list, minus last_seen_at',
   builder.includes("regexp_matches(setlist, '([a-z_]+)=excluded\\.\\1', 'g')")
   && builder.includes("where m[1] <> 'last_seen_at'"));
ok('a SET entry that is not x=excluded.x stops the build rather than being skipped',
   builder.includes("set list has a non x=excluded.x assignment"));

// ── an identical row must never reach ON CONFLICT: a skipped DO UPDATE still LOCKS the row ──
ok('identical rows are anti-joined out BEFORE the insert (no conflict, so no row lock)',
   builder.includes("E'\\n    ) v(' || inscols || E')\\n    where not exists (")
   && builder.includes("p.zip = v.zip and p.source_key = v.source_key and p.source_seq = v.source_seq"));
ok('the anti-join compares the SAME parsed columns as the conditional update',
   builder.includes("(select string_agg('p.' || c, ', ') from unnest(cols) c)")
   && builder.includes("(select string_agg('v.' || c, ', ') from unnest(cols) c)"));
ok('v is aliased with the insert\'s OWN column list, and every compared column must be in it',
   builder.includes("inscols := substr(head, position('(' in head) + 1")
   && builder.includes("compared column % is not in its insert list"));
ok('the conditional DO UPDATE is kept as the backstop behind the anti-join',
   builder.indexOf("|| E'))' || confpart") > -1 && builder.indexOf("|| E'))' || confpart") < builder.indexOf("E'\\n      where ('"));

// ── the clamp moves, it does not fork ──
ok('the post-pass condition is moved VERBATIM into one helper (substring of the live text)',
   builder.includes('cond := substr(d, a + length(pp_open), b - 1)') && builder.includes('coalesce((\\n%s\\n  ), false)'));
ok('the post-pass itself now calls that helper (one definition, two uses)',
   builder.includes("|| _helper || E'(lat, lng, _lat, _lng);\\n'"));
ok('the upsert applies the same helper to the same raw coordinate expressions',
   (builder.match(/case when %s\(%s, %s, _lat, _lng\) then null else %s end/g) || []).length === 2);

// ── scope ──
ok('SCOPE: app_changes / app_community_meta / sweep / fingerprint / skip probe untouched',
   !/create or replace (function|procedure) public\.(app_refresh_sweep|app_zip_fingerprint|app_skip_predicate)/i.test(exec)
   && !/app_changes/.test(builder) && !/app_community_meta/.test(builder) && !/cron\./.test(exec));
ok('SCOPE: no new trigger, no new index', !/create (unique )?index|create trigger/i.test(exec));
ok('apply verifies the splice took and that the build is deterministic',
   exec.includes("raise exception 'splice did not take'") && exec.includes("raise exception 'builder is not deterministic'"));

console.log(`\n${failures.length ? `FAILED: ${failures.length}` : 'ALL PASS'} — app_refresh_zip write only changed`);
if (failures.length) process.exit(1);
