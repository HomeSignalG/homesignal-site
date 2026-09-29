// U02 — the Development Activity report has ONE engine.
//
// Before this, the page ran lib/nyc-v1-report.js + lib/nyc-v1-soda.js and the edge function
// ran a ~600-line TypeScript re-implementation of the same thing, kept in step by comments
// ("this block must stay byte-identical to lib/nyc-v1-report.js"). Two implementations of
// one report is how the page and the API came to fingerprint the same records differently,
// and how their miss paths drifted. Now the function loads the page's own files.
//
// This suite defends that, and it asserts on what runs, not only on what is written:
//   1. the function's copy of the engine is the page's file, byte for byte;
//   2. the function holds no report logic of its own, and the check that says so can fail;
//   3. the page entry and the API entry, run in separate processes over the same
//      scenarios and the same stand-in for NYC Open Data, send the same requests and get
//      the same reports, report_id included.
//
// Run: node test/fsr-engine-one-source.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, expected, targetPath } from '../scripts/sync-fsr-engine.mjs';
import { SCENARIOS } from './lib/fsr-engine-corpus.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_DIR = 'supabase/functions/get-future-surroundings-report';
const read = (f) => readFileSync(join(root, f), 'utf8');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); }
};

// §1 — the copy is the page's file --------------------------------------------------------
FILES.forEach((name) => {
  const lib = read('lib/' + name);
  const copy = readFileSync(targetPath(name), 'utf8');
  ok(copy === expected(name), '1a ' + name + ': the function runs exactly the generated copy of lib/' + name);
  ok(copy.endsWith(lib) && copy.length > lib.length, '1b ' + name + ': under a header, the page file is the whole of the copy');
  ok(/^\/\/ GENERATED FILE\. Do not edit it\./.test(copy), '1c ' + name + ': the copy says it is generated, so nobody edits it');
});
const check = spawnSync(process.execPath, [join(root, 'scripts/sync-fsr-engine.mjs'), '--check'], { encoding: 'utf8' });
ok(check.status === 0, '1d the sync script agrees the copies are current', check.stdout + check.stderr);

