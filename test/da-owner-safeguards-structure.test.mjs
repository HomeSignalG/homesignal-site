// THE THREE OWNER SAFEGUARDS (audit item D) — structure pins. Offline, no database.
//   docs/da-owner-safeguards.sql   A. owner removes an agent / withdraws an invite   B. the client link rate limit   C. one open checkout at a time
// The behaviour is proved elsewhere (test/da_owner_safeguards_pg against a real Postgres; the three function tests against the real handlers). This file pins
// the shape that a behavioural test cannot see: WHERE each decision lives, ORDER, and what each file is allowed to name.
// Run: node test/da-owner-safeguards-structure.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const walk = (d) => readdirSync(new URL('../' + d, import.meta.url)).flatMap((f) => { const p = d + '/' + f; return statSync(new URL('../' + p, import.meta.url)).isDirectory() ? walk(p) : [p]; });

const SQL = read('docs/da-owner-safeguards.sql');
const FUNCS = walk('supabase/functions').filter((p) => /\.ts$/.test(p));
const code = Object.fromEntries(FUNCS.map((p) => [p, noComments(read(p))]));
const naming = (needle) => FUNCS.filter((p) => code[p].includes(needle));

// ---- 1. the SQL file --------------------------------------------------------------------------------------------------------------------------------
{
  const dropLines = SQL.split('\n').filter((l) => /^-- drop /.test(l));
  ok(dropLines.length === 12 && dropLines.filter((l) => /drop table/.test(l)).length === 2 && dropLines.filter((l) => /drop function/.test(l)).length === 10, '1a the footer rolls back exactly twelve objects: ten functions and two tables');
  const created = [...SQL.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map((m) => m[1]);
  ok(created.length === 10 && dropLines.filter((l) => /drop function/.test(l)).every((l) => created.some((c) => l.includes('public.' + c + '('))), '1b every function it creates has a rollback line', created);
  ok(!/\b(alter|drop)\s+(table|function|trigger|index|constraint)[^;]*\b(brokerage_member|evaluation_|brokerage_account|billing_report_limit|report_rate_)/i.test(SQL.replace(/^--.*$/gm, '')),
    '1c it alters, drops or replaces nothing that exists: no existing table, constraint, trigger or entitlement function is touched');
  ok(!/create or replace function public\.(evaluation_|brokerage_member_guard|brokerage_membership_of|billing_(usage|plan_of|report_limit|event|paid)|report_rate_)/.test(SQL), '1d and replaces none of the functions it stands on');
  ok(/alter table public\.share_view_window\s+enable row level security/.test(SQL) && /alter table public\.billing_checkout_claim enable row level security/.test(SQL)
     && /revoke all on public\.share_view_window\s+from public, anon, authenticated, service_role/.test(SQL) && /revoke all on public\.billing_checkout_claim from public, anon, authenticated, service_role/.test(SQL),
    '1e both tables are system-only: RLS on and every privilege revoked from every role');
  ok(!/grant (select|insert|update|delete|all)[^;]*on public\.(share_view_window|billing_checkout_claim)/.test(SQL), '1f and nothing is ever granted on them');
  ok(/if public\.evaluation_report_limit\(\) <> 10 or public\.billing_report_limit\(\) <> 100/.test(SQL), '1g the post-condition refuses to apply if the founder\'s 10 and 100 moved');
  ok(!/\bemail\b|\bip\b|\baddress\b/i.test(SQL.slice(SQL.indexOf('create table if not exists public.share_view_window'), SQL.indexOf('create index if not exists share_view_window_by_start')).replace(/^\s*--.*$/gm, '')),
    '1h the rate-limit counter table has no column that could hold an email or an address');
  ok(/mem\.role <> 'agent'/.test(SQL) && /v_actor\.role <> 'owner'/.test(SQL) && /v_actor\.brokerage_id <> mem\.brokerage_id/.test(SQL), '1i removal is refused unless the asker is an owner of the same brokerage and the target is an agent');
  ok(!/delete from public\.brokerage_member|update public\.brokerage_member set (role|user_id|brokerage_id)/.test(SQL), '1j a membership is ended by status only: it is never deleted and its identity is never rewritten');
}

// ---- 2. each decision has ONE home in TypeScript ----------------------------------------------------------------------------------------------------
{
  ok(JSON.stringify(naming('brokerage_team_of')) === '["supabase/functions/_shared/evaluation-reads.ts"]' && JSON.stringify(naming('brokerage_member_remove')) === '["supabase/functions/_shared/evaluation-reads.ts"]',
    '2a only _shared/evaluation-reads.ts names the team list and the removal', [naming('brokerage_team_of'), naming('brokerage_member_remove')]);
  ok(JSON.stringify(naming('billing_checkout_')) === '["supabase/functions/_shared/billing-reads.ts"]', '2b only _shared/billing-reads.ts names the checkout slot functions', naming('billing_checkout_'));
  ok(JSON.stringify(naming("'share_view_claim'")) === '["supabase/functions/_shared/rate-reads.ts"]', '2c only _shared/rate-reads.ts names the client link claim', naming("'share_view_claim'"));
  ok(naming('share_view_window').length === 0 && naming('billing_checkout_claim').filter((p) => /rest\/v1\/billing_checkout_claim|from\(/.test(code[p])).length === 0, '2d no edge function reads either table: they are reached through the functions only');
  ok(naming('share_view_limits').length === 0 && !FUNCS.some((p) => /client:60:30|max_requests\s*[:=]\s*(30|120|300|1500|2000)\b/.test(code[p])), '2e the numbers live in the database and nowhere in TypeScript');
  ok(!FUNCS.some((p) => /\.from\(['"](brokerage_member|evaluation_invite)['"]\)|rest\/v1\/(brokerage_member|evaluation_invite)\b/.test(code[p])), '2f no edge function reads or writes the membership or invite tables directly');
}

// ---- 3. the client link: the claim comes first, and fails closed -----------------------------------------------------------------------------------
{
  const h = code['supabase/functions/view-shared-report/handler.ts'];
  ok(h.indexOf('deps.viewClaim(') > 0 && h.indexOf('deps.viewClaim(') < h.indexOf('deps.openShared('), '3a the claim is made BEFORE the link is looked up');
  ok(h.indexOf('deps.viewClaim(') < h.indexOf('deps.addressOf('), '3b and before the address is read');
  ok(/if \(!verdict\.allowed\) return reply\(req, \{ error: 'rate_limited'[^}]*\}, 429\)/.test(h), '3c a full window answers 429 rate_limited');
  ok(!/viewClaim\([^)]*\)\s*\.catch|try\s*\{[^}]*viewClaim[^}]*\}\s*catch\s*\{\s*\}/.test(h), '3d the claim\'s failure is never swallowed: it falls to the handler\'s 502');
  const d = code['supabase/functions/view-shared-report/data.ts'];
  ok(/shareClientKey\(req\.headers, cfg\.serviceKey\)/.test(d), '3e the caller\'s key is made under the service key (a salted hash, never the address)');
  const r = code['supabase/functions/_shared/rate-reads.ts'];
  ok(/if \(!secret\) throw new DataUnavailable/.test(r), '3f with no secret there is no key');
  ok(!/console\./.test(h + d + r), '3g nothing logs a caller or a link');
}

// ---- 4. the checkout: the slot is claimed before the processor is asked ------------------------------------------------------------------------------
{
  const h = code['supabase/functions/manage-billing/handler.ts'];
  ok(h.indexOf('deps.checkoutClaim(') > 0 && h.indexOf('deps.checkoutClaim(') < h.indexOf('deps.createCheckout('), '4a the slot is claimed BEFORE the processor is asked for a checkout');
  ok(h.indexOf('checkoutAvailability(usage') < h.indexOf('deps.checkoutClaim('), '4b and only for a brokerage the plan check allows (an agent, a paid brokerage or an unset processor never claims)');
  ok(/catch \(e\) \{\s*await deps\.checkoutRelease\([^)]*\)\.catch\(\(\) => \{\s*\}\);\s*throw e;/.test(h), '4c a checkout that could not be made frees the slot and re-raises the real error');
  ok(/deps\.checkoutRecord\([^)]*\)\.catch\(/.test(h), '4d recording the address is best effort: a checkout that WAS made is never lost');
  ok(/slot\.outcome === 'OPEN'\) return reply\(req, \{ status: 'OK', url: slot\.url \}\)/.test(h) && /slot\.outcome === 'BUSY'\) return reply\(req, \{ error: 'checkout_in_progress' \}, 409\)/.test(h), '4e an open checkout is given back, and a busy slot is 409');
  const b = code['supabase/functions/_shared/billing-reads.ts'];
  ok(/checkoutUrlFrom\(\{ data: \{ attributes: \{ url: r\.url \} \} \}\)/.test(b), '4f a stored address is checked against the processor\'s own domain again before a browser sees it');
}

