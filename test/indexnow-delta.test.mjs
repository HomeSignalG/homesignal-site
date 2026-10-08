// Semantic page-change detection (scripts/page_semantics.py) driven through the SHIPPED generator.
//
// Everything here runs gen_zip_pages.py over fixtures, twice: once to seed a baseline, once with a
// change. The delta, the lastmod and the notification set are read from what the generator wrote,
// so this cannot drift from production the way a re-implementation would. Pinned:
//   A  one new government notice changes ONLY the pages that show it
//   B  one new meeting changes exactly the pages that render it
//   C  one new local-news story changes exactly the ZIPs it was materialized onto
//   D  a development project addition / lifecycle change moves the ZIP, city and project pages
//   E  a lifecycle/type change is a semantic delta
//   F  an identical re-ingest is ZERO delta
//   G  a different build day alone is ZERO delta (the "Compiled on <day>" line is not content)
//   H  first run seeds and notifies nothing
//   I  indexable -> noindex notifies exactly that canonical URL (and noindex -> indexable too)
//   J  a removed project page notifies its removal
//   P/Q/R  lastmod: preserved when unchanged, the change instant when changed, omitted when unknown
//   Y  the baseline is the PRE-deploy live state; an unreadable one fails closed
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
const SCRIPTS = join(root, 'scripts');
const FIXDIR = join(root, 'test', 'fixtures', 'city-pages');
// Two bases. ALERTS: the Rule F fixture (notices, news, meetings under a county root, no cities or
// projects). DEV: the city/project fixture (Rule D entities, a city page, featured projects).
const ALERT_DIR = join(root, 'test', 'fixtures');
const ALERT_ZIPS = JSON.parse(readFileSync(join(ALERT_DIR, 'zip-pages.json'), 'utf8'));
const ALERT_PLANE = JSON.parse(readFileSync(join(ALERT_DIR, 'development_seo_plane.json'), 'utf8'));
const BASE_ZIPS = JSON.parse(readFileSync(join(FIXDIR, 'zip-pages.json'), 'utf8'));
const BASE_PLANE = JSON.parse(readFileSync(join(FIXDIR, 'development_seo_plane.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://homesignal.net/</loc>
  </url>
</urlset>
`;

// ---- the same input recipe test/project-pages.test.mjs uses (cities + featured projects) ----
const CASES = {
  'https://permits.example.gov/r/1': 'BLD-2026-0001', 'https://permits.example.gov/r/2': 'CIV 2026/002',
  'https://permits.example.gov/r/3': 'ROAD.3', 'https://permits.example.gov/r/4': 'BLD-2026-0004',
  'https://permits.example.gov/r/5': 'BLD_2026_0001', 'https://permits.example.gov/r/6': 'LAB-6',
  'https://permits.example.gov/r/7': 'SOL-7', 'https://permits.example.gov/r/8': 'SUB-8',
  'https://permits.example.gov/r/9': 'TH-9', 'https://permits.example.gov/r/10': 'NEW-10',
};
const keyFor = (url) => (url.endsWith('/r/6')
  ? `socrata:data.town.gov:ab12-cd34:${CASES[url]}|1` : `arcgis:town-permits:${CASES[url]}|1`);

function inputs({ zips = BASE_ZIPS, plane = BASE_PLANE, mutate } = {}) {
  const pl = clone(plane);
  const projects = {};
  const add = (e, zs) => {
    const k = keyFor(e.source_url);
    e.key = k;
    const prev = projects[k];
    projects[k] = { registry_id: 'town-permits', case: CASES[e.source_url], name: e.name, type: e.type,
      status: e.status, source_url: e.source_url, zips: [...new Set([...(prev ? prev.zips : []), ...zs])].sort(),
      ...(e.date ? { date: e.date, date_kind: 'filed' } : {}) };
  };
  for (const [z, rec] of Object.entries(pl.zips)) for (const e of rec.representative_entities || []) add(e, [z]);
  for (const c of Object.values(pl.cities)) for (const e of c.representative_entities || []) add(e, [e.zip]);
  projects[keyFor('https://permits.example.gov/r/1')].zips = ['01002', '01003'];
  const { cities, ...zipPlane } = pl;
  const docs = { zips: clone(zips), zipPlane,
    citiesDoc: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, cities },
    projectsDoc: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at,
      scope: 'featured', projects } };
  if (mutate) mutate(docs);
  return docs;
}

function alertInputs({ mutate } = {}) {
  const docs = { zips: clone(ALERT_ZIPS), zipPlane: clone(ALERT_PLANE), citiesDoc: null, projectsDoc: null };
  if (mutate) mutate(docs);
  return docs;
}

// Build once. `baseline` is the previous build's sitemaps/page-state.json text (or null = none).
function gen(docs, { baseline = null, now = '2026-09-28T00:00:00', extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'inx-fix-'));
  writeFileSync(join(dir, 'zip-pages.json'), JSON.stringify(docs.zips));
  writeFileSync(join(dir, 'development_seo_plane.json'), JSON.stringify(docs.zipPlane));
  if (docs.citiesDoc) writeFileSync(join(dir, 'development_seo_cities.json'), JSON.stringify(docs.citiesDoc));
  if (docs.projectsDoc) writeFileSync(join(dir, 'development_seo_projects.json'), JSON.stringify(docs.projectsDoc));
  const out = mkdtempSync(join(tmpdir(), 'inx-out-'));
  writeFileSync(join(out, 'sitemap.xml'), SITEMAP);
  const args = [GEN, '--fixture', join(dir, 'zip-pages.json'), '--out', out, '--now', now,
    '--delta-out', join(dir, 'delta.json'), ...extra];
  if (baseline !== null) { writeFileSync(join(dir, 'baseline.json'), baseline); args.push('--baseline', join(dir, 'baseline.json')); }
  const r = spawnSync('python3', args, { encoding: 'utf8' });
  const o = { r, out, dir, status: r.status };
  if (r.status === 0) {
    o.delta = JSON.parse(readFileSync(join(dir, 'delta.json'), 'utf8'));
    o.stateText = readFileSync(join(out, 'sitemaps', 'page-state.json'), 'utf8');
    o.state = JSON.parse(o.stateText);
    o.sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
  }
  return o;
}
const touched = (d) => [...d.added, ...d.changed, ...d.indexability_changed, ...d.removed].sort();
const lastmodOf = (sm, path) => {
  const m = sm.match(new RegExp(`<loc>https://homesignal\\.net${path.replace(/[/]/g, '\\/')}</loc>\\s*(?:<lastmod>([^<]*)</lastmod>)?`));
  return m ? (m[1] || null) : undefined;
};

// =====================================================================================
// H. first run: seeds, notifies nothing
const sD = gen(inputs());
ok(sD.status === 0, `H0 the seed build succeeds (${(sD.r.stderr || '').trim().slice(-200)})`);
ok(sD.delta.seed === true && sD.delta.submit.length === 0,
   'H  first run seeds the state and submits ZERO URLs (no historical bulk submission)');
ok(Object.keys(sD.state.pages).length >= 8 && sD.state.semantic_version === 1 && sD.state.host === 'https://homesignal.net',
   `H2 the seed state tracks every generated page (${Object.keys(sD.state.pages).length})`);
const fams = new Set(Object.keys(sD.state.pages).map((p) => p.split('/')[1]));
ok(['community', 'city', 'project', 'guides'].every((f) => fams.has(f)),
   'H3 the state spans ZIP, city, project and guide pages');
ok(!Object.keys(sD.state.pages).some((p) => /\/projects\/$/.test(p)),
   'H4 the noindex ZIP project-list pages are not tracked (never submitted, never in a sitemap)');
const sA = gen(alertInputs());
ok(sA.status === 0 && sA.delta.seed && sA.delta.submit.length === 0, 'H5 the alerts-fixture seed also notifies nothing');
const DEV_STATE = sD.stateText, ALERT_STATE = sA.stateText;
const baseHash = sD.state.state_hash;
const nPages = Object.keys(sD.state.pages).length;

// =====================================================================================
// F. identical re-ingest: zero delta
const f1 = gen(inputs(), { baseline: DEV_STATE });
ok(f1.status === 0 && !f1.delta.seed, 'F0 a build against the baseline succeeds and is not a seed');
ok(touched(f1.delta).length === 0 && f1.delta.submit.length === 0 && f1.state.state_hash === baseHash,
   'F  a duplicate / no-op ingest: 0 changed, 0 submitted, identical state_hash');

// G. build day alone is not content (dev base: ZIP, city, project and guide pages all print a day)
const g1 = gen(inputs(), { baseline: DEV_STATE, now: '2026-10-05T12:30:00' });
const docA = readFileSync(join(sD.out, 'community', '01002', 'index.html'), 'utf8');
const docG = readFileSync(join(g1.out, 'community', '01002', 'index.html'), 'utf8');
ok(docA !== docG && docG.includes('2026-10-05') && docA.includes('2026-09-28'),
   'G0 control: the two builds really differ in the "Compiled on" day');
ok(touched(g1.delta).length === 0 && g1.delta.submit.length === 0 && g1.state.state_hash === baseHash,
   'G  changing only the build day produces ZERO semantic deltas and ZERO submissions (all page families)');
ok(!readdirHasToken(g1.out) && !readdirHasToken(sD.out), 'G1 the build-day token never reaches a written file');
function readdirHasToken(dir) {
  const r = spawnSync('grep', ['-rl', '@@HS-BUILD-DAY@@', dir], { encoding: 'utf8' });
  return r.stdout.trim().length > 0;
}

// P. unchanged page keeps its lastmod. Give the baseline a known lastmod on a page, then rebuild.
const withLm = JSON.parse(ALERT_STATE);
withLm.pages['/community/01002/'].l = '2026-08-01T10:00:00Z';
const p1 = gen(alertInputs(), { baseline: JSON.stringify(withLm) });
ok(p1.status === 0 && p1.state.pages['/community/01002/'].l === '2026-08-01T10:00:00Z'
   && lastmodOf(p1.sitemap, '/community/01002/') === '2026-08-01T10:00:00Z',
   'P  an unchanged page preserves its prior TRUE lastmod (state and sitemap), never the build day');
const noLm = Object.entries(p1.state.pages).find(([p, e]) => p.startsWith('/community/') && e.i === 1 && p !== '/community/01002/');
ok(noLm && lastmodOf(p1.sitemap, noLm[0]) === null,
   'R  a page with no known modification time has lastmod OMITTED, not invented');

// =====================================================================================
// A. one government notice in ONE zip
const a1 = gen(alertInputs({ mutate: (d) => d.zips.changes.push(
  { zip: '01002', community_id: 'c-x', category: 'Government & civic', title: 'Notice of zoning hearing',
    source_ref: 'https://gov.example/n-new', occurred_at: '2026-09-27' }) }),
  { baseline: JSON.stringify(withLm), now: '2026-09-28T07:15:30' });
ok(a1.status === 0, `A0 build succeeds (${(a1.r.stderr || '').trim().slice(-200)})`);
ok(eq(touched(a1.delta), ['/community/01002/']),
   `A  one new notice changes ONLY the page that shows it (got ${JSON.stringify(touched(a1.delta))} of ${nPages})`);
ok(a1.delta.submit.includes('/community/01002/') && a1.delta.submit.length === 1,
   'A1 and exactly that one URL is notified');
ok(a1.state.pages['/community/01002/'].l === '2026-09-28T07:15:30Z'
   && lastmodOf(a1.sitemap, '/community/01002/') === '2026-09-28T07:15:30Z',
   'Q  the changed page gets the change instant as lastmod, in the page state AND the sitemap');
ok(a1.state.pages['/community/99999/'].l === null,
   'Q1 neighbouring unchanged pages are untouched');

// B. one meeting on the county community renders on every ZIP under it
const MTG = 'Zoning Board of Appeals special session';
const b1 = gen(alertInputs({ mutate: (d) => d.zips.meetings.push(
  { id: 'm-new', community_id: 'county-1', title: MTG, meeting_date: '2026-10-01T18:00:00',
    category: 'Planning, zoning & development', source_url: 'https://gov.example/m-new' }) }),
  { baseline: ALERT_STATE });
const showing = ['01001', '01002', '07010', '99999', '02543', '01003'].filter((z) => {
  const f = join(b1.out, 'community', z, 'index.html');
  return existsSync(f) && readFileSync(f, 'utf8').includes(MTG);
}).map((z) => `/community/${z}/`).sort();
ok(showing.length >= 1 && showing.length < 6, `B0 control: the meeting renders on ${showing.length} page(s), not all`);
ok(eq(touched(b1.delta).filter((p) => p.startsWith('/community/')), showing),
   'B  a new meeting is a page delta on exactly the pages that render it');

// C. one local-news story materialized onto two ZIPs
const c1 = gen(alertInputs({ mutate: (d) => {
  for (const z of ['01002', '07010']) {
    d.zips.changes.push({ zip: z, community_id: 'c-x', category: 'Local News', title: `Library reopens in ${z}`,
      source_ref: `https://gazette.example/lib-${z}`, occurred_at: '2026-09-27' });
  }
  d.zips.agency.push({ source_url: 'https://gazette.example/lib-01002', agency_name: 'The Gazette' },
                     { source_url: 'https://gazette.example/lib-07010', agency_name: 'The Gazette' });
} }), { baseline: ALERT_STATE });
ok(eq(touched(c1.delta).filter((p) => p.startsWith('/community/')), ['/community/01002/', '/community/07010/']),
   'C  a local-news story changes every ZIP it was materialized on, and only those');

// D/E. development: lifecycle change on a project moves the ZIP page and the project page
const target = 'https://permits.example.gov/r/1';
const d1 = gen(inputs({ mutate: (d) => {
  for (const rec of Object.values(d.zipPlane.zips)) for (const e of rec.representative_entities || []) {
    if (e.source_url === target) e.status = 'Operating';
  }
  for (const c of Object.values(d.citiesDoc.cities)) for (const e of c.representative_entities || []) {
    if (e.source_url === target) e.status = 'Operating';
  }
  d.projectsDoc.projects[keyFor(target)].status = 'Operating';
} }), { baseline: DEV_STATE });
const projPath = Object.keys(sD.state.pages).find((p) => p.startsWith('/project/') && p.includes('bld-2026-0001-'));
ok(!!projPath, 'E0 control: the project page exists in the baseline');
ok(d1.delta.changed.includes(projPath), 'E  a lifecycle change is a semantic delta on that project page');
ok(d1.delta.changed.some((p) => p === '/community/01002/'), 'E1 and on the ZIP page that lists it');
// SOL-7 sits on ZIP 01007 only, which shares no ZIP with the changed project (01002, 01003), so it
// is not one of its "more projects in this ZIP" neighbours.
const otherProj = Object.keys(sD.state.pages).find((p) => p.startsWith('/project/') && p.includes('sol-7-'));
ok(!!otherProj && !touched(d1.delta).includes(otherProj),
   'E2 an unrelated project page is not touched (not "everything changed")');
ok(touched(d1.delta).length < nPages, `E3 the delta is a strict subset of the ${nPages} pages`);

// D. project addition: a new featured project adds a page
const NEWURL = 'https://permits.example.gov/r/10';
const d2 = gen(inputs({ mutate: (d) => {
  const e = { id: 'e-new', name: 'Fairview Townhomes Phase 3', source_url: NEWURL, status: 'Proposed',
    type: 'Residential', date: '2026-09-20', key: keyFor(NEWURL) };
  d.zipPlane.zips['01003'].representative_entities.push(e);
  d.projectsDoc.projects[keyFor(NEWURL)] = { registry_id: 'town-permits', case: CASES[NEWURL], name: e.name,
    type: e.type, status: e.status, source_url: NEWURL, zips: ['01003'], date: e.date, date_kind: 'filed' };
} }), { baseline: DEV_STATE });
const addedProject = d2.delta.added.find((p) => p.startsWith('/project/'));
ok(d2.status === 0 && !!addedProject && d2.delta.submit.includes(addedProject),
   `D  a newly added project page is notified (${addedProject})`);
ok(d2.delta.changed.includes('/community/01003/'), 'D1 and the ZIP page that now lists it is a delta');

// J. a removed project page notifies its removal. The project leaves the featured-projects
// document (a released source drops its pages); the Rule D plane is untouched.
const removedKey = keyFor('https://permits.example.gov/r/7');
const removedPath = Object.keys(sD.state.pages).find((p) => p.startsWith('/project/') && p.includes('sol-7-'));
const j1 = gen(inputs({ mutate: (d) => { delete d.projectsDoc.projects[removedKey]; } }), { baseline: DEV_STATE });
ok(j1.status === 0, `J0 build without the project succeeds (${(j1.r.stderr || '').trim().slice(-200)})`);
ok(j1.delta.removed.includes(removedPath) && j1.delta.submit.includes(removedPath),
   `J  a project page that no longer exists is in the removed set and IS notified (${removedPath})`);
ok(!existsSync(join(j1.out, ...removedPath.split('/').filter(Boolean), 'index.html')),
   'J1 control: the document is really gone from the artifact (it will 404)');

// I. indexable -> noindex: take the county meetings (01002's only Rule F content) away
const noindexZips = clone(ALERT_ZIPS);
noindexZips.changes = noindexZips.changes.filter((c) => c.zip !== '01002');
noindexZips.meetings = [];
const noindexIn = (extra) => alertInputs({ mutate: (d) => {
  d.zips = noindexZips; delete d.zipPlane.zips['01002'];     // 01002 also qualified through Rule D
  if (extra) extra(d); } });
const i1 = gen(noindexIn(), { baseline: ALERT_STATE });
const wasIdx = JSON.parse(ALERT_STATE).pages['/community/01002/'].i;
ok(wasIdx === 1, 'I0 control: 01002 was indexable in the baseline');
ok(i1.state.pages['/community/01002/'].i === 0 && i1.delta.indexability_changed.includes('/community/01002/'),
   'I  a formerly indexable ZIP that becomes noindex is an indexability change');
ok(i1.delta.submit.includes('/community/01002/'),
   'I1 and its canonical URL IS notified so the crawler discovers the directive');
const noidxDoc = readFileSync(join(i1.out, 'community', '01002', 'index.html'), 'utf8');
ok(/name="robots" content="noindex/.test(noidxDoc), 'I2 the document itself says noindex (the fingerprint reads the page, not a side channel)');
const i2 = gen(alertInputs(), { baseline: i1.stateText });
ok(i2.delta.indexability_changed.includes('/community/01002/') && i2.delta.submit.includes('/community/01002/'),
   'I3 noindex -> indexable is announced too');
const nx = gen(noindexIn((d) => d.zips.changes.push(
  { zip: '01002', community_id: 'c-ln', category: 'Government & civic', title: 'One lone notice',
    source_ref: 'https://gov.example/lone', occurred_at: '2026-09-27' })), { baseline: i1.stateText });
ok(nx.delta.changed.includes('/community/01002/') && !nx.delta.submit.includes('/community/01002/'),
   'I4 a page that stays noindex is a change but is not submitted (crawl budget)');

// =====================================================================================
// Y. the baseline contract
const bad = gen(alertInputs(), { baseline: '{"not":"a state document"}' });
ok(bad.status !== 0 && /baseline is unusable/.test(bad.r.stderr + bad.r.stdout),
   'Y  an unusable baseline FAILS the build; it is never silently treated as a first run');
const truncated = JSON.parse(ALERT_STATE); delete truncated.pages['/community/01002/'];
const bad2 = gen(alertInputs(), { baseline: JSON.stringify(truncated) });
ok(bad2.status !== 0, 'Y1 a baseline whose pages disagree with its own state_hash is refused (truncated/edited file)');
const re = gen(alertInputs(), { baseline: '{"not":"a state document"}', extra: ['--reseed'] });
ok(re.status === 0 && re.delta.seed && re.delta.submit.length === 0, 'Y2 --reseed publishes the state and notifies nothing');
const old = JSON.parse(ALERT_STATE); old.semantic_version = 0;
// a baseline of another semantic version must re-hash identically to be loadable: rebuild its hash
const oldPages = old.pages;
const pyHash = execFileSync('python3', ['-c', `import sys,json; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import page_semantics as ps; print(ps.state_hash(json.loads(sys.stdin.read())))`],
  { input: JSON.stringify(oldPages), encoding: 'utf8' }).trim();
old.state_hash = pyHash;
const v0 = gen(alertInputs({ mutate: (d) => d.zips.changes.push({ zip: '01002', community_id: 'c-x', category: 'Government & civic', title: 'X', source_ref: 'https://gov.example/x', occurred_at: '2026-09-27' }) }),
  { baseline: JSON.stringify(old) });
ok(v0.status === 0 && v0.delta.seed && v0.delta.submit.length === 0,
   'Y3 a baseline from another semantic_version is incomparable: reseed, notify nothing');

// project lastmod keeps its existing authority (changed_on) and is stable across no-op builds
const projLm = lastmodOf(sD.sitemap, projPath);
ok(projLm === undefined || projLm === null || /^\d{4}-\d{2}-\d{2}$/.test(projLm),
   `P1 project-page lastmod stays on its own changed_on authority (${projLm})`);

// =====================================================================================
// The projection itself: what is, and is not, a semantic change
const proj = JSON.parse(execFileSync('python3', ['-c', `
import sys, json; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import page_semantics as ps
def page(title='T', desc='D', robots='index, follow', canon='https://homesignal.net/community/84302/', body='<main>Hello</main>',
         ld='{"a":1}', js='/shell.js?v=aaaa', css='/app.css?v=1111', csp="default-src 'self'", day='@@HS-BUILD-DAY@@'):
    return ('<!DOCTYPE html><html><head><meta charset="UTF-8"><base href="/">'
      '<meta name="viewport" content="width=device-width">'
      f'<meta name="robots" content="{robots}"><title>{title}</title><meta name="description" content="{desc}">'
      f'<link rel="canonical" href="{canon}"><meta http-equiv="Content-Security-Policy" content="{csp}">'
      f'<script type="application/ld+json">{ld}</script><link rel="stylesheet" href="{css}"></head>'
      f'<body>{body}<p>Compiled <time datetime="{day}">{day}</time></p><template id="hs-content"><div>x</div></template>'
      f'<script src="{js}"></script></body></html>')
f = lambda **k: ps.fingerprint(page(**k))
base = f()
r = {}
for name, k in [('script_version', dict(js='/shell.js?v=bbbb')), ('css_version', dict(css='/app.css?v=2222')),
                ('csp', dict(csp="default-src 'none'"))]:
    r['same_' + name] = f(**k) == base
for name, k in [('title', dict(title='T2')), ('description', dict(desc='D2')), ('robots', dict(robots='noindex, follow')),
                ('canonical', dict(canon='https://homesignal.net/community/84303/')), ('body', dict(body='<main>Hello!</main>')),
                ('jsonld', dict(ld='{"a":2}'))]:
    r['diff_' + name] = f(**k) != base
# content that merely EQUALS the build day is content: it must not be masked
r['literal_date_is_content'] = f(body='<main><time datetime="2026-09-28">2026-09-28</time></main>') != f(body='<main><time datetime="2026-09-29">2026-09-29</time></main>')
r['robots_read'] = [ps.is_indexable(page()), ps.is_indexable(page(robots='noindex, follow')), ps.is_indexable(page(robots='NOINDEX,nofollow'))]
try:
    ps.is_indexable('<html><head></head></html>'); r['no_robots'] = 'ACCEPTED'
except ValueError: r['no_robots'] = 'refused'
print(json.dumps(r))`], { encoding: 'utf8' }).trim().split('\n').pop());
ok(proj.same_script_version && proj.same_css_version && proj.same_csp,
   'X0 a script/stylesheet cache-busting ?v= or a CSP edit is NOT a semantic change (it would otherwise re-announce every page)');
ok(proj.diff_title && proj.diff_description && proj.diff_robots && proj.diff_canonical && proj.diff_body && proj.diff_jsonld,
   'X1 title, meta description, robots, canonical, body text and JSON-LD each ARE semantic changes');
ok(proj.literal_date_is_content, 'X2 a content date that happens to equal the build day is content, not masked');
ok(JSON.stringify(proj.robots_read) === '[true,false,false]' && proj.no_robots === 'refused',
   'X3 indexability is read from the document\'s own robots meta; a document without one is refused, not guessed');

// =====================================================================================
// as_of: the plane producer sets a TRACKED project's as_of to today on every run. It is
// bookkeeping, not a fact: moving it alone must not re-announce the page.
const asOf = gen(inputs({ mutate: (d) => { for (const pr of Object.values(d.projectsDoc.projects)) { pr.as_of = '2026-09-27'; } } }),
  { baseline: DEV_STATE });
const asOf2 = gen(inputs({ mutate: (d) => { for (const pr of Object.values(d.projectsDoc.projects)) { pr.as_of = '2026-10-04'; } } }),
  { baseline: asOf.stateText, now: '2026-10-05T06:40:00' });
const asOfDoc1 = readFileSync(join(asOf.out, ...projPath.split('/').filter(Boolean), 'index.html'), 'utf8');
const asOfDoc2 = readFileSync(join(asOf2.out, ...projPath.split('/').filter(Boolean), 'index.html'), 'utf8');
ok(asOfDoc1 !== asOfDoc2 && asOfDoc2.includes('Oct 4, 2026'), 'S0 control: the written page really shows the new "Status as of" day');
ok(asOf2.status === 0 && touched(asOf2.delta).length === 0 && asOf2.delta.submit.length === 0,
   `S  a tracked project\'s daily as_of advance is ZERO delta (it would otherwise re-announce every project page each morning)`);
const lost = gen(inputs({ mutate: (d) => { for (const pr of Object.values(d.projectsDoc.projects)) { pr.tracked = false; pr.as_of = '2026-09-27'; } } }),
  { baseline: DEV_STATE });
ok(lost.delta.changed.includes(projPath), 'S1 a project that stops being tracked IS a change (the page now says HomeSignal no longer tracks it)');
// determinism: two same-day, same-title rows must not make the page flip with row order
const tie = (order) => alertInputs({ mutate: (d) => {
  const rows = [{ zip: '99999', community_id: 'c-h', category: 'Government & civic', title: 'Flood Warning', source_ref: 'https://gov.example/fw-1', occurred_at: '2026-09-27' },
                { zip: '99999', community_id: 'c-h', category: 'Government & civic', title: 'Flood Warning', source_ref: 'https://gov.example/fw-2', occurred_at: '2026-09-27' }];
  d.zips.changes.push(...(order ? rows : rows.reverse()));
} });
const tA = gen(tie(true), { baseline: ALERT_STATE });
const tB = gen(tie(false), { baseline: tA.stateText });
ok(tA.status === 0 && tB.status === 0 && touched(tB.delta).length === 0,
   'S2 the same rows arriving in a different order (app_changes is rewritten per ZIP refresh) is ZERO delta');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