// §2 — the function holds no report logic of its own -------------------------------------
const ENGINE_LOGIC = [
  /function\s+(assembleReport|nearbyFromPublisherRows|parseBuyerAddress|matchAddressPoint|sodaUrl|windowStartIso|canonicalize|sha256Hex|issuanceRow|dobnowRow|filingRow)\b/,
  /\bfetch\s*\(/,
  /crypto\.subtle/,
  /\$select|\$where|\$limit|\$order/,
  /data\.cityofnewyork\.us/,
  /\bROW_CAP\b|\bFILING_DEAD_STATUS\b|\bNEARBY_CAP\b|\bRECENT_DAYS\b/
];
const own = ['allowlist.ts', 'engine.ts', 'index.ts'];
const engineText = FILES.map((n) => read(FN_DIR + '/engine/' + n)).join('\n');
ENGINE_LOGIC.forEach((re, i) => {
  ok(re.test(engineText), '2a.' + i + ' control: the engine itself does contain ' + re.source.slice(0, 40) + '…');
  own.forEach((f) => {
    // Comments may describe the engine; only code counts.
    const code = read(FN_DIR + '/' + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(!re.test(code), '2b.' + i + ' ' + f + ' has no ' + re.source.slice(0, 40) + '…', code.match(re));
  });
});
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok(/from '\.\/engine\.ts'/.test(strip(read(FN_DIR + '/allowlist.ts'))), '2c allowlist.ts gets the engine from engine.ts');
ok(/import '\.\/engine\/nyc-v1-report\.js'/.test(strip(read(FN_DIR + '/engine.ts')))
  && /import '\.\/engine\/nyc-v1-soda\.js'/.test(strip(read(FN_DIR + '/engine.ts'))),
  '2d engine.ts loads the two generated files and nothing else');
ok(/from '\.\/allowlist\.ts'/.test(read(FN_DIR + '/index.ts')) && !/engine/.test(strip(read(FN_DIR + '/index.ts'))),
  '2e index.ts talks to allowlist.ts only, never to the engine files directly');
const listing = readdirSync(join(root, FN_DIR)).sort();
ok(JSON.stringify(listing) === JSON.stringify(['allowlist.ts', 'engine', 'engine.ts', 'index.ts']),
  '2f the function directory holds exactly these files. A new file here must be added to this list on purpose', listing);
ok(JSON.stringify(readdirSync(join(root, FN_DIR, 'engine')).sort()) === JSON.stringify(FILES.slice().sort()),
  '2g engine/ holds only the generated copies', readdirSync(join(root, FN_DIR, 'engine')));
// The API runs these files outside a browser, so they may not reach for one.
const DOM = /\bdocument\b|\blocalStorage\b|\bsessionStorage\b|\bXMLHttpRequest\b|\blocation\./;
ok(DOM.test('document.body') && DOM.test('localStorage.getItem'), '2h control: the DOM pattern matches what it should');
FILES.forEach((n) => ok(!DOM.test(strip(read('lib/' + n))), '2i lib/' + n + ' stays runtime-neutral (no DOM), because the API runs it'));

// §3 — the two entries behave the same, over real process boundaries ---------------------
const run = (surface) => {
  const r = spawnSync(process.execPath, [join(root, 'test/lib/fsr-engine-runner.mjs'), surface], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024
  });
  if (r.status !== 0) return { error: (r.stderr || '') + ' exit ' + r.status };
  return { out: JSON.parse(r.stdout) };
};
const browser = run('browser');
const api = run('api');
ok(!browser.error && !api.error, '3a both entries ran the corpus', { browser: browser.error, api: api.error });
if (!browser.error && !api.error) {
  ok(browser.out.length === SCENARIOS.length && api.out.length === SCENARIOS.length,
    '3b every scenario produced a result on both entries', [browser.out.length, api.out.length, SCENARIOS.length]);
  browser.out.forEach((b, i) => {
    const a = api.out[i];
    ok(b.name === a.name && JSON.stringify(b.requests) === JSON.stringify(a.requests),
      '3c ' + b.name + ': same requests to NYC Open Data, in the same order', { browser: b.requests, api: a.requests });
    ok(JSON.stringify(b.outcome) === JSON.stringify(a.outcome),
      '3d ' + b.name + ': same outcome, report_id included');
  });
  const by = (o, n) => o.out.find((x) => x.name === n);
  // Equal is only worth something if it is not two identical failures.
  const hit = by(api, 'hit_all_three').outcome;
  ok(hit.ok && /^[0-9a-f]{64}$/.test(hit.report.report_id) && hit.report.nearby.length === 3,
    '3e control: the main scenario builds a real report with a 64-hex report_id and three records', hit.ok ? hit.report.nearby.length : hit);
  ok(by(api, 'hit_all_three').requests.length === 8,
    '3f control: a report reads 8 publisher endpoints (4 version reads, 1 candidate read, 3 record reads)',
    by(api, 'hit_all_three').requests.length);
  ok(by(api, 'address_miss').outcome.ok && by(api, 'address_miss').outcome.report.status === 'address_miss',
    '3g control: a miss is a report with status address_miss, not an error');
  ok(by(api, 'address_candidates_capped').outcome.report.data_state.address_points_capped === true,
    '3h control: a capped candidate read is flagged on the API too');
  const bad = 'matched_point_with_unusable_coordinates';
  ok(!by(api, bad).outcome.ok && !by(browser, bad).outcome.ok
    && by(api, bad).outcome.error === 'the matching AddressPoint has no usable coordinates'
    && by(browser, bad).outcome.error === 'the matching AddressPoint has no usable coordinates',
    '3i an address that matches a point with no usable coordinates is refused, with the same message, on both surfaces');
  ok(by(api, 'publisher_view_fails').outcome.ok === false && /SODA HTTP 503/.test(by(api, 'publisher_view_fails').outcome.error),
    '3j control: a publisher outage is an error, never an empty report');
}

// §4 — what the API says about itself, and what it accepts -------------------------------
const API = await import('../' + FN_DIR + '/allowlist.ts');
ok(JSON.stringify(API.capability()) === JSON.stringify({
  product: 'HomeSignal Future Surroundings Report',
  version: 'nyc-v1',
  market: 'nyc-v1',
  host: 'data.cityofnewyork.us',
  datasets: ['uf93-f8nk', 'ipu4-2q9a', 'rbx6-tga4', 'w9ak-ipjd'],
  signed_paid_pilots: 0,
  verdict: 'NOT YET',
  note: 'POST { address, zip, radius_mi }. The function fetches only those four NYC Open Data views.'
}), '4a the capability document is byte-for-byte what it was, dataset ids now read from the engine', API.capability());
ok(API.validateApiRequest(null).error === 'JSON object required'
  && API.validateApiRequest({ address: 'x', lat: 1 }).error === 'field not on the NYC V1 allowlist: lat'
  && API.validateApiRequest({ address: '1 A St', zip: '123' }).error === 'zip must be five digits'
  && API.validateApiRequest({ address: '1 A St', radius_mi: 9 }).radius_mi === 1
  && API.validateApiRequest({ address: '1 A St', radius_mi: -2 }).radius_mi === 0.5,
  '4b request validation is unchanged');
ok(API.HOST === 'https://data.cityofnewyork.us' && API.EXCLUSIONS.length === 11 && /Open each official record and investigate/.test(API.INVESTIGATE),
  '4c the constants the API exposes come from the engine');

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
process.exit(fails ? 1 : 0);
