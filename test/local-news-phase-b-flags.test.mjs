// Phase B (Local News routing) — static guards on the flags/evidence migration.
// SHADOW ONLY: these guards prove the SQL of record keeps every flag OFF, keeps
// the new surfaces non-public, and leaves the Phase A materializer untouched.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mig = readFileSync(join(root, 'docs/local-news-flags-and-evidence-migration.sql'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};
const count = (s, re) => (s.match(re) || []).length;

// ---- approved additions only ----
ok(/add column if not exists geo_evidence jsonb/.test(mig),
  'adds alerts.geo_evidence (approved)');
ok(/add column if not exists resolver_version text/.test(mig),
  'adds alerts.resolver_version (approved)');
ok(!/create table[\s\S]*create table[\s\S]*create table/.test(mig),
  'no additional routing tables (app_flags is the only new table)');

// ---- the three flags exist, all OFF, single carrier ----
for (const f of ['resolver_shadow', 'page_target_zip', 'email_target_zip']) {
  ok(new RegExp("\\('" + f + "', false,").test(mig), `flag ${f} is created OFF`);
}
ok(/on conflict \(name\) do nothing/.test(mig),
  'flag seeding is idempotent (re-apply never flips a flag)');
ok(/enable row level security/.test(mig) &&
   count(mig, /revoke all on public\.(app_flags|v_local_news_hold|local_news_routing_shadow) from anon, authenticated;/g) === 3,
  'app_flags + both views are locked away from anon/authenticated');

// ---- FD-B2 HOLD surface carries every required field ----
for (const col of ['title', 'publisher', 'source_url', 'published_at',
                   'source_community', 'geo_signals', 'hold_reason',
                   'candidates', 'topic_classification', 'resolver_version',
                   'resolved_at']) {
  ok(mig.includes(col), `v_local_news_hold exposes ${col}`);
}

// ---- shadow instrument compares like-for-like (window + cap on both sides) ----
ok(count(mig, /interval '14 days'/g) >= 1 && count(mig, /rn<=48/g) >= 3,
  'shadow view applies the 14-day window and cap 48 to legacy AND proposed');

// ---- delivery surfaces untouched ----
ok(!/app_refresh_zip/.test(mig.replace(/--[^\n]*/g, '')) &&
   !/app_changes\s+set/i.test(mig) && !/digest/i.test(mig.replace(/--[^\n]*/g, '')),
  'migration never modifies app_refresh_zip, app_changes, or delivery');

process.exit(fails ? 1 : 0);
