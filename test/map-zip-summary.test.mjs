// Development Map indexing pilot (2026-11-11): the static ZIP summary on /map/<zip>/.
// scripts/map_zip_summary.py writes it OUTSIDE the inert <template> from the plane count and the ZIP's
// project pages; data/seo-map-pilot.json decides which ZIPs get it. This runs the SHIPPED generator over
// the city-pages fixture (the one test/project-pages.test.mjs uses) and pins:
//   1. the summary is in the first HTML, with the right ZIP, count scope, records, dates and links
//   2. held (not measured) and absent (below the bar) ZIPs say different, true things; no "nothing here"
//   3. a control ZIP's document is byte-identical to a build with the pilot off
//   4. project-list pages of treated ZIPs link to their map; controls do not
//   5. change detection: an edited, added or removed record moves only that ZIP's map; a rebuild of the
//      same data moves nothing; the sitemap lastmod and the IndexNow submit list follow the fingerprint
//   6. the manifest fails closed, and equals the committed selection output
//   (the Chromium half is test/map-zip-summary.browser.test.mjs)
// No network, no IndexNow call: the notify step is exercised with a mock post.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, TREAT, makeDocs, manifest, build, read, visibleText, summaryOf } from './lib/map-zip-summary-fixture.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

// ---- 1. the summary is in the first HTML ------------------------------------------------------
const docs = makeDocs();
const A = build(docs, manifest('pilot'));
ok(A.r.status === 0, `pilot build succeeds (${(A.r.stderr || '').trim().slice(-300)})`);
ok(/map summary {4}: mode pilot; 3 \/map\/<zip>\/ documents carry the static ZIP summary/.test(A.r.stdout),
  'the build reports 3 summaries for 3 treatment ZIPs');
const m2 = read(A.out, '/map/01002/');
const s2 = summaryOf(m2);
ok(s2.length > 0, '01002: the summary is outside the <template>');
ok(!/<template[\s\S]*hs-map-zip-summary[\s\S]*<\/template>/.test(m2), '01002: and not inside it');
ok(visibleText(m2).split(' ').length > 60, `01002: first-HTML visible words ${visibleText(m2).split(' ').length} (> 60; was 6)`);
ok(s2.includes('Development records for ZIP 01002'), '01002: heading names this ZIP');
ok(s2.includes('HomeSignal counts 3 distinct development projects on record for ZIP 01002'), '01002: count = the plane count (3), with its scope');
ok(s2.includes('same count the ZIP&#x27;s community page uses'), '01002: the scope is stated');
ok(s2.includes('its totals can differ'), '01002: the map\'s own totals are not claimed equal');
const projLinks = [...s2.matchAll(/<a href="(\/project\/[^"]+)">/g)].map((m) => m[1]);
const expectedProjects = Object.values(docs.projects.projects).filter((p) => p.zips.includes('01002'));
ok(projLinks.length === expectedProjects.length && projLinks.length === 3, `01002: one link per project page on the ZIP (${projLinks.length})`);
ok(projLinks.every((p) => existsSync(join(A.out, ...p.split('/').filter(Boolean), 'index.html'))), '01002: every project link resolves to a written page');
for (const p of expectedProjects) ok(s2.includes(p.name.replace(/&/g, '&amp;')), `01002: lists "${p.name}"`);
const otherZipProjects = Object.values(docs.projects.projects).filter((p) => !p.zips.includes('01002'));
ok(otherZipProjects.every((p) => !s2.includes(`>${p.name}<`)), '01002: no project from another ZIP');
ok(/Date on record: <time datetime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time> \(filed\)/.test(s2), '01002: dates say what they are (filed)');
ok(/rel="nofollow noopener">official record<\/a>/.test(s2), '01002: official record links kept');
ok(s2.includes('<a href="/community/01002/">') && s2.includes('<a href="/community/01002/projects/">'), '01002: links to its community and project-list pages');
ok(!/\b(no development|nothing is being built)\b/i.test(s2), '01002: no absence claim');
const tpl2 = (m2.match(/<template[\s\S]*?<\/template>/) || [''])[0];
ok(!/distinct development projects are on record for this ZIP/.test(tpl2), '01002: the hero inside the template no longer repeats the count');

