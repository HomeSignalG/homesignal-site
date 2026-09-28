// MAP 1 MARKERS: AUTHORITATIVE REQUIRED — structural pins for the PARKED splice.
// The files are docs/map1-markers-authoritative-only.sql and
// docs/map1-markers-authoritative-only.rollback.sql. They are NOT applied from
// this PR. They are NOT wired into n5-rpc-apply.yml.
//
// Founder lock (2026-09-27): do not unlist ~1,005 map pages just because they
// have plants and no new construction. That was Unit 1; it is rejected. This
// splice does not touch indexable.
//
// Run: node test/map1-markers-authoritative-only.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d ? '  [' + d + ']' : '')); } };
const ROOT = new URL('..', import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const collapse = (s) => s.replace(/\s+/g, ' ');
// SQL headers wrap the lock across `--` comment lines. Strip the comment
// prefix so collapse() can match the lock as one sentence.
const lockHaystack = (s) => collapse(s.replace(/^[ \t]*--[ \t]?/gm, ''));

const APPLY_PATH = 'docs/map1-markers-authoritative-only.sql';
const ROLL_PATH = 'docs/map1-markers-authoritative-only.rollback.sql';
const UNIT1_PATH = 'docs/epa-decouple-phase2-unit1-core-completion-markers.sql';
const WF_PATH = '.github/workflows/n5-rpc-apply.yml';
const PUB_PATH = '.github/workflows/n5-generation-publish-suite.yml';

ok(existsSync(join(ROOT, APPLY_PATH)) && existsSync(join(ROOT, ROLL_PATH)),
  '0: parked apply and rollback files exist');

const APPLY = read(APPLY_PATH);
const ROLLBACK = read(ROLL_PATH);
const A = stripSql(APPLY);
const R = stripSql(ROLLBACK);
const LOCK = "Do not unlist ~1,005 map pages just because they have plants and no new construction. 'Nothing is being built' is a valid answer. Those pages stay listed. This was the old Unit 1 idea; it is rejected.";
const PRE = '4918783a335244d4a7056b4922120c1c';
const POST = 'fa496fa442ead50e82ab1eb72a0eb4cc';
const NPRE_MD5 = 'fe546ba33fdd0e640912c886dc07be20';
const NPOST_MD5 = '2066a57867874b2cb908b86565adbf7f';
const IDENTITY = "public.app_zip_projects_markers(text,text,boolean)";

// ── parked, not applied ──────────────────────────────────────────────────────────────────────────
ok(/^-- .*PARKED, NOT APPLIED/m.test(APPLY) && /Do not apply this file to production from this PR/.test(APPLY)
   && /Do not add it to[\s\S]*?\.github\/workflows\/n5-rpc-apply\.yml/.test(APPLY),
  'P1: apply header says PARKED / do not apply / do not add to n5-rpc-apply.yml');
ok(/PARKED, NOT APPLIED/.test(ROLLBACK),
  'P2: rollback header says PARKED, NOT APPLIED');
ok(/^do \$splice\$/m.test(APPLY) && /\$splice\$;\s*$/.test(APPLY),
  'P3: apply is one do $splice$ block');
ok(/^do \$unsplice\$/m.test(ROLLBACK) && /\$unsplice\$;\s*$/.test(ROLLBACK),
  'P4: rollback is one do $unsplice$ block');

// ── founder lock: not Unit 1 ─────────────────────────────────────────────────────────────────────
ok(lockHaystack(APPLY).includes(LOCK) && lockHaystack(ROLLBACK).includes(LOCK),
  'L1: both SQL headers quote the founder lock that plant-only pages stay listed');
ok(!/\bindexable\b/.test(A) && !/\b_nfc\b/.test(A) && !/\bapp_refresh_zip\b/.test(A)
   && !/\bindexable\b/.test(R) && !/\b_nfc\b/.test(R) && !/\bapp_refresh_zip\b/.test(R),
  'L2: executable SQL does not touch indexable, _nfc, or app_refresh_zip');
const U1 = read(UNIT1_PATH);
ok(/raise exception 'PHASE 2 UNIT 1 IS REJECTED \(founder, 2026-09-27\): EPA-only ZIPs stay indexable\. Do not apply this file\.'/.test(U1),
  'L3: Unit 1 still raises PHASE 2 UNIT 1 IS REJECTED before any statement (pin the raise, not the stale executable comment)');
ok(lockHaystack(U1).includes(LOCK),
  'L4: Unit 1 file still quotes the same founder lock');

// ── identity, fingerprints, lock ─────────────────────────────────────────────────────────────────
ok(A.includes("fn        constant regprocedure := '" + IDENTITY + "'::regprocedure")
   && R.includes("fn        constant regprocedure := '" + IDENTITY + "'::regprocedure"),
  'I1: identity is public.app_zip_projects_markers(text,text,boolean) on both files');
ok(A.includes("pre_md5   constant text := '" + PRE + "'")
   && A.includes("post_md5  constant text := '" + POST + "'")
   && R.includes("pre_md5   constant text := '" + PRE + "'")
   && R.includes("post_md5  constant text := '" + POST + "'"),
  'I2: pre_md5 4918783a… and post_md5 fa496fa4… on both files');
ok(/perform set_config\('lock_timeout', '5s', true\)/.test(A)
   && /perform set_config\('lock_timeout', '5s', true\)/.test(R),
  'I3: lock_timeout 5s on both files');

// ── already-applied / half-applied / drift ───────────────────────────────────────────────────────
ok(/already applied \(body md5 %, DEFAULT true\)/.test(APPLY)
   && /half-applied \(body is post-state, DEFAULT is not true\)/.test(APPLY)
   && /the live body drifted \(md5 %, expected %\)/.test(APPLY)
   && /half-applied \(body is pre-state, DEFAULT false missing\)/.test(APPLY)
   && /half-applied \(body is pre-state, DEFAULT true present\)/.test(APPLY),
  'G1: apply refuses already-applied (body+DEFAULT), half-applied either way, and drift');
ok(/already at the pre-state \(body md5 %, DEFAULT false\)/.test(ROLLBACK)
   && /half-applied \(body is pre-state, DEFAULT is not false\)/.test(ROLLBACK)
   && /the live body drifted \(md5 %, expected %\)/.test(ROLLBACK)
   && /half-applied \(body is post-state, DEFAULT true missing\)/.test(ROLLBACK)
   && /half-applied \(body is post-state, DEFAULT false still present\)/.test(ROLLBACK),
  'G2: rollback refuses already-at-pre (body+DEFAULT), half-applied either way, and drift');

// ── attributes omit arguments ────────────────────────────────────────────────────────────────────
ok(!/pg_get_function_arguments/.test(A) && !/pg_get_function_arguments/.test(R),
  'A1: executable SQL omits pg_get_function_arguments (DEFAULT false -> true is the intended change)');
ok(/pg_get_function_arguments omitted/.test(APPLY) && /pg_get_function_arguments omitted/.test(ROLLBACK),
  'A2: a comment records why arguments are omitted (positive control that the pin is about the concat, not silence)');
ok(/concat_ws\(' \| ', p\.proowner::regrole::text, coalesce\(p\.proacl::text, '\(default\)'\),\s+array_to_string\(p\.proconfig, ','\), p\.prosecdef::text, p\.provolatile::text,\s+p\.proparallel::text, p\.prorettype::regtype::text\)/.test(A)
   && /concat_ws\(' \| ', p\.proowner::regrole::text, coalesce\(p\.proacl::text, '\(default\)'\),\s+array_to_string\(p\.proconfig, ','\), p\.prosecdef::text, p\.provolatile::text,\s+p\.proparallel::text, p\.prorettype::regtype::text\)/.test(R),
  'A3: attrs fingerprint owner, acl, proconfig, prosecdef, provolatile, proparallel, prorettype');

// ── two-needle splice loop ───────────────────────────────────────────────────────────────────────
ok(/for r in\s+select \* from \(values/.test(A)
   && /v\(n, needle, repl, want\)/.test(A)
   && /order by n\s+loop/.test(A)
   && !/order by n desc/.test(A),
  'S1: apply loops `for r in select * from (values) v(n, needle, repl, want) order by n`');
ok(/for r in\s+select \* from \(values/.test(R)
   && /v\(n, needle, repl, want\)/.test(R)
   && /order by n desc\s+loop/.test(R),
  'S2: rollback is the inverse: $unsplice$ values, order by n desc');

const apply1 = APPLY.match(/\(1, \$n\$([\s\S]*?)\$n\$,\s*\$r\$([\s\S]*?)\$r\$, 1\)/);
const apply2 = APPLY.match(/\(2, \$n\$([\s\S]*?)\$n\$,\s*\$r\$([\s\S]*?)\$r\$, 1\)/);
const roll1 = ROLLBACK.match(/\(1, \$n\$([\s\S]*?)\$n\$,\s*\$r\$([\s\S]*?)\$r\$, 1\)/);
const roll2 = ROLLBACK.match(/\(2, \$n\$([\s\S]*?)\$n\$,\s*\$r\$([\s\S]*?)\$r\$, 1\)/);
ok(!!apply1 && apply1[1] === 'p_authoritative boolean DEFAULT false'
   && apply1[2] === 'p_authoritative boolean DEFAULT true',
  'S3: apply needle 1 is DEFAULT false -> DEFAULT true');
ok(!!apply2 && apply2[1].length === 1300 && apply2[2].length === 117
   && !apply2[1].endsWith('\n') && !apply2[2].endsWith('\n')
   && md5(apply2[1]) === NPRE_MD5 && md5(apply2[2]) === NPOST_MD5,
  'S4: apply needle 2 is NEEDLE_PRE (1300, fe546ba3…) -> NEEDLE_POST (117, 2066a578…), no trailing nl',
  apply2 ? `npre ${apply2[1].length} ${md5(apply2[1])} npost ${apply2[2].length} ${md5(apply2[2])}` : 'no match');
ok(!!apply2 && apply2[1].includes('if not p_authoritative then')
   && apply2[1].includes('LEGACY_ROW_POINT')
   && apply2[1].includes("where p.zip = p_zip")
   && apply2[2].includes("if p_authoritative is not true then")
   && apply2[2].includes("raise exception 'authoritative required' using errcode = '22023'"),
  'S5: needle 2 replaces the legacy if-not fallback with raise exception authoritative required / 22023');
ok(!!roll1 && !!roll2 && roll1[1] === apply1[2] && roll1[2] === apply1[1]
   && roll2[1] === apply2[2] && roll2[2] === apply2[1],
  'S6: rollback needles are the exact inverse of apply (n=1 and n=2)');

// ── leftover post-conditions ─────────────────────────────────────────────────────────────────────
ok(/\/ length\('p\.zip = p_zip'\) <> 0 then/.test(A)
   && /\/ length\('LEGACY_ROW_POINT'\) <> 0 then/.test(A)
   && /position\('if not p_authoritative then' in src\) > 0 then/.test(A)
   && /\/ length\('if p_authoritative is not true then'\) <> 1 then/.test(A)
   && /position\('p_authoritative boolean DEFAULT true' in def_text\) = 0 then/.test(A)
   && /position\('p_authoritative boolean DEFAULT false' in def_text\) > 0 then/.test(A),
  'C1: after apply: leftover zip_eq=0, LEGACY_ROW_POINT=0, if-not gone, is-not-true once, DEFAULT true present / false gone');
ok(/\/ length\('p\.zip = p_zip'\) <> 2 then/.test(R)
   && /\/ length\('LEGACY_ROW_POINT'\) <> 1 then/.test(R)
   && /\/ length\('if not p_authoritative then'\) <> 1 then/.test(R)
   && /position\('if p_authoritative is not true then' in src\) > 0 then/.test(R)
   && /position\('p_authoritative boolean DEFAULT false' in def_text\) = 0 then/.test(R)
   && /position\('p_authoritative boolean DEFAULT true' in def_text\) > 0 then/.test(R),
  'C2: after rollback: leftover zip_eq=2, LEGACY_ROW_POINT=1, if-not once, is-not-true gone, DEFAULT false present / true gone');
ok(/raise notice 'map1-markers-authoritative-only: applied/.test(APPLY)
   && /raise notice 'map1-markers-authoritative-only rollback: done/.test(ROLLBACK),
  'C3: notice prefixes are map1-markers-authoritative-only and map1-markers-authoritative-only rollback:');

// ── callers already pass true ────────────────────────────────────────────────────────────────────
const CALLERS = [
  'homesignalmap.html',
  'scripts/verify-map1-zip-states.mjs',
  'scripts/probe-map1-card-grain.mjs',
  'scripts/residential-measure.mjs',
  'scripts/maps-social-image.mjs',
  'test/national-plane-failure-visibility.test.mjs',
];
for (const f of CALLERS) {
  ok(/p_authoritative:\s*true/.test(read(f)), f + ' already passes p_authoritative: true');
}
const za = read('lib/zip-authoritative.js');
ok(!/\.rpc\s*\(/.test(za) && !/\{\s*p_authoritative\s*:/.test(za)
   && /zip_authoritative:\s*true/.test(za) && /app_zip_projects_markers/.test(za),
  'zip-authoritative.js is not an RPC caller (zip_authoritative is a different field; the comment names the RPC this module consumes)');

// ── not wired into the arm-gated apply workflow ──────────────────────────────────────────────────
const WF = read(WF_PATH);
ok(/workflow_dispatch: \{\}/.test(WF) && /docs\/n5-spatial-read-rpc\.sql/.test(WF)
   && /EXPECTED_ARM: arm-2026-09-04-rpc-rev3-install/.test(WF)
   && !/map1-markers-authoritative-only/.test(WF),
  'W1: n5-rpc-apply.yml is dispatch-only, pins docs/n5-spatial-read-rpc.sql only, and does not name the Step 2 files');
ok(!/map1-markers-authoritative-only/.test(read(PUB_PATH)),
  'W2: n5-generation-publish-suite.yml does not name the Step 2 files');

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