// ---- 5. the team: the asker is the token\'s person, never a field of the request ----------------------------------------------------------------------
{
  const h = code['supabase/functions/development-activity-trial/handler.ts'];
  ok(/deps\.removeMember\(who\.userId, handle\)/.test(h) && /deps\.withdrawInvite\(who\.userId, handle\)/.test(h) && /deps\.teamOf\(who\.userId\)/.test(h), '5a all three act for the person the verified token names');
  ok(!/body[^;]*\.(actor|user|userId|user_id|p_actor)\b/.test(h), '5b and no field of the request can name another actor');
  ok(/UUID\.test\(handle\)/.test(h) && /extra\.length/.test(h), '5c a handle must be a UUID and no other field may ride with it');
  ok(/e instanceof NotEntitled\) return reply\(req, \{ error: 'not_allowed' \}, 403\)/.test(h), '5d a refusal by the database is one answer, 403 not_allowed');
  const page = read('development-activity-reports.html');
  ok(/kind === 'member' && !\(armed && armed\.btn === btn\)/.test(page) && /Press again to remove/.test(page), '5e the page asks for a SECOND press before it removes an agent');
  ok(/post\(TRIAL_FN, \{ action: 'team' \}\)/.test(page) && /post\(TRIAL_FN, payload\)/.test(page) && !/brokerage_member|evaluation_invite/.test(page), '5f the page talks only to the trial function and names no table');
  ok(/teamFresh = false; loadTeam\(\); \/\/ always read the real list again/.test(page), '5g after every change the page reads the real list again');
  ok(/if \(epoch !== sessionEpoch \|\| !session \|\| !session\.user \|\| session\.user\.id !== forUser\) return;/.test(page), '5h an answer that lands after the person changed is shown to nobody');
}

// ---- 6. wiring ---------------------------------------------------------------------------------------------------------------------------------------
{
  const wf = read('.github/workflows/report-snapshot-suite.yml');
  ok(/owner-safeguards:/.test(wf) && /test\/da_owner_safeguards_pg\/run\.sh/.test(wf) && /test\/da_owner_safeguards_pg\/mutate_all\.sh/.test(wf), '6a the suite and its mutations run in their own CI job');
  ok((wf.match(/docs\/da-owner-safeguards\.sql/g) || []).length === 2 && (wf.match(/test\/da-owner-safeguards-structure\.test\.mjs/g) || []).length === 2, '6b and both path filters (pull request and push) name the file and this test');
}

console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