// ---- 2. held and absent ZIPs ------------------------------------------------------------------
const s4 = summaryOf(read(A.out, '/map/01004/'));
ok(s4.includes('were not measured in this update, so no count is shown'), '01004 (held): says not measured');
ok(!/HomeSignal counts \d/.test(s4), '01004 (held): states no count');
const s9 = summaryOf(read(A.out, '/map/01009/'));
ok(s9.includes('Fewer than three development projects'), '01009 (absent from the plane): says below the bar');
ok(s9.includes('not whether development is happening here'), '01009: never equates no JODY records with no development');
ok(s4 !== s9, 'held and absent say different things');

// ---- 3. control document is unchanged -----------------------------------------------------------
const OFF = build(docs, manifest('off'));
ok(OFF.r.status === 0, 'pilot-off build succeeds');
ok(read(A.out, '/map/01003/') === read(OFF.out, '/map/01003/'), '01003 (control): byte-identical to the pilot-off build');
ok(read(A.out, '/map/01007/') === read(OFF.out, '/map/01007/'), '01007 (not in the pilot): byte-identical');
ok(summaryOf(read(OFF.out, '/map/01002/')) === '', 'pilot off: no summary anywhere');
ok(/distinct development projects are on record for this ZIP/.test(read(OFF.out, '/map/01002/')), 'pilot off: the old hero sentence is back');

// ---- 4. project-list links -----------------------------------------------------------------
ok(read(A.out, '/community/01002/projects/').includes('<a href="/map/01002/">Development map for 01002</a>'), 'treated project list links to its map');
ok(!read(A.out, '/community/01003/projects/').includes('/map/01003/'), 'control project list unchanged (no map link)');
ok(read(A.out, '/community/01003/projects/') === read(OFF.out, '/community/01003/projects/'), 'control project list byte-identical');

// ---- 5. change detection -----------------------------------------------------------------
const stateOf = (out) => join(out, 'sitemaps', 'page-state.json');
const B0 = build(docs, manifest('pilot'));
const same = build(makeDocs(), manifest('pilot'), { baseline: stateOf(B0.out), now: '2026-09-29T00:00:00' });
const mapsIn = (d) => [...(d.changed || []), ...(d.added || [])].filter((p) => p.startsWith('/map/'));
ok(same.r.status === 0 && !same.delta.seed, 'rebuild with a baseline is not a seed');
ok(mapsIn(same.delta).length === 0, `same data, next day: 0 maps changed (${mapsIn(same.delta)})`);
const k2 = Object.keys(docs.projects.projects).find((k) => docs.projects.projects[k].zips.includes('01002'));
const edited = build(makeDocs((d) => { d.projects.projects[k2].name = 'Renamed Warehouse Addition'; }), manifest('pilot'),
  { baseline: stateOf(B0.out), now: '2026-09-29T00:00:00' });
ok(edited.r.status === 0, 'edited build succeeds');
ok(JSON.stringify(mapsIn(edited.delta)) === JSON.stringify(['/map/01002/']), `edit a 01002 record: only /map/01002/ changes (${mapsIn(edited.delta)})`);
ok((edited.delta.submit || []).includes('/map/01002/'), 'and it is in the IndexNow submit list');
const mapXml = readFileSync(join(edited.out, 'sitemaps', 'map.xml'), 'utf8');
const lm = (xml, path) => (xml.match(new RegExp(`<loc>[^<]*${path.replace(/\//g, '\\/')}</loc>\\s*<lastmod>([^<]+)</lastmod>`)) || [])[1];
const baseXml = readFileSync(join(B0.out, 'sitemaps', 'map.xml'), 'utf8');
ok(lm(mapXml, '/map/01002/') === '2026-09-29T00:00:00Z', `changed map lastmod = this build (${lm(mapXml, '/map/01002/')})`);
ok(lm(mapXml, '/map/01003/') === lm(baseXml, '/map/01003/'), 'control map lastmod unchanged (never set to today)');
ok(read(edited.out, '/map/01002/').includes('Renamed Warehouse Addition'), 'the new HTML carries the edit the lastmod reports');
const removed = build(makeDocs((d) => { delete d.projects.projects[k2]; }), manifest('pilot'),
  { baseline: stateOf(B0.out), now: '2026-09-29T00:00:00' });
