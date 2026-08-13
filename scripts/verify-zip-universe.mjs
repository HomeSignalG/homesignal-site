// verify-zip-universe.mjs — the ZIP universe must equal the approved Gold Master, exactly.
//
// WHY THIS EXISTS: on 2026-08-11 a 12,723rd ZIP page (Denver 80249, CO) appeared in
// production. It was created by migration 20260811133957
// `evidence_phase6_evidence_only_zip_routing`, which carried a hardcoded single-ZIP INSERT
// into public.communities to make one Denver parcel routable. Nothing noticed for two days,
// and when it was noticed it was first read as a legitimate row with a bad state code and
// "fixed" into passing the coverage gates — which is what published it. Founder ruling
// 2026-08-13: that is unauthorized production-registry drift. The Gold Master registry is the
// source of truth for which ZIP pages exist; production must not expand the ZIP universe
// independently, and a row appearing in the DB is never evidence that it should exist.
//
// The DB-level guard (docs/canonical-zip-registry-guard.sql) makes the creation impossible.
// This verifier is the second half: it proves the guard is still installed and still armed,
// and that the three public ZIP surfaces have not drifted by any other route (a direct
// service-role write, a disabled trigger, a restored backup).
//
// ASSERTS:
//   1. canonical_zip_registry holds exactly the approved count.
//   2. communities.zip_codes (EVERY level, not just level='zip' — ?zip= resolves via
//      zip_codes @> [zip], so a ZIP in a county row's array is routable with no ZIP page)
//      == the registry, in BOTH directions.
//   3. app_community_meta == the registry, both directions.
//   4. development_reports == the registry, both directions.
//   5. canonical_zip_guard_selftest() returns all-passed — including its own positive
//      control, so a blanket-deny guard cannot score green here.
//
// Env: EXPECTED_ZIPS (default 12722), SUPABASE_URL / SUPABASE_ANON_KEY (default: read from
// config.js, the one place the app config lives).

import { readFileSync } from 'node:fs';
import { surfaceBanner } from './lib/surface-banner.mjs';

surfaceBanner('verify-zip-universe');

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const grab = (name) => {
  const m = cfg.match(new RegExp(`${name}\\s*:\\s*'([^']+)'`));
  if (!m) throw new Error(`Could not read ${name} from config.js`);
  return m[1];
};
const SUPABASE_URL = process.env.SUPABASE_URL || grab('SUPABASE_URL');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || grab('SUPABASE_ANON_KEY');
const EXPECTED = parseInt(process.env.EXPECTED_ZIPS || '12722', 10);

const HEAD = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

async function rest(path, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...HEAD, ...extraHeaders },
  });
  if (!res.ok) throw new Error(`Supabase read failed (${path}): ${res.status} ${await res.text()}`);
  return res;
}

// The exact row count, straight from PostgREST's Content-Range. This is the CONTROL for the
// paginated read below: without it, a keyset page that stops early is indistinguishable from
// a table that really is that size. That is not hypothetical here — a keyset page once
// returned only the first 5,000 ZIPs and NV's 89xxx range sorted past the end.
async function exactCount(table, select = 'zip') {
  const res = await rest(`${table}?select=${select}&limit=1`, { Prefer: 'count=exact' });
  const cr = res.headers.get('content-range') || '';
  const total = parseInt(cr.split('/')[1], 10);
  if (!Number.isFinite(total)) throw new Error(`no exact count for ${table} (content-range: ${cr})`);
  return total;
}

// Keyset pagination on the ordering column — PostgREST caps an un-paginated read at 1,000
// rows and does it SILENTLY, so every full-table read in this repo pages explicitly.
async function allValues(table, col) {
  const out = [];
  let cursor = '';
  for (;;) {
    const gt = cursor ? `&${col}=gt.${encodeURIComponent(cursor)}` : '';
    const rows = await (await rest(
      `${table}?select=${col}&order=${col}.asc&limit=1000${gt}`)).json();
    if (!rows.length) break;
    for (const r of rows) out.push(r[col]);
    cursor = rows[rows.length - 1][col];
  }
  return out;
}

