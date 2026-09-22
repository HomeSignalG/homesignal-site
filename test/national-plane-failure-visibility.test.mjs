// NATIONAL DATA-CENTER PLANE — A FAILED READ MUST NEVER LOOK LIKE A LEGITIMATE ZERO.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT. The plane shipped with two swallow points:
//   lib/data.js        `if (error) return [];`
//   homesignalmap.html `.then(r => r.ok ? r.json() : []).catch(() => [])`
// so a permission error (the 401 that actually shipped — see docs/national-dc-plane.sql),
// a 5xx, a client timeout, a dropped connection, a malformed body, and a plane that is
// not deployed ALL reached the resident as the same result as "no eligible national data
// centers near this ZIP". A fabricated absence is the one thing this project's
// anti-fabrication rules exist to stop, and it is reached here from the quiet direction:
// the page looked deployed and healthy while rendering nothing.
//
// This is NOT a new convention. lib/zip-authoritative.js states the same rule as its
// rule 1 — "`null` IS NOT `[]`" — and already carries HS.zipAuthOutcome for the
// authoritative plane. HS.nationalPlaneResult is that pattern applied to the third plane.
//
// ⚠️ THE MODEL IS NOT THE PRODUCT. Truth tables prove the RULE; they cannot prove the
// shipped page composes it. Every semantic case below is therefore paired with a
// STRUCTURAL assertion against homesignalmap.html — and those assertions read the page
// with whole-line comments stripped, because this file's own fix comment QUOTES the old
// `catch(function(){ return []; })` string it forbids (CLAUDE.md: "a pin that names the
// string it forbids cannot also search the whole file for it").
//
// Run: node test/national-plane-failure-visibility.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const mapSrc = readFileSync(join(root, 'homesignalmap.html'), 'utf8');
/** Executable page source only: every whole-line // comment removed. */
const mapExec = mapSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const planeSql = readFileSync(join(root, 'docs/national-dc-plane.sql'), 'utf8');
const sqlExec = planeSql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

// --- supabase-js stand-in, rpc() only (that is all the national read uses) ---
function makeSb(result) {
  return { rpc: async () => result };
}
async function loadData(sbClient) {
  delete require.cache[require.resolve('../lib/data.js')];
  global.window = {
    HS_CONFIG: { DATA_SOURCE: 'supabase', DEFAULT_ZIP: '20147' },
    HS: { state: { session: null, zip: '20147' } },
    supabase: { createClient: () => sbClient },
  };
  require('../lib/data.js');
  return global.window.HS;
}
const HS = await loadData(makeSb({ data: [], error: null }));
const R = HS.nationalPlaneResult;

// One real eligible row, shaped as the RPC returns it.
const row = (k) => ({
  source_key: k, source_name: 'OpenStreetMap',
  source_url: 'https://www.openstreetmap.org/way/1188691868',
  project_name: 'NTT Ashburn VA9 Data Center', developer_or_operator: 'NTT',
  raw_status: 'operational', normalized_status: 'operational', project_type: 'datacenter',
  lat: 39.02, lng: -77.46, location_text: null, location_precision: 'approximate_campus_area',
  distance_mi: 1.21, last_seen_at: '2026-09-15T00:00:00Z',
});

console.log('\n1. A successful read WITH records still returns records');
{
  const r = R({ http: 200, body: [row('way/1'), row('way/2')] });
  ok(r.status === 'ok' && r.records.length === 2, '1a two rows survive, status ok');
  ok(r.reason === null, '1b a success carries no failure reason');
}

console.log('\n2. A successful read with ZERO records is a successful zero');
{
  const r = R({ http: 200, body: [] });
  ok(r.status === 'ok', '2a empty 200 is ok, NOT unavailable');
  ok(r.records.length === 0 && r.reason === null, '2b zero records, no reason');
  // The whole point: 2 and 3-6 must not be the same value.
  ok(r.status !== R({ http: 401, body: null }).status, '2c successful zero !== permission failure');
  ok(r.status !== R({ http: 500, body: null }).status, '2d successful zero !== server failure');
  ok(r.status !== R({ transportError: true }).status, '2e successful zero !== network failure');
  ok(r.status !== R({ http: 200, body: { code: '42501' } }).status, '2f successful zero !== malformed');
}

console.log('\n3. PERMISSION failure is distinguishable (the 401 that actually shipped)');
{
  for (const code of [401, 403]) {
    const r = R({ http: code, body: { code: '42501', message: 'permission denied' } });
    ok(r.status === 'unavailable' && r.reason === 'permission' && r.http === code,
      `3a ${code} -> unavailable/permission/${code}`);
    ok(Array.isArray(r.records) && r.records.length === 0, `3b ${code} still yields an array`);
  }
}

