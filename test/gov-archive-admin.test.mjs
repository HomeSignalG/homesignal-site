// Pins the Government Source Archive admin surface (gov-archive.html).
//
// WHY A SOURCE-LEVEL SUITE. This page is internal, allowlisted and unreachable from
// CI without a test account, so nothing else can check it. What it CAN check is the
// set of properties that must never regress silently — and each one below is a
// specific way an internal archive tool goes wrong:
//
//   * it becomes reachable, indexable or linked from resident navigation
//   * it acquires a table grant, so the allowlist stops being the gate
//   * a service-role key ends up in the browser
//   * the government URL and the HomeSignal archive collapse into one control,
//     so an operator can no longer tell which one they just opened
//   * an unstated penalty renders as $0, or an unrun source renders as 0 records
//
// Run: node test/gov-archive-admin.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'gov-archive.html'), 'utf8');
const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
const shell = readFileSync(join(root, 'partials/shell.html'), 'utf8');
const banner = readFileSync(join(root, 'scripts/lib/surface-banner.mjs'), 'utf8');

const failures = [];
const need = (cond, msg) => { if (!cond) failures.push(msg); };

// Copy in this page is built by concatenating string literals across lines, so a
// sentence assertion has to read the sentence rather than the source layout.
// `prose` joins adjacent literals; a reflow must not be able to break a guard.
const prose = page.replace(/'\s*\n\s*\+\s*'/g, '').replace(/\s+/g, ' ');

// ── 1. INTERNAL ONLY ────────────────────────────────────────────────────────────
need(/<meta name="robots" content="noindex, nofollow">/.test(page),
  'the archive page is not noindex — it is an internal tool, not a crawlable page');
need(/^Disallow: \/gov-archive\.html$/m.test(robots),
  'gov-archive.html is not disallowed in robots.txt');
need(!/gov-archive\.html/.test(shell),
  'the archive is linked from the resident app shell — it is an operator tool and must not '
  + 'appear in navigation');
// Raw archive browsing is not a public surface. The page must reach Storage only for a
// single document the operator opened, never list the bucket.
need(!/storage\s*\.\s*from\([^)]*\)\s*\.\s*list\(/.test(page),
  'the page lists the storage bucket — raw archive browsing must not be exposed');

// ── 2. THE GATE ─────────────────────────────────────────────────────────────────
need(/hsClient\.rpc\(/.test(page) || /function rpc\(name, args\)/.test(page),
  'the page does not read through RPCs');
// Every read must be a gov_archive_* function. A direct .from('table') would depend on a
// table grant existing, and the whole security model is that none does.
const directTables = [...page.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1]);
need(directTables.length === 0,
  `the page reads tables directly (${directTables.join(', ')}) instead of through the gated RPCs`);
for (const fn of ['gov_archive_overview', 'gov_archive_records', 'gov_archive_record',
  'gov_archive_runs', 'gov_archive_run', 'gov_archive_document_key']) {
  need(page.includes(fn), `the admin surface never calls ${fn}`);
}
need(/42501/.test(page) && /noAccess/.test(page),
  'the page does not distinguish "not on the allowlist" from a generic failure');
need(/read failure on our side/.test(prose),
  'a failed load does not say it is a failure rather than an absence of records');

// ── 3. NO SERVICE-ROLE CREDENTIAL IN THE BROWSER ────────────────────────────────
need(!/service_role|SERVICE_ROLE|SUPABASE_WRITE_KEY|SUPABASE_SERVICE_KEY/.test(page),
  'a service-role credential appears in a browser page');
