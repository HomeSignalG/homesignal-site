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

console.log('\n6) BOUNDED FETCH — a cap must be distinguishable from a complete fetch (fix 2)');
{
  // The truncation discriminator keys on the `truncated_at_max_rows` FIELD, never on prose:
  // csv words its note "bound the emit" while the other four say "bound the fetch", so a
  // string match would have silently missed one connector in five.
  for (const [name] of CONNECTORS) {
    const src = read(`${name}.ts`);
    ok(`${name}.ts sets truncated_at_max_rows when the cap binds`,
      /report\.truncated_at_max_rows = /.test(src));
    ok(`${name}.ts accepts a per-entry max_rows`, /\n {2}max_rows\?: number;/.test(src));
  }
  const sql = readFileSync(new URL('../docs/dev-refresh-source-failure-guard.sql', import.meta.url), 'utf8');
  ok('SQL discriminates truncation on the FIELD, not the prose',
    /truncated_at_max_rows' is not null/.test(sql) && !/bound the emit'/.test(sql.split('PROOF')[0]));
  ok('SQL declares dev_truncated_sources', /function public\.dev_truncated_sources/.test(sql));
  // Truncation is DETERMINISTIC — blocking on it would freeze the page forever, so it is
  // logged with blocked_update = false and never refuses a write.
  ok('truncation is logged as non-blocking', /'truncated',\s*$|false, 'truncated'/m.test(sql));
}

console.log('\n7) FIRE-LEVEL failures — a NULL status_code must be attributable, not skipped');
{
  const sql = readFileSync(new URL('../docs/dev-refresh-source-failure-guard.sql', import.meta.url), 'utf8');
  // A pg_net timeout has NO payload and NO zip, so it can only be attributed from a map
  // recorded at FIRE time. Without that, the failure is unattributable and therefore invisible.
  ok('SQL declares dev_refresh_inflight (request_id -> zip, at fire time)',
    /dev_refresh_inflight/.test(sql));
  ok('SQL declares dev_refresh_log_fire_failures', /dev_refresh_log_fire_failures/.test(sql));
  ok('a NULL status_code is logged as its own kind', /'fire_failed'/.test(sql));
  ok('a non-200 status_code is logged distinctly', /'fire_http_error'/.test(sql));
  // The intuitive wrong answer, pinned so a future session does not ship it.
  ok('SQL records that VOLUME is not the binding constraint',
    /VOLUME IS NOT THE CONSTRAINT/.test(sql) && /Host SPEED binds, not row count/.test(sql));
}

console.log('\n8) RETIRED-SOURCE DISCRIMINATOR — a legitimate reduction is not a transient collapse');
{
  const sql = readFileSync(new URL('../docs/dev-refresh-source-failure-guard.sql', import.meta.url), 'utf8');
  ok('SQL declares dev_reported_sources', /function public\.dev_reported_sources/.test(sql));
  ok('SQL declares dev_retired_sources', /function public\.dev_retired_sources/.test(sql));
  ok('a retired source is logged as its own kind', /'retired'/.test(sql));
  // The guard must still REFUSE an unexplained collapse — a discriminator that accepted every
  // zero would be the transient guard deleted, not strengthened.
  ok('the SQL records that an UNEXPLAINED collapse is still refused',
    /would_write = FALSE\s+\(guard intact\)/.test(sql));
  ok('the SQL records that a FETCH FAILURE still refuses (Part 1 precedence)',
    /FETCH FAILED\s+-> would_write = FALSE\s+\(Part 1 wins\)/.test(sql));
  // Absence from the reports is the signal — the engine reports on every entry whose coverage
  // gate matched, so "not reported" means "no longer runs here", never "ran and found nothing".
  ok('the discriminator keys on ABSENCE FROM THE REPORTS, not on a count',
    /ABSENT FROM THE PAYLOAD'S REPORTS ENTIRELY/.test(sql));
}

console.log(fail ? `\n${fail} check(s) FAILED` : `\nAll ${pass} fetch-failure-reason-contract checks passed.`);
process.exit(fail ? 1 : 0);