console.log('\n4. SERVER failure is distinguishable');
{
  for (const code of [500, 502, 503]) {
    const r = R({ http: code, body: null });
    ok(r.status === 'unavailable' && r.reason === 'server' && r.http === code,
      `4a ${code} -> unavailable/server/${code}`);
  }
  // 404 means the function is absent — the plane is not deployed here, which is a
  // DIFFERENT operational fact from a server fault and must stay legible after a rollback.
  const nd = R({ http: 404, body: null });
  ok(nd.status === 'unavailable' && nd.reason === 'not_deployed', '4b 404 -> not_deployed, not server');
}

console.log('\n5. TIMEOUT / NETWORK failure is distinguishable');
{
  const r = R({ transportError: true });
  ok(r.status === 'unavailable' && r.reason === 'network' && r.http === null,
    '5a transport error -> unavailable/network, no http');
  ok(R(null).reason === 'network', '5b a missing read is network, never a zero');
  ok(R(undefined).status === 'unavailable', '5c undefined is never ok');
  ok(R({ http: null }).reason === 'network', '5d no status code -> network');
}

console.log('\n6. MALFORMED payload is distinguishable');
{
  ok(R({ http: 200, body: { code: '42501' } }).reason === 'malformed', '6a 200 + error object');
  ok(R({ http: 200, body: null }).reason === 'malformed', '6b 200 + null body');
  ok(R({ http: 200, body: '<html>proxy</html>' }).reason === 'malformed', '6c 200 + HTML from a proxy');
  ok(R({ http: 200, body: undefined }).reason === 'malformed', '6d 200 + undefined');
  // A 200 does not promise rows; shape is checked, not assumed.
  ok(R({ http: 200, body: [] }).status === 'ok', '6e ...but a real empty array is still ok');
}