// The one key present must be the public anon key, and the JWT role claim proves which.
const keys = [...page.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\./g)].map((m) => m[1]);
need(keys.length > 0, 'no Supabase key found — the page could not authenticate at all');
for (const payload of keys) {
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  need(claims.role === 'anon',
    `a non-anon key ("${claims.role}") is embedded in the page`);
}
const csp = (page.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
need(/script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net;/.test(csp),
  'the CSP does not restrict script-src to self + jsDelivr');
need(/connect-src[^;]*qwnnmljucajnexpxdgxr\.supabase\.co/.test(csp),
  'the CSP does not allow the Supabase read the page needs');

// ── 4. PROVENANCE AND PRESERVATION ARE TWO CONTROLS ─────────────────────────────
// The government URL is where the document came from and may no longer be. The archive
// is what we hold. One button for both would leave an operator unable to say which they
// just looked at, which is the entire question this page exists to answer.
need(/View original government source/.test(page),
  'there is no control for the original government source');
need(/View HomeSignal archived copy/.test(page),
  'there is no control for the HomeSignal archived copy');
need(/srcbtn gov/.test(page) && /srcbtn hs/.test(page),
  'the two source controls are not visually distinguished');
need(/provenance/i.test(prose) && /preservation/i.test(prose),
  'the page never states the difference between provenance and preservation');
need(/createSignedUrl/.test(page),
  'the archived copy is not opened through a signed URL minted from the operator session');

// ── 5. A DISAPPEARANCE IS NOT A DISPOSITION ─────────────────────────────────────
need(/no longer published/i.test(prose),
  'the page has no wording for a document that has been taken down');
need(/vacated, rescinded or reversed/i.test(prose)
  && /require[s]? an affirmative government document/i.test(prose),
  'the page does not refuse the reading that a removed document was vacated or rescinded');
// REMOVED_FROM_SOURCE must not be styled as an error: the archive still holds the file.
need(/REMOVED_FROM_SOURCE:'p-warn'/.test(page.replace(/\s/g, '')),
  'a removed-from-source document is styled as a failure, implying we lost something');

// ── 6. HONEST NUMBERS ───────────────────────────────────────────────────────────
// The same rule the Property Card enforces, for the same reason: a 0 beside a source
// nobody has run reads as "nothing to find".
need(/var DASH = '\\u2014'/.test(page), 'there is no em-dash constant for an absent value');
need(/function n\(v\)\{ return \(typeof v === 'number' && isFinite\(v\)\) \? String\(v\) : DASH; \}/
  .test(page.replace(/\n\s*/g, ' ')) || /: DASH;/.test(page),
  'numbers are not gated — a missing count could render as 0');
need(/The record does not state one/.test(prose),
  'an unstated penalty does not say so, so it could read as no penalty');
need(/money\(v\)/.test(page) && /isFinite\(v\)\) \? '\$' \+ v\.toLocaleString\(\) : DASH/
  .test(page.replace(/\n\s*/g, ' ')),
  'the money formatter can print $0 for an unstated amount');
need(/not about what the agencies hold/.test(prose),
  'an empty search result does not distinguish "we have not acquired it" from "it does not exist"');

// ── 7. THE VIEWS THE BRIEF REQUIRES ─────────────────────────────────────────────
for (const [label, probe] of [
  ['agency + program overview', /<th>Agency<\/th><th>Program<\/th>/],
  ['last run and last SUCCESSFUL run', /Last run<\/th>[\s\S]{0,140}Last success/],
  ['removed-from-source count', /Removed from source/],
  ['documents archived count', /<th>Documents<\/th>/],
  ['failure count', /<th>Failures<\/th>/],
  ['record detail', /function renderRecord\(actionId\)/],
  ['version history', /function versionsHTML\(docs\)/],
  ['event timeline', /function timelineHTML\(events, dispositions\)/],
  ['run detail', /function renderRun\(runId\)/],
  ['run errors', /Acquisition errors/],
  ['parser and code version on a run', /Parser version[\s\S]{0,220}Code version/],
]) {
  need(probe.test(page), `the admin surface is missing: ${label}`);
}
for (const filter of ['f-source', 'f-agency', 'f-status', 'f-type', 'f-entity', 'f-record',
  'f-from', 'f-to']) {
  need(page.includes(filter), `the filter bar is missing "${filter}"`);
}

// ── 8. SUBJECT KIND IS ON THE PAGE ──────────────────────────────────────────────
// A facility silently promoted to a company is invisible unless the kind is rendered
// next to the name. This is the cheapest possible check for the most expensive mistake.
need(/Subject, as the source typed it/.test(page),
  'the page never shows what KIND of thing the government named, so a facility filed as a '
  + 'company would be undetectable');
need(/Only a <b>verified<\/b> resolution attributes this action/.test(prose),
  'the page does not say that only a verified resolution attributes an action to an entity');
need(/belongs to the entity the government document named/.test(prose),
  'the page does not state the attribution rule');

// ── 9. DECLARED AS A SURFACE ────────────────────────────────────────────────────
need(/gov-archive\.html/.test(banner),
  'gov-archive.html is not declared in scripts/lib/surface-banner.mjs, so its verification '
  + 'status is unrecorded');

// ── 10. THE SCHEMA IT READS IS IN THE OTHER REPO, AND SAYS SO ───────────────────
const contract = join(root, '..', 'homesignal-ingest',
  'docs/government-source-integration-contract.md');
if (existsSync(contract)) {
  const text = readFileSync(contract, 'utf8');
  need(/gov-archive\.html/.test(text),
    'the integration contract does not point a new source author at the admin surface');
  need(/A new source is an ADAPTER/.test(text),
    'the integration contract no longer states the rule it exists for');
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('gov-archive admin contract: internal and noindex, every read through an allowlisted '
  + 'RPC with no table grant, no service-role key in the browser, provenance and preservation are '
  + 'two distinct controls, a removed document is never called vacated, and no absent value can '
  + 'render as a zero.');
