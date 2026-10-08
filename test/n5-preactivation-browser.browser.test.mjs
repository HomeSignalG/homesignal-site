// N5 PRE-ACTIVATION PROOF — THE BROWSER HALF (scripts/n5_preactivation_browser.mjs), offline.
//
// Drives the real homesignalmap.html in Chromium with two generations' answers for three ZIPs
// (one that changes between them, one identical, one not measured) and asserts that the probe
// passes when the page renders each answer, SEES the difference between the two (a live
// control), and fails when the page is served something other than the answer it is checked
// against — on one side, on both sides identically (the difference alone would still match),
// and when the read returns nothing usable.
//
// Run: node test/n5-preactivation-browser.browser.test.mjs
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.log('SKIP — playwright not installed'); process.exit(0); }
const { runParity, expectedKeys } = await import('../scripts/n5_preactivation_browser.mjs');

let fails = 0;
const ok = (c, name, extra) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : ''));
  if (!c) fails++;
};

const project = (ref, name) => ({ project_ref: ref, name, type: 'Commercial', status: 'Approved',
  source_ref: 'https://example.gov/record/' + ref, registry_id: 'fixture-registry', submitted_at: '2026-01-01' });
const marker = (ref, lat, lng, seq = 1) => ({ project_ref: ref, lat, lng, marker_seq: seq, marker_rule: 'POINT_AUTHORITATIVE' });
const answer = (zip, projects, markers) => ({ zip, mode: 'development', status: 'boundary_complete', projects, markers,
  marker_count: markers.length, project_count: projects.length, membership_count: projects.length });
const unmeasured = (zip) => ({ zip, mode: 'development', status: 'not_measured', projects: null, markers: null });

// 11101: P1 leaves, P2's marker moves, P3 joins.  11102: identical.  11199: not measured.
const A = ['P1', 'P2', 'P9'], B = ['P2', 'P3', 'P9'];
const input = {
  candidate_generation_id: 'gen-new', baseline_generation_id: 'gen-serving',
  zips: [
    { zip: '11101', home_lat: 40.0, home_lng: -75.0,
      baseline: answer('11101', A.map((r) => project(r, 'Project ' + r)),
                       [marker('P1', 40.001, -75.001), marker('P2', 40.002, -75.002), marker('P9', 40.009, -75.009)]),
      candidate: answer('11101', B.map((r) => project(r, 'Project ' + r)),
                        [marker('P2', 40.0025, -75.0025), marker('P3', 40.003, -75.003), marker('P9', 40.009, -75.009)]) },
    { zip: '11102', home_lat: 40.1, home_lng: -75.1,
      baseline: answer('11102', [project('Q1', 'Q1')], [marker('Q1', 40.101, -75.101)]),
      candidate: answer('11102', [project('Q1', 'Q1')], [marker('Q1', 40.101, -75.101)]) },
    { zip: '11199', home_lat: 40.2, home_lng: -75.2, baseline: unmeasured('11199'), candidate: unmeasured('11199') },
  ],
};

ok(expectedKeys(input.zips[0].candidate).length === 3 && expectedKeys(input.zips[2].candidate).length === 0,
   'CONTROL: the shipped builder makes 3 sites from the 11101 answer and none from a not-measured one');

const opts = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.HS_CHROME) opts.executablePath = process.env.HS_CHROME;
const browser = await chromium.launch(opts);
try {
  const good = await runParity(input, { browser });
  const z = Object.fromEntries(good.zips.map((r) => [r.zip, r]));
  ok(good.passed === true && good.mismatches === 0 && good.zips_checked === 3,
     '1 the page renders exactly each generation\'s answer for every sample ZIP', good.zips);
  ok(z['11101'].candidate.rendered === 3 && z['11101'].baseline.rendered === 3,
     '1b both 11101 renders drew 3 sites (not a pass over two empty pages)', z['11101']);
  ok(good.differing_zips === 1 && z['11101'].added === 2 && z['11101'].removed === 2 && z['11102'].added === 0,
     '2 LIVE CONTROL: the page saw 11101 change (P3 and P2\'s new spot in, P1 and P2\'s old spot out) and 11102 not',
     { differing: good.differing_zips, added: z['11101'].added, removed: z['11101'].removed });

  const dropFirst = (p) => (p && p.markers ? { ...p, markers: p.markers.slice(1) } : p);
  const one = await runParity(input, { browser, tamper: (zip, side, p) => (zip === '11101' && side === 'candidate' ? dropFirst(p) : p) });
  ok(one.passed === false && one.mismatches === 1 && one.zips.find((r) => r.zip === '11101').candidate.equal === false,
     '3 a page that renders something other than the candidate\'s answer fails the proof', one.zips.map((r) => [r.zip, r.ok]));

  const moved = await runParity(input, { browser, tamper: (zip, side, p) => (zip === '11102' && side === 'candidate'
    ? { ...p, markers: p.markers.map((m) => ({ ...m, lat: m.lat + 0.01 })) } : p) });
  ok(moved.passed === false && moved.zips.find((r) => r.zip === '11102').candidate.equal === false,
     '3b the same NUMBER of sites in the wrong place fails: sites are compared by identity and position, not counted');

  const both = await runParity(input, { browser, tamper: (zip, side, p) => (zip === '11102' ? dropFirst(p) : p) });
  const r2 = both.zips.find((r) => r.zip === '11102');
  ok(both.passed === false && r2.diff_equal === true && r2.ok === false,
     '4 the same wrong render on BOTH sides still fails, though the difference alone would match', r2);

  const broken = await runParity(input, { browser, tamper: (zip, side, p) => (zip === '11102' && side === 'baseline' ? { error: 'x' } : p) });
  ok(broken.passed === false && broken.zips.find((r) => r.zip === '11102').ok === false,
     '5 an unusable answer for the serving generation fails the proof, never a vacuous pass');

  const unasked = await runParity(input, { browser, markersRpc: 'a_renamed_rpc' });
  ok(unasked.passed === false && unasked.zips.find((r) => r.zip === '11199').ok === false,
     '7 a page that never asked for the answer fails, even where the answer is empty (11199)',
     unasked.zips.map((r) => [r.zip, r.ok]));

  const none = await runParity({ ...input, zips: [] }, { browser });
  ok(none.passed === false && none.zips_checked === 0, '6 an empty sample fails, never a vacuous pass');
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
