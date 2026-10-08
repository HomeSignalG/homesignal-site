// ONE PROSPECT MAY HOLD SEVERAL PREMIUM INTERESTS — the uniqueness contract, pinned.
// Run: node test/premium-multi-interest.test.mjs
//
// WHAT WAS BROKEN. UNIQUE(email) + `on conflict (email) do nothing` meant ONE ROW PER
// EMAIL, first touch wins. A visitor who asked about ZIP 78617 and later about
// 96 ISLAND DR was recorded once. Measured on production before the change: the second
// call answered {"ok":true} and the row was then silently discarded — the loss was
// invisible from the client, which is what let it survive.
//
// THE TWO WRONG FIXES, both pinned against here because each looks reasonable:
//   1. `DO UPDATE` — replaces the first signal with the latest. Same loss, reversed.
//   2. reverting to UNIQUE(email) — the defect itself.
//
// §3 does not read SQL text for the semantics; it EXECUTES the shipped key rule
// (transcribed once, and pinned against the DDL of record in §2f) over the founder's
// acceptance cases, because "the file says COALESCE" and "a generic interest dedupes"
// are different claims and only the second one is the product.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail)); }
};

const sql = read('docs/premium-waitlist-capture.sql');
const acq = read('acquisition.html');
// Comments are stripped where the question is "does the SQL DO this", so a line that
// only NARRATES the old contract in order to forbid it cannot fail an assertion — the
// file deliberately quotes `DO UPDATE` and `UNIQUE(email)` in order to rule them out.
const exec = sql.replace(/^\s*--.*$/gm, '');

// ── 1. THE KEY IS THE PAIR, AND THE OLD KEY IS GONE ──────────────────────────────────
ok(/unique \(email, interest_key\)/.test(exec),
  '1a the contract is UNIQUE (email, interest_key)');
ok(/drop constraint if exists app_premium_waitlist_email_key/.test(exec),
  '1b the old UNIQUE(email) constraint is explicitly dropped');
ok(!/add constraint app_premium_waitlist_email_key unique \(email\)/.test(exec),
  '1c nothing re-adds UNIQUE(email)');
ok(/on conflict \(email, interest_key\) do nothing/.test(exec),
  '1d the write arbitrates on the pair');
ok(!/on conflict \(email\) do nothing/.test(exec),
  '1e no write still arbitrates on email alone');
// THE SECOND WRONG FIX. DO UPDATE would overwrite the first context with the newest —
// the same history loss, reached from the other direction.
ok(!/on conflict[^;]*do update/i.test(exec),
  '1f no conflict clause was turned into DO UPDATE');

// ── 2. ONE COMPUTATION SITE ──────────────────────────────────────────────────────────
// The trigger is the only writer of interest_key, so an RPC call and a direct
// service-role insert cannot disagree, and no second copy of the rule can drift.
ok(/new\.interest_key := public\.hs_premium_interest_key\(new\.source, new\.zip, new\.address\);/.test(exec),
  '2a the normalize trigger computes interest_key');