console.log('\n7. Map 1 does not crash when the national plane fails');
{
  // Every branch must return the same SHAPE, so the page's `.map()` over records can
  // never throw on a failure value. That is what keeps the map usable.
  const cases = [
    R({ http: 200, body: [row('way/1')] }), R({ http: 200, body: [] }),
    R({ http: 401, body: null }), R({ http: 500, body: null }),
    R({ transportError: true }), R({ http: 200, body: { code: 'x' } }),
    R(null), R({ http: 404, body: null }),
  ];
  ok(cases.every((c) => Array.isArray(c.records)), '7a records is ALWAYS an array');
  ok(cases.every((c) => typeof c.status === 'string'), '7b status is always present');
  let threw = false;
  try { cases.forEach((c) => c.records.map((x) => x.source_key)); } catch (e) { threw = true; }
  ok(!threw, '7c mapping over every outcome never throws');
  // Structural: the page maps over .records and no longer over a bare fallback array.
  // FIX 29 put ONE admission gate in front of that map (`!natlAdmitted ? [] : …`). That `[]`
  // is a GEOGRAPHY-CONTRACT refusal — this ZIP has no authoritative whole-ZIP geography, so
  // proximity may not assert membership — and is NOT the read-failure fallback this section
  // exists to forbid. The distinction is the whole point of 7a-7c: a failed READ still yields
  // `records: []` through nationalPlaneResult and is reported via `status`, whereas a refused
  // ADMISSION is reported via `admitted`. So the pin is split rather than relaxed: the mapped
  // source must still be natl.records, and the ONLY thing allowed in front of it is the
  // admission flag — anything keyed on the read outcome fails here.
  const natlLine = (mapExec.match(/^.*var natlSites = .*$/m) || [''])[0];
  ok(/natl\.records\.map\(/.test(natlLine), '7d page maps over natl.records', natlLine.trim());
  ok(/^\s*var natlSites = (?:!natlAdmitted \? \[\] : )?natl\.records\.map\(/.test(natlLine),
     '7d-i the only guard in front of the map is the Fix 29 admission gate', natlLine.trim());
  ok(!/\b(?:ok|status|http|error|records\.length)\b[^\n]*\?/.test(natlLine),
     '7d-ii no read-OUTCOME fallback feeds natlSites', natlLine.trim());
  ok(/HS\.nationalPlaneResult\(\{ transportError: true \}\)/.test(mapExec),
    '7e page routes a rejected fetch into the classifier, not into []');
  ok(!/rpc\/national_dc_for_zip[\s\S]{0,400}?r\.ok \? r\.json\(\) : \[\]/.test(mapExec),
    '7f the national fetch no longer collapses a non-2xx into []');
}

console.log('\n8. The observable signal exists, is structured, and names the plane');
{
  ok(/window\.__HS_NATIONAL_PLANE = \{/.test(mapExec), '8a page publishes __HS_NATIONAL_PLANE');
  for (const field of ['plane:', 'zip:', 'status:', 'reason:', 'http:', 'records:', 'fallback:', 'at:']) {
    ok(new RegExp(field.replace(':', '\\s*:')).test(
      mapExec.slice(mapExec.indexOf('__HS_NATIONAL_PLANE'), mapExec.indexOf('__HS_NATIONAL_PLANE') + 600)),
      `8b signal carries ${field.replace(':', '')}`);
  }
  ok(/console\.warn\("\[HomeSignal\] national data-center plane unavailable/.test(mapExec),
    '8c one console.warn, in the page\'s existing "[HomeSignal] <subsystem> unavailable" idiom');
  // It must fire ONLY on failure — a warning on every healthy load is noise that gets filtered.
  ok(/natl\.status !== HS\.NATIONAL_PLANE_OK && window\.console/.test(mapExec),
    '8d the warn is gated on failure, never emitted on a healthy read');
}

console.log('\n9. lib/data.js carries the same distinction on its own contract');
{
  const okRes = await (await loadData(makeSb({ data: [row('way/1')], error: null })))
    .data.nationalDataCenters('20147', { lat: 39.0, lng: -77.4 });
  ok(okRes.length === 1 && okRes.complete === true && okRes.plane.status === 'ok',
    '9a success -> rows, complete true');
  const errRes = await (await loadData(makeSb({ data: null, error: { message: 'permission denied' } })))
    .data.nationalDataCenters('20147', { lat: 39.0, lng: -77.4 });
  ok(errRes.length === 0, '9b failure still returns an array (page never breaks)');
  ok(errRes.complete === false, '9c ...but complete is FALSE, the sibling planes\' own convention');
  ok(errRes.plane.status === 'unavailable', '9d ...and the plane reports unavailable');
  const zeroRes = await (await loadData(makeSb({ data: [], error: null })))
    .data.nationalDataCenters('07446', { lat: 41.05, lng: -74.14 });
  ok(zeroRes.length === 0 && zeroRes.complete === true,
    '9e a genuine zero is complete TRUE — the distinction the defect erased');
}

console.log('\n10. The raw table stays blocked and the approved RPC stays the only door');
{
  ok(/revoke all on public\.national_dc_records from anon, authenticated;/.test(sqlExec),
    '10a raw table revoked from anon/authenticated');
  ok(/alter table public\.national_dc_records enable row level security;/.test(sqlExec),
    '10b RLS enabled on the raw table');
  ok(/security definer/.test(sqlExec) && /grant execute on function public\.national_dc_for_zip/.test(sqlExec),
    '10c the RPC is SECURITY DEFINER and is what anon may execute');
  ok(/has_table_privilege\('anon', 'public\.national_dc_records', 'SELECT'\)/.test(sqlExec),
    '10d a fail-closed guard raises if the raw table ever becomes anon-readable');
  ok(/where r\.map_eligible/.test(sqlExec),
    '10e the RPC still returns ONLY eligible rows — ineligible records cannot leak');
  // Nothing in this change may touch that boundary.
  ok(!/grant select on public\.national_dc_records/i.test(sqlExec),
    '10f no grant of the raw table to anyone');
}

console.log('\n11. The local connector pipeline and default filters are untouched');
{
  // The two sibling reads in the same Promise.all keep their exact prior behaviour.
  ok(/p_kind: "development", p_authoritative: true/.test(mapExec),
    '11a the authoritative local read is unchanged');
  // 2026-09-22: the concat moved INTO the one ZIP-mode door (HS.zipModeSites), which merges the
  // local planes first and appends only national records carrying a 'member' verdict.
  // 2026-09-22 (facility plane): the report plane now arrives through zip_mode_report_sites,
  // already member-only, as rsSites — never as the raw cached row.sites.
  ok(/HS\.zipModeSites\(rsSites, auth, natlSites\)/.test(mapExec),
    '11b local merge still runs first; national is concatenated, never substituted');
  ok(/app_projects_for_zip/.test(readFileSync(join(root, 'lib/data.js'), 'utf8')),
    '11c projects()/facilities() still read app_projects — local pipeline untouched');
  // Fail-open default filters: every category on.
  const mapJs = readFileSync(join(root, 'lib/map.js'), 'utf8');
  const dcf = mapJs.slice(mapJs.indexOf('defaultCategoryFilters'));
  ok(/= true/.test(dcf.slice(0, 400)) && !/= false/.test(dcf.slice(0, 400)),
    '11d defaultCategoryFilters stays fail-open (all on)');
}

console.log('\n12. Attribution can never credit a source that supplied nothing');
{
  ok(/if\(s && s\.source_name && s\.record_url\) a\[s\.source_name\] = 1;/.test(mapExec),
    '12a the credit names a source ONLY for a record that can actually reach the page');
  ok(!/a\[s\.source_name\]=1; return a;/.test(mapExec),
    '12a2 ...never from every row returned, which credited "undefined" on a junk payload');
  // On a failure there are no records, so no credit is rendered — the licence obligation
  // is met without ever asserting a source was consulted successfully.
  ok(R({ http: 500, body: null }).records.length === 0, '12b a failed read supplies no source names');
}


console.log('\n13. TRUNCATION IS A THIRD STATE — a clipped set is not a complete one');
{
  // Measured 2026-09-15 over ALL 12,722 canonical ZIPs: `limit 200` silently clipped
  // ZIP 20166 (Sterling VA, the Loudoun data-centre corridor) at 203 eligible records —
  // 200 returned, 3 hidden, reported as a complete success. Truncation-reported-as-
  // complete is the same dishonesty as failure-reported-as-zero, one state over.
  const more = (n) => Array.from({ length: n }, (_, i) => Object.assign(row('w/' + i), { has_more: true }));
  const full = (n) => Array.from({ length: n }, (_, i) => Object.assign(row('w/' + i), { has_more: false }));

  const t = R({ http: 200, body: more(3) });
  ok(t.status === 'ok', '13a a truncated read still SUCCEEDED — status stays ok');
  ok(t.truncated === true, '13b ...and says so');
  ok(t.records.length === 3, '13c the rows it did return are kept');

  const c = R({ http: 200, body: full(3) });
  ok(c.truncated === false, '13d a complete read is not truncated');
  ok(c.status === t.status, '13e both are `ok` — so status ALONE cannot tell them apart...');
  ok(c.truncated !== t.truncated, '13f ...which is exactly why `truncated` exists');

  ok(R({ http: 200, body: [] }).truncated === false, '13g an empty read is not truncated');
  ok(R({ http: 500, body: null }).truncated === false, '13h a failed read reports truncated false, never undefined');
  ok(R({ transportError: true }).truncated === false, '13i ...on every failure branch');
  // The server is the authority. A page must never infer truncation from a row count,
  // which is what made the old cap undetectable at exactly `limit` rows.
  ok(R({ http: 200, body: full(200) }).truncated === false,
    '13j 200 rows with has_more false is COMPLETE — the count is not the signal');
}

console.log('\n14. A ROW THAT IS NOT AN OBJECT CANNOT REACH A .map()');
{
  // A null/number/string entry throws the moment a caller reads a field off it, which
  // took the whole ZIP page down with it (local records included). Measured on the real
  // page; pre-existing since the plane shipped, fixed here.
  const mixed = R({ http: 200, body: [row('w/1'), null, 42, 'x', row('w/2')] });
  ok(mixed.status === 'ok', '14a a partially-junk array still succeeds');
  ok(mixed.records.length === 2, '14b only the real rows survive', mixed.records.length);
  let threw = false;
  try { mixed.records.map((x) => x.source_key); } catch (e) { threw = true; }
  ok(!threw, '14c mapping the survivors never throws');
  // ...but an array that was non-empty and survives as EMPTY is malformed, NOT a real
  // zero. Collapsing it to ok/0 would reintroduce this file's whole defect one level down.
  const allJunk = R({ http: 200, body: [null, 42, 'x'] });
  ok(allJunk.status === 'unavailable' && allJunk.reason === 'malformed',
    '14d an all-junk array is malformed, never a successful zero');
  ok(R({ http: 200, body: [] }).status === 'ok',
    '14e ...while a genuinely empty array is still a successful zero');
}

console.log('\n15. The page and the DDL of record carry the same contract');
{
  ok(/truncated: !!natl\.truncated/.test(mapExec), '15a the signal carries truncated');
  ok(/national data-center plane truncated at/.test(mapExec), '15b a truncated read warns, distinctly');
  ok(/has_more boolean/.test(sqlExec), '15c the RPC returns has_more');
  ok(/limit \(select n \+ 1 from lim\)/.test(sqlExec),
    '15d it fetches cap+1 — at exactly `cap` rows a full set and a clipped one are identical');
  ok(/1000::int as n/.test(sqlExec), '15e the cap is 1000, written in ONE place');
  ok(!/limit 200;/.test(sqlExec), '15f the old silent 200 cap is gone');
  ok(/order by c\.distance_mi asc, c\.source_key/.test(sqlExec),
    '15g a total order, so which rows a truncation keeps is deterministic');
}

console.log(`\n${fails ? `FAILED: ${fails}` : 'ALL PASS'} — national plane failure visibility`);
if (fails) process.exit(1);
