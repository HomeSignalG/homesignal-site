// THE SHAPE OF docs/individual-agent-signup.sql (Order L2) — offline. The executable proof is test/individual_signup_pg (a disposable Postgres, run by
// .github/workflows/individual-signup-suite.yml); this file pins what must stay true of the TEXT, so a change that the database suite could not see
// (a price, a payment word, a second account system, a missing lock-down) fails fast.
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../docs/individual-agent-signup.sql', import.meta.url), 'utf8');
const wf = readFileSync(new URL('../.github/workflows/individual-signup-suite.yml', import.meta.url), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };
// code only: the header and the rollback footer are comments, which may NAME what the file does not do
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').replace(/--[^\n]*/g, '');

ok(/PARKED: NOT APPLIED to production/.test(sql.split('\n').slice(0, 4).join('\n')), '1a the file says in its first lines that it is parked and not applied');
ok(!/\b(drop|truncate|delete\s+from)\b/i.test(code.replace(/create or replace trigger[^;]*;/gi, '')) && !/alter table[^;]*\bdrop\b/i.test(code),
  '1b it is additive: no drop, truncate or delete in its code (the rollback is a comment)');
ok(!/\b(price|79|100|subscription|checkout|lemon|webhook|payment|billing_report_limit|brokerage_paid_credit|payment_event)\b/i.test(code),
  '1c it names no price, plan size, subscription, checkout, processor or payment table: billing is untouched and reused');
ok(!/create or replace function public\.(evaluation_report_limit|billing_report_limit|brokerage_membership_of|evaluation_report_issue|evaluation_invite_mint|evaluation_invite_redeem|billing_usage)\b/i.test(code),
  '1d it replaces none of the existing functions: the 10, the 100, the resolver, the issue writer, the mint, the redeem and billing are the existing ones');
ok(!/create table/i.test(code), '1e it creates NO table: no second account, membership, credit or billing system (one column on the existing account table)');
ok(/alter table public\.brokerage_account add column if not exists account_type text not null default 'brokerage'/.test(code), '1f every existing account becomes a brokerage by the column default, in one statement');
ok(/check \(account_type in \('brokerage', 'individual'\)\)/.test(code), '1g the type vocabulary is closed to the two types');
ok(/individual_signup\(p_user_id uuid, p_name text\)/.test(code) && !/p_account_type|p_plan|p_email|p_role/.test(code.slice(code.indexOf('individual_signup'), code.indexOf('brokerage_account_type_of'))),
  '1h the signup takes exactly a user id and a name: the type, the role, the plan and the email are never an input');
ok(/email_confirmed_at is not null/.test(code) && /perform pg_advisory_xact_lock/.test(code) && /current_setting\('transaction_isolation'\) <> 'read committed'/.test(code),
  '1i it requires a confirmed email, serialises one person\'s signups, and refuses to run above READ COMMITTED');
ok(/values \(v_name, 'individual'\)/.test(code) && /values \(v_acct, p_user_id, 'owner'\)|values \(v_acct, p_user_id\b/.test(code.replace("(brokerage_id, user_id, role) values (v_acct, p_user_id, 'owner')", "values (v_acct, p_user_id, 'owner')")) && /seat_limit\) values \(v_acct, 0\)/.test(code),
  '1j it makes the account typed individual, the OWNER membership and an evaluation with 0 seats, and nothing else');
ok(/revoke all on function %s from public, anon, authenticated, service_role/.test(code) && /grant execute on function %s to service_role/.test(code) && /if not f\.is_trigger/.test(code),
  '1k every function is revoked from everyone and granted to service_role alone; trigger functions to nobody');
ok(/raise exception 'individual_agent_signup: anon or authenticated can run one of this file/.test(code), '1l the apply stops if anon or authenticated could run one of its functions');
ok(/-- ROLLBACK/.test(sql) && /only when no individual account exists/.test(sql), '1m a rollback is written, and it refuses to drop the type column while an individual account exists');
ok(/brokerage_account_type_guard_trg/.test(code) && /brokerage_member_individual_guard_trg/.test(code) && /evaluation_invite_individual_guard_trg/.test(code), '1n the three guards (type never changes, one owner only, no invites) are installed as triggers');
ok(/pull_request:/.test(wf) && /SUPABASE_DB_URL/.test(wf) && /Refuse to run if any Supabase credential is present/.test(wf) && !/secrets\./.test(wf),
  '2a the workflow runs on pull requests, addresses only a container, refuses a Supabase credential and reads no secret');
ok(/individual_signup_pg\/run\.sh/.test(wf) && /individual_signup_pg\/run-roundtrip\.sh/.test(wf), '2b it runs both the SQL suite and the real-handler round trip');
console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