ok((exec.match(/:=\s*public\.hs_premium_interest_key\(/g) || []).length === 1,
  '2b …and it is the ONLY assignment site',
  (exec.match(/:=\s*public\.hs_premium_interest_key\(/g) || []));
ok(/create or replace function public\.hs_premium_interest_key/.test(exec)
   && /create or replace function public\.hs_premium_fold_address/.test(exec),
  '2c both key functions are defined in the DDL of record');
ok(/immutable/.test(exec), '2d the key functions are IMMUTABLE (a key must be deterministic)');
// The caller may not supply a key of its own — the insert names only the four inputs.
ok(/insert into public\.app_premium_waitlist \(email, source, zip, address\)/.test(exec)
   && !/insert into public\.app_premium_waitlist \([^)]*interest_key/.test(exec),
  '2e the public write path cannot submit an interest_key');

// The executable shapes the SQL declares, transcribed once here. §2f pins that this
// transcription still matches the shipped file, so §3 cannot drift from production.
const FOLD_SRC = "upper(coalesce(p_address, '')), '[^A-Z0-9 ]', '', 'g'";
const KEY_SRC  = "lower(coalesce(p_source, ''))";
ok(exec.includes(FOLD_SRC), '2f1 shipped fold: ' + FOLD_SRC);
ok(exec.includes(KEY_SRC),  '2f2 shipped key: ' + KEY_SRC);
ok(/\|\| '\|' \|\| coalesce\(p_zip, ''\)/.test(exec)
   && /\|\| '\|' \|\| public\.hs_premium_fold_address\(p_address\)/.test(exec),
  '2f3 shipped key joins source | zip | folded address');
// COALESCE is load-bearing: Postgres treats NULLs as DISTINCT in a unique index, so a
// key over the raw nullable columns would never dedupe a generic (zip-less,
// address-less) interest. Case E would fail silently.
{
  // Scoped to the two KEY functions. The RPC coalesces the same parameter names for its
  // own validation, so a file-wide count measures the wrong thing — a pin has to be
  // scoped to the statement it is about.
  const keyFns = (exec.match(/create or replace function public\.hs_premium_(?:fold_address|interest_key)[\s\S]*?\$\$;/g) || []).join('\n');
  ok(keyFns.length > 0, '2g0 the key functions were located (the pin below is not vacuous)');
  ok(/coalesce\(p_source, ''\)/.test(keyFns)
     && /coalesce\(p_zip, ''\)/.test(keyFns)
     && /coalesce\(p_address, ''\)/.test(keyFns),
    '2g all three key inputs are COALESCEd, so NULLs cannot make every generic interest distinct');
}

// ── 3. THE FOUNDER'S ACCEPTANCE CASES, RUN ───────────────────────────────────────────
const fold = (a) => String(a == null ? '' : a).toUpperCase()
  .replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const key = (src, zip, addr) =>
  String(src == null ? '' : src).toLowerCase() + '|' + (zip == null ? '' : zip) + '|' + fold(addr);
// One row per (email, interest_key) — the same rule the unique index applies. The pair
// is JSON-encoded rather than string-joined so no separator can collide with the key's
// own '|' delimiter and merge two cases by accident.
const records = (subs) => new Set(subs.map((s) => JSON.stringify([s[0], key(s[1], s[2], s[3])]))).size;

const P = 'Property Insights', Z = 'ZIP Community Profile', E = 'a@x.co';
ok(records([[E,P,'78657','96 ISLAND DR'],[E,P,'78657','96 ISLAND DR'],[E,P,'78657','96 ISLAND DR']]) === 1,
  'A exact duplicate submitted 3x -> ONE interest record');
ok(records([[E,Z,'78617',null],[E,P,'78657','96 ISLAND DR']]) === 2,
  'B same email, different feature -> TWO interest records');
ok(records([[E,P,'78657','96 ISLAND DR'],[E,P,'78617','13313 COOMES DR']]) === 2,
  'C same email, same feature, different property -> TWO');
ok(records([[E,Z,'78617',null],[E,Z,'78657',null]]) === 2,
  'D same email, same ZIP feature, different ZIP -> TWO');
ok(records([[E,'/dashboard.html',null,null],[E,'/dashboard.html',null,null],[E,'/dashboard.html',null,null]]) === 1,
  'E generic Premium (no zip, no address) submitted 3x -> ONE');
ok(records([[E,P,'78657','96 ISLAND DR'],[E,P,'78657','96 Island Dr'],[E,P,'78657','96 island dr'],
            [E,P,'78657','96 Island Dr.'],[E,P,'78657','  96   ISLAND   DR  ']]) === 1,
  'F 5 case / whitespace / punctuation forms -> ONE identity');
// THE DOCUMENTED LIMIT, pinned as an EXPECTED INEQUALITY rather than left implicit.
// The light fold does not expand abbreviations. Asserting it keeps the limitation
// honest and makes any future claim of equivalence fail loudly instead of drifting in.
ok(key(P,'78657','96 ISLAND DRIVE') !== key(P,'78657','96 ISLAND DR'),
  'F2 DRIVE and DR are NOT equivalent under the Fix 15 light fold (documented limit)');
ok(/96 ISLAND DRIVE/.test(sql) && /abbreviation/i.test(sql),
  'F3 …and that limit is written down in the DDL of record');
// Different people are never merged, whatever their interests.
ok(records([['x@y.co',P,'78657','96 ISLAND DR'],['z@y.co',P,'78657','96 ISLAND DR']]) === 2,
  'G two people wanting the same property are two records');
// Same street line in two ZIPs is two places.
ok(key(P,'78657','96 ISLAND DR') !== key(P,'78617','96 ISLAND DR'),
  'H the same street line in a different ZIP is a different interest');

// ── 4. THE KPI CANNOT DRIFT FROM WHAT ITS LABEL SAYS ─────────────────────────────────
// `total` and `prospects` were necessarily EQUAL while UNIQUE(email) stood, so the
// "Premium prospects" tile was accidentally right reading count(*). Once one email can
// hold two interests they diverge, and a tile left on `total` would silently start
// counting signals while still saying people.
ok(/'prospects', \(select count\(distinct email\) from public\.app_premium_waitlist\)/.test(exec),
  '4a the admin read exposes prospects as count(distinct email)');
ok(/'total',\s+\(select count\(\*\) from public\.app_premium_waitlist\)/.test(exec),
  '4b …and total as count(*)');
ok(/liveTile\('Premium prospects', w\.prospects/.test(acq),
  '4c the "Premium prospects" tile reads prospects, NOT total');
ok(!/liveTile\('Premium prospects', w\.total/.test(acq),
  '4d …and nothing points that tile back at the row count');
ok(/liveTile\('Interest signals', w\.total/.test(acq),
  '4e "Interest signals" is shown beside it, reading total');
ok((acq.match(/rpc\('hs_premium_waitlist'\)/g) || []).length === 1,
  '4f both still come from ONE call over ONE table, so they cannot disagree');
ok(/one row per person per interest/i.test(acq),
  '4g the tab explains that one person can appear more than once');

// ── 5. THE MIGRATION IS SAFE BY CONSTRUCTION, NOT BY LUCK ────────────────────────────
ok(/PRECHECK b: % row\(s\) would collide/.test(sql),
  '5a the migration PROVES zero collisions before swapping the constraint');
ok(sql.indexOf('PRECHECK b') < sql.indexOf('drop constraint if exists app_premium_waitlist_email_key'),
  '5b …and that proof runs BEFORE the swap, so a failure rolls back with the old key intact');
ok(/set interest_key = public\.hs_premium_interest_key\(source, zip, address\)/.test(exec),
  '5c existing rows are backfilled deterministically from the values already stored');
// THE DESTRUCTIVE SHAPE, pinned by what it is keyed ON rather than by whether a DELETE
// exists at all. The file legitimately collapses rows that normalization made identical;
// what it must never do again is collapse on EMAIL ALONE, which was correct under
// UNIQUE(email) and would now delete every second interest a prospect holds. Replaying
// this file is the whole point of a parked DDL, so the clause has to move with the
// contract — this assertion is what caught it still carrying the old one.
{
  const deletes = exec.match(/delete from public\.app_premium_waitlist[\s\S]*?;/g) || [];
  ok(deletes.every((d) => /a\.interest_key = b\.interest_key/.test(d)),
    '5d no DELETE collapses rows on email alone — every one is scoped to the interest', deletes);
}
ok(!/set source =|set zip =|set address =/.test(exec),
  '5e no stored source / zip / address is rewritten — legacy context is never relabelled');

// ── 6. SECURITY POSTURE UNCHANGED ────────────────────────────────────────────────────
ok(/revoke all on table public\.app_premium_waitlist from anon, authenticated;/.test(exec),
  '6a the public roles still hold NO privilege on the table');
ok(/grant execute on function public\.hs_premium_waitlist_join\(text, text, text, text\) to anon, authenticated;/.test(exec),
  '6b the one public write path is still the RPC');
ok(/revoke all on function public\.hs_premium_waitlist\(int\) from anon;/.test(exec)
   && /grant execute on function public\.hs_premium_waitlist\(int\) to authenticated;/.test(exec),
  '6c the admin read is still authenticated-only');
ok(/dashboard_admins/.test(exec), '6d …and still gated on dashboard_admins');
// The uniform response is what stops the RPC being an email-existence oracle. Widening
// the key must not add one: a repeat of a held interest still answers exactly as a new one.
ok((exec.match(/jsonb_build_object\('ok', true, 'email', e\)/g) || []).length === 1,
  '6e the RPC still has exactly one, uniform success response — no existence oracle');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