ok(removed.r.status === 0 && mapsIn(removed.delta).includes('/map/01002/'), 'remove a 01002 project page: /map/01002/ changes');
const added = build(makeDocs((d) => {
  d.projects.projects['arcgis:town-permits:BLD-2026-9999|1'] = { registry_id: 'town-permits', case: 'BLD-2026-9999',
    name: 'New Clinic', type: 'Civic/Public', status: 'Proposed', source_url: 'https://permits.example.gov/r/9999',
    zips: ['01002'], date: '2026-09-20', date_kind: 'filed' };
}), manifest('pilot'), { baseline: stateOf(B0.out), now: '2026-09-29T00:00:00' });
ok(added.r.status === 0 && mapsIn(added.delta).includes('/map/01002/'), 'add a 01002 project page: /map/01002/ changes');
const ctlEdit = build(makeDocs((d) => {
  const k3 = Object.keys(d.projects.projects).find((k) => d.projects.projects[k].zips.includes('01003'));
  d.projects.projects[k3].name = 'Renamed Control Project';
}), manifest('pilot'), { baseline: stateOf(B0.out), now: '2026-09-29T00:00:00' });
ok(ctlEdit.r.status === 0 && !mapsIn(ctlEdit.delta).includes('/map/01003/'),
  'edit a CONTROL record: /map/01003/ does not change (its HTML carries no records; stated limitation)');
// IndexNow with a mock post: the delta the deploy job would notify reaches submit() and nothing else.
const deltaFile = join(mkdtempSync(join(tmpdir(), 'mzs-d-')), 'delta.json');
writeFileSync(deltaFile, JSON.stringify(edited.delta));
const mock = spawnSync('python3', ['-I', '-c', `
import sys, json; sys.path.insert(0, "scripts"); import indexnow as ix
d = json.load(open(sys.argv[1])); sent = []
def post(url, body, headers, timeout=30):
    sent.append(json.loads(body)); return 200, b"", {}
ix.submit(ix.url_list(d["submit"]), "abcdefgh1234", post=post, sleep=lambda s: None)
print(json.dumps({"mass": ix.mass_change(d), "urls": [u for b in sent for u in b["urlList"]]}))
`, deltaFile], { encoding: 'utf8', cwd: root });
ok(mock.status === 0, `mock IndexNow submit ran (${(mock.stderr || '').slice(-200)})`);
const sent = mock.status === 0 ? JSON.parse(mock.stdout) : { urls: [] };
ok(sent.urls.some((u) => u.endsWith('/map/01002/')) && !sent.urls.some((u) => u.endsWith('/map/01003/')),
  'mock IndexNow receives /map/01002/ and not the control');
ok(sent.mass === false, 'not a mass change');

// ---- 6. the manifest -----------------------------------------------------------------------
const lp = (p) => JSON.parse(spawnSync('python3', ['-I', '-c',
  'import sys,json; sys.path.insert(0,"scripts"); import map_zip_summary as m; p=m.load_pilot(sys.argv[1]); print(json.dumps({"mode":p["mode"],"t":len(p["treatment"])}))', p],
  { encoding: 'utf8', cwd: root }).stdout);
ok(lp('/nonexistent/pilot.json').mode === 'off', 'missing manifest = off');
ok(lp(manifest('everything')).mode === 'off', 'unknown mode = off');
ok(lp(manifest('pilot', ['01002'], ['01002'])).mode === 'off', 'a ZIP in both arms = off');
ok(lp(manifest('pilot', ['1002'])).mode === 'off', 'a malformed ZIP = off');
const ALL = build(docs, manifest('all', [], []));
ok(ALL.r.status === 0 && summaryOf(read(ALL.out, '/map/01003/')) !== '' && summaryOf(read(ALL.out, '/map/01007/')) !== '',
  'mode all (future rollout, not enabled): every standard-area ZIP gets the summary');
const committed = JSON.parse(readFileSync(join(root, 'data', 'seo-map-pilot.json'), 'utf8'));
ok(committed.mode === 'pilot', 'the committed manifest is in pilot mode (nationwide rollout is NOT enabled)');
ok(committed.treatment.length === 100 && committed.control.length === 100, 'committed: 100 treatment + 100 control');
const rows = JSON.parse(readFileSync(join(root, committed.selection.output), 'utf8'));
const fp = createHash('md5').update(rows.map((r) => `${r.zip}:${r.arm}`).sort().join(',')).digest('hex');
ok(fp === committed.selection.fingerprint_md5 && fp === '52606b8aa27889f0a794cd08255ad33c',
  'committed manifest = the selection output, fingerprint 52606b8a (equal to the database query)');
ok(new Set(rows.filter((r) => r.arm === 'treatment').map((r) => r.state)).size >= 25, 'treatment spans 25+ states');
ok(new Set(rows.map((r) => r.grp)).size === 4, 'all four record-count groups');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