// communities.zip_codes is an ARRAY column, so it needs unnesting client-side; page it on the
// primary key rather than on the array.
async function allCommunityZips() {
  const out = [];
  let cursor = '';
  for (;;) {
    const gt = cursor ? `&id=gt.${encodeURIComponent(cursor)}` : '';
    const rows = await (await rest(
      `communities?select=id,zip_codes&order=id.asc&limit=1000${gt}`)).json();
    if (!rows.length) break;
    for (const r of rows) for (const z of (r.zip_codes || [])) out.push(z);
    cursor = rows[rows.length - 1].id;
  }
  return out;
}

const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok : fail).push(msg);

function compareSets(label, actual, registry) {
  const a = new Set(actual), r = new Set(registry);
  const extra = [...a].filter((z) => !r.has(z)).sort();
  const missing = [...r].filter((z) => !a.has(z)).sort();
  check(extra.length === 0,
    `${label}: ${extra.length} production-only ZIP(s)` +
    (extra.length ? ` — ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? ' …' : ''}` : ''));
  check(missing.length === 0,
    `${label}: ${missing.length} registry-only ZIP(s)` +
    (missing.length ? ` — ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}` : ''));
  return { extra, missing };
}

async function main() {
  console.log(`ZIP universe verification — expecting exactly ${EXPECTED} approved ZIPs\n`);

  // 1 — the registry itself.
  const regCount = await exactCount('canonical_zip_registry');
  check(regCount === EXPECTED, `canonical_zip_registry holds ${regCount} ZIPs (expected ${EXPECTED})`);
  if (regCount === 0) {
    console.error('FAIL: canonical_zip_registry is EMPTY — the guard is failing closed and ' +
                  'every ZIP creation is blocked. Reseed it from the approved Gold Master.');
    process.exit(1);
  }
  const registry = await allValues('canonical_zip_registry', 'zip');
  check(registry.length === regCount,
    `registry read is complete: ${registry.length} of ${regCount} rows fetched`);

  // 2..4 — the three public surfaces, each against its own exact count first.
  const surfaces = [
    ['communities.zip_codes', await allCommunityZips(), null],
    ['app_community_meta', await allValues('app_community_meta', 'zip'), await exactCount('app_community_meta')],
    ['development_reports', await allValues('development_reports', 'zip'), await exactCount('development_reports')],
  ];
  for (const [label, values, total] of surfaces) {
    if (total !== null) {
      check(values.length === total,
        `${label}: read is complete (${values.length} of ${total} rows)`);
    }
    const uniq = new Set(values);
    check(uniq.size === EXPECTED, `${label}: ${uniq.size} distinct ZIPs (expected ${EXPECTED})`);
    compareSets(label, values, registry);
  }

  // 5 — the guard proves itself, including its own positive control.
  const selftest = await (await rest('rpc/canonical_zip_guard_selftest', { Prefer: 'return=representation' })).json();
  check(Array.isArray(selftest) && selftest.length > 0, 'guard self-test returned cases');
  for (const c of (selftest || [])) {
    check(c.passed === true, `guard self-test [${c.case_name}] expected ${c.expected}: ${c.detail}`);
  }

  for (const m of ok) console.log(`  PASS  ${m}`);
  if (fail.length) {
    console.error('\nFAILURES:');
    for (const m of fail) console.error(`  FAIL  ${m}`);
    console.error(`\n${fail.length} failure(s). The ZIP universe has drifted from the approved ` +
                  `Gold Master, or the creation guard is no longer armed.`);
    process.exit(1);
  }
  console.log(`\nAll ${ok.length} checks passed — the ZIP universe is exactly the approved ${EXPECTED}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
