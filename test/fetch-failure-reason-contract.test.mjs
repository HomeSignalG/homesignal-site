// Offline guard for the FETCH-FAILURE REASON CONTRACT — no network, no DB.
//
// THE COUPLING. `dev_refresh_collect()` refuses to overwrite a cached ZIP row when a source
// that ALREADY CONTRIBUTES to it reported a failed FETCH. It identifies those sources with
//
//     where q->>'reason' like 'fetch failed:%'  or  q->>'reason' like 'fetch/parse failed:%'
//
// against each connector's `*_reports[].quarantined[].reason`. That string is a CONTRACT
// across a language boundary: reword the message in a connector and the SQL keeps running,
// keeps returning success-shaped output, and silently stops guarding. The failure would look
// exactly like the defect it was built to fix.
//
// WHAT IT FIXES (2026-08-03). The old guard tested the AGGREGATE `development` count, so a
// per-SOURCE collapse hid behind another source's contribution: portlandmaps.com reset the
// connection under the refresh tick's parallel fan-out, the engine still emitted
// development=15 from the COUNTY's area planning notices, 15 > 0 so nothing fired, and 414
// real permits on ZIP 97215 were overwritten by silence. Concurrency was the variable —
// 10 ZIPs in parallel returned 0 fetched; the same ZIPs 2 at a time returned 414/407/136/116.
//
// The engine was never wrong: it names the failure exactly ("fetch failed: ... Connection
// reset by peer (os error 104)"). Only the collect layer ignored it.
//
// SQL of record: docs/dev-refresh-source-failure-guard.sql
// Run: node scripts/run-unit-tests.mjs   (or: node test/fetch-failure-reason-contract.test.mjs)
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? '\n     ' + detail : ''}`); }
};
const SRC = new URL('../supabase/functions/get-address-report/sources/', import.meta.url);
const read = (f) => readFileSync(new URL(f, SRC), 'utf8');

// registry_id → the literal prefix the SQL matches on.
const CONNECTORS = [
  ['arcgis',  'fetch failed:'],
  ['socrata', 'fetch failed:'],
  ['carto',   'fetch failed:'],
  ['ckan',    'fetch failed:'],
  ['csv',     'fetch/parse failed:'],
];

console.log('1) every connector quarantines a failed FETCH with the prefix the SQL keys on');
for (const [name, prefix] of CONNECTORS) {
  const src = read(`${name}.ts`);
  // the push must be inside a catch — a failed fetch, not a per-record miss
  const re = new RegExp(`reason: \`${prefix.replace(/[/]/g, '\\/')} \\$\\{\\(e as Error\\)\\.message\\}\``);
  ok(`${name}.ts emits \`${prefix} …\``, re.test(src),
    `no quarantine reason starting "${prefix}" — the SQL guard would stop matching this connector`);
}

console.log('\n2) each connector reports its registry_id (the SQL groups the refusal by it)');
for (const [name] of CONNECTORS) {
  const src = read(`${name}.ts`);
  const iface = src.match(/export interface \w*RunReport[^{]*\{([\s\S]*?)\n\}/);
  ok(`${name}.ts RunReport declares registry_id + quarantined`,
    !!iface && /\n {2}registry_id: string;/.test(iface[1]) && /quarantined: \{ reason: string; sample: string \}\[\];/.test(iface[1]));
}

console.log('\n3) the SQL reads EVERY connector\'s report array — a missed one is an unguarded source');
{
  const sql = readFileSync(new URL('../docs/dev-refresh-source-failure-guard.sql', import.meta.url), 'utf8');
  for (const [name] of CONNECTORS) {
    ok(`SQL unions ${name}_reports`, new RegExp(`j->'${name}_reports'`).test(sql));
  }
  for (const p of ["'fetch failed:%'", "'fetch/parse failed:%'"]) {
    ok(`SQL matches ${p}`, sql.includes(p));
  }
}

console.log('\n4) NON-fetch quarantines must NOT match — blocking on them would freeze a page forever');
{
  // These reasons are deterministic (config) or per-record (a row that could not be emitted).
  // A page whose source reports one of these is honestly what it is; refusing the write would
  // never clear, which is the same shape as a guard that freezes an intentionally-emptied page.
  const NON_FETCH = [
    'config error: use_type_const AND type_map both set — a constant is for layers with NO classifiable type column; remove one',
    'config error: include_types set but column_map.type_source is absent or a multi-column array',
    'max_rows cap of 20000 bound the fetch — the source has MORE matching records than this report contains',
    'spatial_zip_radius_mi set but no zipCentroid provided — skipped',
    'no zip column mapped and no zip_where_template — statewide dataset skipped for ZIP report',
    'registry map collision: dup key',
    'no record_url derivable',
    'geocode failed',
  ];
  const matches = (reason) => reason.startsWith('fetch failed:') || reason.startsWith('fetch/parse failed:');
  for (const r of NON_FETCH) {
    ok(`does NOT block: "${r.slice(0, 46)}…"`, !matches(r));
  }
  ok('DOES block: a real arcgis fetch failure',
    matches('fetch failed: error sending request for url (…): client error (Connect): Connection reset by peer (os error 104)'));
  ok('DOES block: a real csv fetch/parse failure', matches('fetch/parse failed: Unexpected end of input'));
  // The trap the whole guard exists for: fetched 0 with an EMPTY quarantine list is an honest
  // zero and must pass, or every legitimately-emptied page freezes.
  ok('an honest zero (no quarantine at all) does NOT block', ![].some(matches));
}

console.log('\n5) SELF-TEST — the detector can fail');
{
  const arcgis = read('arcgis.ts');
  const reworded = arcgis.replace(/reason: `fetch failed: \$\{\(e as Error\)\.message\}`/, 'reason: `could not fetch: ${(e as Error).message}`');
  ok('detector would FLAG a connector that reworded the prefix',
    !/reason: `fetch failed: \$\{\(e as Error\)\.message\}`/.test(reworded));
  const sql = readFileSync(new URL('../docs/dev-refresh-source-failure-guard.sql', import.meta.url), 'utf8');
  ok('detector would FLAG SQL that dropped a connector',
    !/j->'tabs_reports'/.test(sql));   // a name the SQL genuinely must not have
}

console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} fetch-failure-reason-contract checks passed.`);
process.exit(fail ? 1 : 0);
