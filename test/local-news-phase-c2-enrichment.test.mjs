// Phase C2 (Local News routing) — static guards on the protected enrichment
// store's SQL of record. FD-C2: publisher text must NEVER be publicly
// accessible; FD-C1: bounded capture keyed by the alerts natural key.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = readFileSync(
  join(root, 'docs/local-news-enrichment-protected-migration.sql'), 'utf8');
const body = mig.replace(/--[^\n]*/g, ''); // statements only, comments stripped

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// ---- the table is the ONLY object created, keyed by the alerts natural key ----
ok(/create table if not exists public\.local_news_enrichment/.test(body),
  'creates public.local_news_enrichment (idempotent)');
ok((body.match(/create table/g) || []).length === 1,
  'creates exactly one table — no extra routing surfaces');
ok(/primary key \(community_id, source_url\)/.test(body),
  'keyed by the alerts natural key (community_id, source_url)');

// ---- FD-C2: locked away from every public API role ----
ok(/alter table public\.local_news_enrichment enable row level security;/.test(body),
  'RLS is enabled');
ok(!/create policy/.test(body),
  'zero policies — RLS denies all PostgREST access (engine uses service role)');
ok(/revoke all on public\.local_news_enrichment from anon, authenticated;/.test(body),
  'all grants revoked from anon + authenticated (belt and braces)');
ok(!/grant/i.test(body),
  'no grants to any public role anywhere in the migration');

// ---- FD-C1/FD-C3 contract columns present ----
for (const col of ['blob_sha256', 'blob_len', 'source_kind', 'evidence',
                   'resolver_version', 'captured_at']) {
  ok(body.includes(col), `carries contract column ${col}`);
}

// ---- never touches public alerts or the materializer ----
ok(!/alter table public\.alerts/.test(body) && !/app_refresh_zip/.test(body),
  'does not touch alerts or the Phase A materializer');

console.log();
if (fails) { console.log('FAILED: ' + fails); process.exit(1); }
console.log('ALL PHASE C2 ENRICHMENT GUARDS PASSED');
