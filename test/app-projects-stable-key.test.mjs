// app_projects STABLE SOURCE KEY — regression guards.
//
// The defect these guard against (measured 2026-08-10, proven by a rolled-back
// transaction on the live DB): app_refresh_zip() opened with
//   delete from public.app_projects where zip=_zip
// and property_company_roles / project_facility_refs / identity_conflicts all carry
// FK ... ON DELETE CASCADE. A refresh therefore DESTROYED downstream evidence
// (78617: roles 66->53, facility refs 33->0, conflicts 4->0) and, because
// app_projects.id is gen_random_uuid(), minted a new identity for every record.
//
// CI has no database, so — following test/app-refresh-zip-determinism.test.mjs —
// these assert against the SQL of record. The live proof (two refreshes, 537/537
// ids preserved on 78617; 1730/1730 Chicago socrata; 3635/3635 Phoenix arcgis;
// 19155/19155 Brunswick incl. its 3,664-row duplicate group) is recorded in
// docs/app-projects-stable-key-repair.md.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/app-projects-stable-key-migration.sql'), 'utf8');
// Structural checks must read CODE, not prose. This file's header quotes the very
// statement being removed ("app_refresh_zip() began with `delete from
// public.app_projects where zip=_zip`"), so counting statements over the raw text
// counts a comment as code — which is exactly how the first version of this test
// reported a false failure. Strip whole-line SQL comments for those assertions.
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};
const count = (s, re) => (s.match(re) || []).length;

// The instrument must prove it ran before its silence counts as evidence.
ok(sql.length > 5000, 'SQL of record loaded (non-trivial file)');
ok(/create or replace function public\.app_refresh_zip/.test(sql),
  'SQL of record actually contains app_refresh_zip');

// ---- 1. same source record -> same identity (derivation is deterministic) ----
ok(/create or replace function public\.app_source_key\(el jsonb\)[\s\S]*?immutable/.test(sql),
  'app_source_key is IMMUTABLE — same input always derives the same key');
ok(/when nullif\(btrim\(el->>'source_id'\),''\)\s+is not null then btrim\(el->>'source_id'\)/.test(sql),
  'connector source_id is adopted VERBATIM (never re-derived)');

// ---- 2. two agencies sharing an external id must not collide ----
ok(/'tdlr_tabs:'\|\|btrim\(el->>'project_no'\)/.test(sql),
  'TDLR keys are namespaced tdlr_tabs:<project_no>');
ok(/'epa_frs:'\|\|btrim\(el->>'registry_id'\)/.test(sql),
  'EPA FRS keys are namespaced epa_frs:<registry_id>');
// every non-source_id branch carries an explicit namespace prefix
ok(count(sql, /then '(tdlr_tabs|epa_frs):'\|\|btrim/g) === 2,
  'every hand-adapter branch prefixes a namespace — a bare external id is never the key');

// ---- 3. identity is NEVER address / title / company-name derived ----
for (const banned of ['address', 'canonical_addr', 'label', 'developer', 'owner', 'name']) {
  const re = new RegExp(`app_source_key\\(el jsonb\\)[\\s\\S]*?\\$\\$;`);
  const body = (sql.match(re) || [''])[0];
  ok(!new RegExp(`el->>'${banned}'`).test(body),
    `app_source_key never reads el->>'${banned}' (no address/title/company identity)`);
}
ok(/else null\s*\n\s*end/.test(sql),
  'a source with no defensible record id yields NULL — not a fabricated hash');

// ---- 4. the destructive pattern is gone ----
ok(!/delete from public\.app_projects where zip=_zip/.test(code),
  'the blanket "delete from app_projects where zip=_zip" is GONE from the code');

// ---- 5. refresh upserts on the stable identity ----
ok(count(sql, /on conflict \(zip, source_key, source_seq\) do update set/g) === 2,
  'both inserts (development + facility) upsert on (zip, source_key, source_seq)');
ok(/create unique index concurrently if not exists app_projects_zip_source_key_uidx[\s\S]*?\(zip, source_key, source_seq\)/.test(sql),
  'the upsert target is backed by a unique index');
ok(count(sql, /and public\.app_source_key\(d\.el\) is not null/g) === 2,
  'a keyless site is never inserted (it could not upsert, so it would duplicate every run)');

// ---- 6. NO delete of app_projects may run without the evidence guard ----
const deletes = code.split(/delete from public\.app_projects/).slice(1);
ok(deletes.length === 2, 'exactly two app_projects deletes exist (legacy sweep + stale sweep)');
for (const [i, d] of deletes.entries()) {
  const head = d.slice(0, 700);
  ok(/not exists \(select 1 from public\.property_company_roles r where r\.project_id = p\.id\)/.test(head)
    && /not exists \(select 1 from public\.project_facility_refs  ?f where f\.project_id = p\.id\)/.test(head)
    && /not exists \(select 1 from public\.identity_conflicts     ?c where c\.project_id = p\.id\)/.test(head),
    `app_projects delete #${i + 1} is guarded against all three evidence tables`);
}

// ---- 7. stale removal is explicit and watermark-driven ----
ok(/\(p\.last_seen_at is null or p\.last_seen_at < _run\)/.test(sql),
  'stale records are found by the run watermark, not by deleting everything first');
ok(/_run := clock_timestamp\(\);/.test(sql), 'the run watermark is stamped once per refresh');
ok(/stale_removed='\|\|_stale/.test(sql) && /stale_kept_referenced='\|\|_kept/.test(sql),
  'the refresh REPORTS what it removed and what it retained (no silent deletion)');

// ---- 8. adoption backfill matches only on authoritative identifiers ----
const adopt = (sql.match(/3\. ADOPTION BACKFILL[\s\S]*?4\. UNIQUE INDEX/) || [''])[0];
ok(adopt.length > 400, 'adoption backfill section located');
ok(!/\bp\.name\b|\bp\.address\b|company_key/.test(adopt),
  'adoption never matches on name, address or company_key');
ok(/btrim\(p\.registry_id\)/.test(adopt) && /p\.provenance->>'case_number'/.test(adopt),
  'adoption matches on FRS registry_id and the TABS project number only');

// ---- 9. FD-1 ordering contract preserved (identity change must not weaken it) ----
ok(count(sql, /order by md5\(el::text\)\n\s+limit 6;/g) === 2,
  'planning & civic top-6 still tie-break on the stable md5(el::text)');
ok(/order by m\.meeting_date asc, m\.id limit 8;/.test(sql),
  'meetings top-8 still tie-breaks on m.id');
ok(count(sql, /order by a\.created_at desc, a\.id limit 48;/g) === 2,
  'alerts top-48 selects still tie-break on a.id');
ok(/row_number\(\) over \(partition by public\.app_source_key\(d\.el\)\s*\n\s*order by md5\(d\.el::text\)\)/.test(sql),
  'source_seq is assigned by the stable md5(el::text) order, not by an arbitrary scan order');

// ---- 10. app_changes keeps delete+insert (nothing references it) ----
ok(/delete from public\.app_changes where zip=_zip;/.test(sql),
  'app_changes stays a pure projection (delete+insert) — it has no downstream references');

process.exit(fails ? 1 : 0);
