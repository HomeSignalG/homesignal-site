// LOCAL NEWS MUST REACH A NON-'pass' ZIP, AND THE LIST CAP MUST NOT HIDE A TOPIC.
//
// Two separate production facts, both measured 2026-09-07:
//
// 1. CONTAINER. app_community_meta.data_quality gates the development/facilities LAYOUT.
//    It does NOT gate the Local News pipeline: local news is materialized into app_changes
//    for any community with qualifying supply, whatever the ZIP's civic coverage state.
//    The generated /community/<zip>/ document already shows the list from its SSR block,
//    but community.html carries no #hs-ssr, so keepSsrAbove() is a no-op there and the
//    early return rendered NO local news at all. 177 registry ZIPs have
//    data_quality <> 'pass' AND Local News rows in app_changes.
//
// 2. CAP. The list was sliced to 6. 1,127 ZIPs carry more than 6 rendered Local News rows
//    and 665 of them lose at least one DISTINCT topic to that cap (872 topic-cells hidden).
//
// These are offline source assertions on the shipped runtime, so the regression fails in
// the REQUIRED offline check rather than only in the optional browser suite.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rt = readFileSync(join(root, 'lib', 'community-page.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

// The non-'pass' branch: from `if (status !== 'pass') {` to its `return;`.
const start = rt.indexOf("if (status !== 'pass')");
ok(start > 0, "the non-'pass' branch is present in the shipped runtime");
const branch = rt.slice(start, rt.indexOf('return;', start));

// ---- 1. container ------------------------------------------------------------------------
ok(/HS\.data\.news\(/.test(branch),
   "the non-'pass' branch READS local news (it early-returned without fetching before)");
ok(/localNewsSection\(/.test(branch),
   "the non-'pass' branch renders the Local News list");
ok(/keepSsrAbove\(\)/.test(branch) && !/dropSsr\(\)/.test(branch),
   'the build-time Alerts block is KEPT, never deleted (community-page-contract rule)');
ok(/getElementById\('hs-ssr'\)\s*\?\s*''/.test(branch),
   'the hydrated list renders ONLY where there is no #hs-ssr — one section on both routes');

// ---- the container must NOT promote the ZIP to a 'pass' layout ---------------------------
ok(!/HS\.data\.projects\(/.test(branch),
   "the non-'pass' branch still renders NO development projects");
ok(!/HS\.data\.facilities\(/.test(branch),
   "the non-'pass' branch still renders NO facilities");
ok(/Coverage coming/.test(branch),
   'the existing civic coverage copy is preserved, not replaced');

// ---- 2. cap -------------------------------------------------------------------------------
ok(/var LOCAL_NEWS_CAP = 20;/.test(rt), 'the Local News list cap is a named constant, set to 20');
ok(!/news\.slice\(0,\s*6\)/.test(rt), 'no Local News list is sliced to 6 any more');
const capUses = (rt.match(/slice\(0,\s*LOCAL_NEWS_CAP\)/g) || []).length;
ok(capUses === 2, `both Local News lists use the constant (found ${capUses})`);

// ---- SSR and hydrate agree in LENGTH ------------------------------------------------------
// gen_zip_pages.py renders the canonical /community/<zip>/ list; community-page.js renders
// the dynamic one. Two different caps meant two different pages for the same ZIP.
const gen = readFileSync(join(root, 'scripts', 'gen_zip_pages.py'), 'utf8');
ok(/^LN_CAP, GN_CAP, UM_CAP = 20, /m.test(gen),
   'gen_zip_pages.py LN_CAP is 20 — the same cap the hydrated list uses');
ok(/rule_f/.test(gen) && gen.indexOf('n_ln_journalism') < gen.indexOf('[:LN_CAP]'),
   'rule_f is computed BEFORE the LN_CAP slice — the cap cannot move robots');

// ---- ordering is NOT a decision this change makes ----------------------------------------
ok(!/\.sort\(/.test(branch), "the non-'pass' branch does not re-sort — ordering stays HS.data.news's");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
