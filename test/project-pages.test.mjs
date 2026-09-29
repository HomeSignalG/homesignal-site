// Gates for the generated project pages (SEO plan step 12, featured projects only).
//
// Runs the SHIPPED generator and the SHIPPED Type/lifecycle adapter over the city-pages
// fixture plus a projects document, so the checks cannot drift from production. Pinned:
//   1. a page exists for each featured project, at /project/<registry_id>/<case-slug>-<h8>/,
//      is indexable, self-canonical, and in the sitemap; nothing else under /project/ is
//   2. the name is never in the URL; two cases that slug alike stay apart
//   3. ZIP and city cards link the project name to its page, and keep the official record
//   4. the project page links back to its ZIP pages, its city page and the Development map
//   5. Type and lifecycle come from lib/project-type.js; source text is escaped; no script
//   6. a featured project no page links to fails the build; a HELD project is exempt
//   7. a record that disagrees with its key, or a document from another run, fails the build
//   8. identical input produces byte-identical output
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAuthority } from '../scripts/annotate-dev-seo-ssr.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
const FIXDIR = join(root, 'test', 'fixtures', 'city-pages');
const ZIPS = readFileSync(join(FIXDIR, 'zip-pages.json'), 'utf8');
const BASE_PLANE = JSON.parse(readFileSync(join(FIXDIR, 'development_seo_plane.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://homesignal.net/</loc>
  </url>
</urlset>
`;

// Each fixture card gets a key; the case part is deliberately awkward for two of them.
const CASES = {
  'https://permits.example.gov/r/1': 'BLD-2026-0001',
  'https://permits.example.gov/r/2': 'CIV 2026/002',
  'https://permits.example.gov/r/3': 'ROAD.3',
  'https://permits.example.gov/r/4': 'BLD-2026-0004',
  'https://permits.example.gov/r/5': 'BLD_2026_0001',      // slugs like case 1; must stay apart
  'https://permits.example.gov/r/6': 'LAB-6',
  'https://permits.example.gov/r/7': 'SOL-7',
  'https://permits.example.gov/r/8': 'SUB-8',
  'https://permits.example.gov/r/9': 'TH-9',
};
// One card uses the host:dataset key shape Socrata, CKAN, Carto and CSV write.
const keyFor = (url) => (url.endsWith('/r/6')
  ? `socrata:data.town.gov:ab12-cd34:${CASES[url]}|1`
  : `arcgis:town-permits:${CASES[url]}|1`);

function makeInputs({ mutate } = {}) {
  const plane = JSON.parse(JSON.stringify(BASE_PLANE));
  const projects = {};
  const add = (e, zips) => {
    const k = keyFor(e.source_url);
    e.key = k;
    const prev = projects[k];
    projects[k] = {
      registry_id: 'town-permits', case: CASES[e.source_url], name: e.name, type: e.type,
      status: e.status, source_url: e.source_url, zips: [...new Set([...(prev ? prev.zips : []), ...zips])].sort(),
      ...(e.date ? { date: e.date, date_kind: 'filed' } : {}),
    };
  };
  for (const [z, rec] of Object.entries(plane.zips)) {
    for (const e of rec.representative_entities || []) add(e, [z]);
  }
  for (const c of Object.values(plane.cities)) {
    for (const e of c.representative_entities || []) add(e, [e.zip]);
  }
  // The shared project is on two ZIP pages.
  projects[keyFor('https://permits.example.gov/r/1')].zips = ['01002', '01003'];
  const { cities, ...zipPlane } = plane;
  const docs = {
    zipPlane,
    citiesDoc: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, cities },
    projectsDoc: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at,
      scope: 'featured', projects },
  };
  if (mutate) mutate(docs);
  return docs;
}

function build(docs) {
  const dir = mkdtempSync(join(tmpdir(), 'projfix-'));
  writeFileSync(join(dir, 'zip-pages.json'), ZIPS);
  writeFileSync(join(dir, 'development_seo_plane.json'), JSON.stringify(docs.zipPlane));
  writeFileSync(join(dir, 'development_seo_cities.json'), JSON.stringify(docs.citiesDoc));
  if (docs.projectsDoc) {
    writeFileSync(join(dir, 'development_seo_projects.json'), JSON.stringify(docs.projectsDoc));
  }
  const out = mkdtempSync(join(tmpdir(), 'proj-'));
  writeFileSync(join(out, 'sitemap.xml'), SITEMAP);
  const r = spawnSync('python3', [GEN, '--fixture', join(dir, 'zip-pages.json'), '--out', out,
    '--now', '2026-09-28T00:00:00'], { encoding: 'utf8' });
  return { r, out };
}

// The URL recipe, restated from the audit (docs/project-identity-audit-2026-09-28.md rule 5)
// so a change to the generator's recipe fails here rather than silently moving every URL.
function expectedPath(reg, cs, key) {
  const slug = cs.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    .replace(/-+$/g, '');
  const h8 = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8);
  return `/project/${reg}/${slug ? `${slug}-` : ''}${h8}/`;
}
const pathOf = (url) => expectedPath('town-permits', CASES[url], keyFor(url));
const read = (out, p) => readFileSync(join(out, ...p.split('/').filter(Boolean), 'index.html'), 'utf8');

const docs = makeInputs();
const { r, out } = build(docs);
ok(r.status === 0, `the build succeeds (${(r.stderr || '').trim().slice(-200)})`);
const man = JSON.parse(readFileSync(join(out, 'zip-pages-manifest.json'), 'utf8'));
const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
const nProjects = Object.keys(docs.projectsDoc.projects).length;

// ---- 1. existence, robots, canonical, sitemap ------------------------------------------
const p1 = pathOf('https://permits.example.gov/r/1');
ok(existsSync(join(out, ...p1.split('/').filter(Boolean), 'index.html')), `the shared project has a page at ${p1}`);
ok(man.project_pages.length === nProjects, `the manifest lists all ${nProjects} project pages`);
ok(JSON.stringify(man.project_pages) === JSON.stringify(Object.keys(docs.projectsDoc.projects)
  .map((k) => expectedPath('town-permits', docs.projectsDoc.projects[k].case, k)).sort()),
   'every page is at the documented URL');
const smProj = [...sm.matchAll(/<loc>https:\/\/homesignal\.net(\/project\/[^<]+)<\/loc>/g)].map((m) => m[1]).sort();
ok(JSON.stringify(smProj) === JSON.stringify(man.project_pages), 'the sitemap advertises exactly the project pages');
ok(man.sitemap_project_urls === nProjects, 'the manifest reconciles the sitemap count');
const pg1 = read(out, p1);
ok(/<meta name="robots" content="index, follow">/.test(pg1), 'a project page is indexable');
ok(pg1.includes(`<link rel="canonical" href="https://homesignal.net${p1}">`), 'and self-canonical');
const onDisk = readdirSync(join(out, 'project', 'town-permits'));
ok(onDisk.length === nProjects, 'nothing else is written under /project/');

// ---- 2. the URL ------------------------------------------------------------------------
ok(!/olympia/i.test(p1), 'the project name is never in the URL');
ok(p1.startsWith('/project/town-permits/bld-2026-0001-'), 'the URL is the source and the record number');
const p5 = pathOf('https://permits.example.gov/r/5');
ok(p5.startsWith('/project/town-permits/bld-2026-0001-') && p5 !== p1,
   'two record numbers that slug alike get different URLs');
ok(existsSync(join(out, ...pathOf('https://permits.example.gov/r/6').split('/').filter(Boolean), 'index.html')),
   'a key of the host:dataset shape gets its page too');
ok(pathOf('https://permits.example.gov/r/2').startsWith('/project/town-permits/civ-2026-002-'),
   'punctuation in a record number collapses to hyphens');

// ---- 3. cards link to the page and keep the record -------------------------------------
const z1 = readFileSync(join(out, 'community', '01002', 'index.html'), 'utf8');
ok(z1.includes(`<a href="${p1}">Olympia Place Apartments</a>`), 'a ZIP card links the name to its project page');
ok(!/ld\+json/.test(z1), 'the generated ZIP document carries no structured data (PS-001)');
ok(z1.includes('<a href="https://permits.example.gov/r/1" rel="nofollow noopener">official record</a>'),
   '...and keeps the official record beside it');
const city = read(out, '/city/ma/amherst/');
ok(city.includes(`<a href="${p1}">Olympia Place Apartments</a>`), 'a city card links to the same page');

// ---- 4. the page links back ------------------------------------------------------------
ok(pg1.includes('<a href="/community/01002/">') && pg1.includes('<a href="/community/01003/">'),
   'the page links to every ZIP page the project is on');
ok(pg1.includes('<a href="/city/ma/amherst/">Development across Amherst, MA</a>'),
   'the page links to its city page');
ok(pg1.includes('<a href="/homesignalmap.html?zip=01002">See it on the Development map</a>'),
   'the page links to the Development map');
ok(pg1.includes('<a href="https://permits.example.gov/r/1" rel="nofollow noopener">View the source record</a>'),
   'the page links to the official record');
ok(pg1.includes('<dt>Record number</dt><dd>BLD-2026-0001</dd>'), 'the record number is the source\'s own');
ok(/<dt>Date on record<\/dt><dd><time datetime="2026-09-01">2026-09-01<\/time> <span class="quiet">\(filed\)<\/span><\/dd>/.test(pg1),
   'the date says what kind of date it is');

// ---- 5. authority, escaping, no script -------------------------------------------------
{
  // Every page's Type and lifecycle are exactly what the one authority says for its record.
  const HS = loadAuthority();
  let checked = 0, agree = 0;
  for (const [k, v] of Object.entries(docs.projectsDoc.projects)) {
    const pg = read(out, expectedPath('town-permits', v.case, k));
    const t = HS.canonicalProjectType(v);
    const l = HS.canonicalLifecycle(v).label;
    checked += 1;
    const typeOk = t && t.label ? pg.includes(`<dt>Type</dt><dd>${t.label.replace(/&/g, '&amp;')}</dd>`) : !pg.includes('<dt>Type</dt>');
    if (typeOk && pg.includes(`<dt>Where it stands</dt><dd>${l.replace(/&/g, '&amp;')}</dd>`)) agree += 1;
  }
  ok(checked === nProjects && agree === checked,
     `Type and lifecycle on all ${checked} pages come from lib/project-type.js`);
}
const xss = Object.entries(docs.projectsDoc.projects).find(([, v]) => v.name.includes('<script>'));
const pgx = read(out, expectedPath('town-permits', xss[1].case, xss[0]));
ok(!pgx.includes('<script>alert(1)</script>') && pgx.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
   'a hostile project name is escaped and still shown');
ok([...pg1.matchAll(/<script[\s>][^>]*>/gi)].map((m) => m[0]).join() === '<script type="application/ld+json">' &&
   pg1.includes("script-src 'none'"),
   'a project page ships no executable script and refuses one (its one script element is inert structured data)');

// ---- 6. inbound links -------------------------------------------------------------------
{
  // Kept pages (founder, 2026-09-28): a project no card links to keeps its page, linked
  // from its ZIP's project list. A project on no canonical ZIP can be linked from nowhere.
  const kept = makeInputs({ mutate: (d) => {
    d.projectsDoc.projects['arcgis:town-permits:ORPHAN-1|1'] = { registry_id: 'town-permits',
      case: 'ORPHAN-1', name: 'Nobody Links Here', type: 'Residential', status: 'Proposed',
      source_url: 'https://permits.example.gov/r/99', zips: ['01002'] };
  } });
  const b = build(kept);
  const po = expectedPath('town-permits', 'ORPHAN-1', 'arcgis:town-permits:ORPHAN-1|1');
  ok(b.r.status === 0 && existsSync(join(b.out, ...po.split('/').filter(Boolean), 'index.html')),
     'a project no card links to keeps its page');
  const list = read(b.out, '/community/01002/projects/');
  ok(list.includes(`<a href="${po}">Nobody Links Here</a>`) && list.includes(`<a href="${p1}">`),
     "the ZIP's project list links every project page on that ZIP, kept or featured");
  ok(/<meta name="robots" content="noindex, follow">/.test(list) &&
     list.includes('<link rel="canonical" href="https://homesignal.net/community/01002/projects/">'),
     'the list is followed but not indexed');
  const smk = readFileSync(join(b.out, 'sitemap.xml'), 'utf8');
  ok(!smk.includes('/projects/') && smk.includes(po), 'the list is in no sitemap; the kept page is');
  const zk = readFileSync(join(b.out, 'community', '01002', 'index.html'), 'utf8');
  ok(/<nav class="zproj" aria-label="Projects on record"><a href="\/community\/01002\/projects\/">All \d+ projects on record in 01002<\/a><\/nav>/.test(zk),
     'the ZIP page links to its project list');
  const zkNav = zk.match(/<nav class="zsec">[\s\S]*?<\/nav>/)[0];
  ok(!zkNav.includes('/projects/'), 'the first zsec nav (read by the live proof) is unchanged');
  const lost = makeInputs({ mutate: (d) => {
    d.projectsDoc.projects['arcgis:town-permits:ORPHAN-2|1'] = { registry_id: 'town-permits',
      case: 'ORPHAN-2', name: 'On No Page', type: 'Residential', status: 'Proposed',
      source_url: 'https://permits.example.gov/r/98', zips: ['99999'] };
  } });
  const bl = build(lost);
  ok(bl.r.status !== 0 && /would have no link from any ZIP or city page/.test(bl.r.stderr + bl.r.stdout),
     'a project on no canonical ZIP page fails the build');
  lost.projectsDoc.projects['arcgis:town-permits:ORPHAN-2|1'].held = true;
  const h = build(lost);
  ok(h.r.status !== 0 && /names no canonical ZIP/.test(h.r.stderr + h.r.stdout),
     'even HELD, a project on no canonical ZIP gets no page');
}

// ---- 11. kept pages, address, dates, source name, breadcrumbs, lastmod (2026-09-28) -------
{
  const KK = 'arcgis:phoenix-building-permits:T971680|1';
  const docs2 = makeInputs({ mutate: (d) => {
    d.projectsDoc.projects[KK] = { registry_id: 'phoenix-building-permits', case: 'T971680',
      name: 'Roosevelt Row Lofts </script><script>alert(1)</script>', type: 'Residential',
      status: 'Proposed', source_url: 'https://permits.example.gov/r/97', zips: ['01002'],
      address: '27 W Lewis Ave', date: '2025-03-10', date_kind: 'filed',
      tracked: false, as_of: '2026-08-02', changed_on: '2026-08-03' };
    d.projectsDoc.projects[keyFor('https://permits.example.gov/r/1')].address = '1 Olympia Dr';
    d.projectsDoc.projects[keyFor('https://permits.example.gov/r/1')].changed_on = '2026-09-20';
  } });
  const b = build(docs2);
  ok(b.r.status === 0, `a document with the new fields builds (${(b.r.stderr || '').trim().slice(-200)})`);
  const pk = read(b.out, expectedPath('phoenix-building-permits', 'T971680', KK));
  const pa = read(b.out, p1);
  ok(/<title>Olympia Place Apartments, 1 Olympia Dr — [^<]+ \(2026\) \| HomeSignal<\/title>/.test(pa),
     'the title carries the address and the year of the date on record');
  ok(pa.includes('<p class="addr">1 Olympia Dr, ') && pa.includes('<dt>Address</dt><dd>1 Olympia Dr</dd>'),
     'the address is under the name and in the facts');
  ok(/<p>[^<]*·[^<]*<span class="quiet">as of <time datetime="2026-09-28">Sep 28, 2026<\/time><\/span><\/p>/.test(pa) &&
     pa.includes('<dt>Status as of</dt><dd><time datetime="2026-09-28">Sep 28, 2026</time></dd>'),
     'a tracked page shows the day its status was read, beside the status');
  ok(!pa.includes('no longer tracks'), 'a tracked page carries no notice');
  ok(/<p class="notice" role="note" style="[^"]+">HomeSignal no longer tracks this project\./.test(pk) &&
     pk.includes('<dt>Last recorded status</dt>') && pk.includes('<dt>Last seen</dt><dd><time datetime="2026-08-02">Aug 2, 2026</time></dd>') &&
     !pk.includes('<dt>Where it stands</dt>'),
     'a page no longer tracked says so and shows its last recorded status and when it was seen');
  ok(/<meta name="robots" content="index, follow">/.test(pk), 'and stays indexable');
  ok(pk.includes('<dt>Source</dt><dd>City of Phoenix <span class="quiet">(phoenix-building-permits)</span></dd>') &&
     pa.includes('<dt>Source</dt><dd>town-permits</dd>'),
     "the source is its publisher's name from the registry; an unknown id is shown as it is");
  const ld = pk.match(/<script type="application\/ld\+json">([^<]*)<\/script>/);
  ok(ld && !/<\/script><script>alert/.test(pk), 'a hostile name cannot close the structured-data block');
  const crumbs = ld ? JSON.parse(ld[1]) : null;
  const items = crumbs ? crumbs.itemListElement : [];
  ok(crumbs && crumbs['@type'] === 'BreadcrumbList' && items.length === 4 &&
     items.map((x) => x.position).join() === '1,2,3,4' &&
     items[0].item === 'https://homesignal.net/' && items[1].item === 'https://homesignal.net/city/ma/amherst/' &&
     items[2].item === 'https://homesignal.net/community/01002/' &&
     items[3].item === `https://homesignal.net${expectedPath('phoenix-building-permits', 'T971680', KK)}` &&
     items[3].name.includes('</script>'),
     'breadcrumbs: Home › City › ZIP › Project, with the name as data');
  const lm = (xml, path) => (xml.match(new RegExp(`<loc>https://homesignal\\.net${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>\\n    <lastmod>([^<]+)</lastmod>`)) || [])[1];
  const sm2 = readFileSync(join(b.out, 'sitemap.xml'), 'utf8');
  const fam2 = readFileSync(join(b.out, 'sitemaps', 'project.xml'), 'utf8');
  ok(lm(sm2, p1) === '2026-09-20' && lm(fam2, p1) === '2026-09-20',
     'the sitemaps give a project the day its facts last changed');
  ok(lm(sm2, pathOf('https://permits.example.gov/r/2')) === '2026-09-28',
     'a record without changed_on falls back to the plane day');
  ok(!/<loc>https:\/\/homesignal\.net\/community\/[^<]+<\/loc>\n    <lastmod>/.test(sm2),
     'ZIP pages carry no lastmod (no honest per-page change date exists for them yet)');
  const list = read(b.out, '/community/01002/projects/');
  ok(list.includes('(no longer tracked)') && list.includes('<span class="addr">27 W Lewis Ave</span>'),
     'the list marks a page no longer tracked and shows addresses');
  for (const [what, m] of [
    ['a non-boolean tracked flag', (r) => { r.tracked = 'no'; }],
    ['a malformed as_of', (r) => { r.as_of = '28/09/2026'; }],
  ]) {
    const bad = makeInputs({ mutate: (d) => { m(d.projectsDoc.projects[keyFor('https://permits.example.gov/r/1')]); } });
    const bb = build(bad);
    ok(bb.r.status !== 0, `${what} fails the build`);
  }
}

// ---- 12. more projects on the same ZIP page (2026-09-29) --------------------------------
{
  // Related projects are the other project pages on the same ZIP page(s): the site's
  // geography, never a distance.
  const rel = [...pg1.matchAll(/<section class="zsec"><h2>More projects in ([^<]+)<\/h2><ul>([\s\S]*?)<\/ul>/g)];
  ok(rel.length === 1 && rel[0][1] === 'these ZIP codes', 'a project on two ZIP pages lists more projects from both');
  const links = rel.length ? [...rel[0][2].matchAll(/<li><a href="(\/project\/[^"]+)">/g)].map((m) => m[1]) : [];
  const onZips = Object.entries(docs.projectsDoc.projects)
    .filter(([k, v]) => k !== keyFor('https://permits.example.gov/r/1') && v.zips.some((z) => ['01002', '01003'].includes(z)));
  ok(links.length === Math.min(6, onZips.length) && links.length > 0,
     `it lists up to 6 of them (${links.length} of ${onZips.length})`);
  ok(!links.includes(p1), 'it never lists itself');
  ok(links.every((l) => man.project_pages.includes(l)), 'every link is a project page this build wrote');
  const byPath = Object.fromEntries(Object.entries(docs.projectsDoc.projects)
    .map(([k, v]) => [expectedPath('town-permits', v.case, k), v.date || '']));
  const dates = links.map((l) => byPath[l]);
  ok(dates.every((d, i) => i === 0 || dates[i - 1] >= d), 'newest date on record first');
  ok(!/\bmiles?\b|\bnearby\b|\bnearest\b|radius/i.test(rel[0] ? rel[0][0] : 'x'),
     'the section makes no distance claim');
  // A project alone on its ZIP page gets no section; a kept project is listed after tracked ones.
  const solo = makeInputs({ mutate: (d) => {
    // 01004 carries no other project.
    d.projectsDoc.projects[keyFor('https://permits.example.gov/r/1')].zips = ['01004'];
    d.projectsDoc.projects['arcgis:town-permits:GONE-9|1'] = { registry_id: 'town-permits', case: 'GONE-9',
      name: 'Gone Project', type: 'Residential', status: 'Proposed', source_url: 'https://permits.example.gov/r/77',
      zips: ['01002'], date: '2026-09-27', tracked: false, as_of: '2026-09-01' };
  } });
  const bs = build(solo);
  if (bs.r.status !== 0) console.error(bs.r.stderr.slice(-400));
  const alone = read(bs.out, p1);
  ok(bs.r.status === 0 && alone.includes('<h1>Olympia Place Apartments</h1>') && !alone.includes('More projects in'),
     'a project alone on its ZIP page gets no section');
  const other = Object.entries(solo.projectsDoc.projects).find(([k, v]) => v.zips.includes('01002') && !k.includes('GONE'));
  const po = read(bs.out, expectedPath('town-permits', other[1].case, other[0]));
  const items = [...po.matchAll(/<li><a href="\/project\/[^"]+">[^<]*<\/a>[\s\S]*?<\/li>/g)].map((m) => m[0]);
  const gone = items.findIndex((x) => x.includes('Gone Project'));
  ok(gone >= 0 && items.slice(gone + 1).every((x) => x.includes('(no longer tracked)')) &&
     items.slice(0, gone).every((x) => !x.includes('(no longer tracked)')),
     'projects no longer tracked come after tracked ones, even when newer');
}

{
  // More than 6 others: the list stops at 6 and points to the ZIP's full list.
  const many = makeInputs({ mutate: (d) => {
    for (let i = 0; i < 8; i++) {
      d.projectsDoc.projects[`arcgis:town-permits:MANY-${i}|1`] = { registry_id: 'town-permits', case: `MANY-${i}`,
        name: `Many ${i}`, type: 'Residential', status: 'Proposed', source_url: `https://permits.example.gov/m/${i}`,
        zips: ['01007'], date: `2026-08-0${i + 1}` };
    }
  } });
  const bm = build(many);
  const pm = read(bm.out, expectedPath('town-permits', 'MANY-0', 'arcgis:town-permits:MANY-0|1'));
  const sec = (pm.match(/<h2>More projects in [^<]+<\/h2><ul>([\s\S]*?)<\/ul>([\s\S]*?)<\/section>/) || []);
  const n = sec[1] ? (sec[1].match(/<li>/g) || []).length : 0;
  const onZip = Object.values(many.projectsDoc.projects).filter((v) => v.zips.includes('01007')).length;
  ok(n === 6 && sec[2] && sec[2].includes(`<a href="/community/01007/projects/">All ${onZip} projects on record in 01007</a>`),
     `more than 6 others: 6 listed and a link to all ${onZip} on the ZIP's list (${n})`);
}

// ---- 7. inconsistent input fails -------------------------------------------------------
{
  const bad = makeInputs({ mutate: (d) => {
    d.projectsDoc.projects[keyFor('https://permits.example.gov/r/1')].case = 'SOMETHING-ELSE';
  } });
  const b = build(bad);
  ok(b.r.status !== 0 && /disagree with its key/.test(b.r.stderr + b.r.stdout),
     'a record whose case disagrees with its key fails the build');
}
{
  const bad = makeInputs({ mutate: (d) => { d.projectsDoc.generated_at = '2026-09-27T00:00:00Z'; } });
  const b = build(bad);
  ok(b.r.status !== 0 && /project data generated_at .* does not match/.test(b.r.stderr + b.r.stdout),
     'a projects document from another run fails the build');
}
{
  const bad = makeInputs({ mutate: (d) => {
    d.projectsDoc.projects[keyFor('https://permits.example.gov/r/1')].source_url = 'javascript:alert(1)';
  } });
  const b = build(bad);
  ok(b.r.status !== 0 && /lacks a name, an official record/.test(b.r.stderr + b.r.stdout),
     'a record without a safe official link fails the build');
}
{
  // Production requires the section: a plane without it would silently remove every page.
  const noProj = makeInputs();
  const dir = mkdtempSync(join(tmpdir(), 'noproj-'));
  const p = join(dir, 'plane.json');
  const plane = { ...noProj.zipPlane, cities: noProj.citiesDoc.cities };
  writeFileSync(p, JSON.stringify(plane));
  const py = `import sys, datetime; sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import gen_zip_pages as g
g.load_dev_plane(${JSON.stringify(p)}, required=True, cities_out={}, projects_out={},
                 now=datetime.datetime(2026, 9, 28, 1, tzinfo=datetime.timezone.utc))
print("LOADED")`;
  const rr = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  ok(rr.status !== 0 && /no projects section/.test(rr.stderr + rr.stdout),
     'a production plane without a projects section fails the build');
}
{
  const { r: r0, out: o0 } = build({ ...makeInputs(), projectsDoc: null });
  const z0 = readFileSync(join(o0, 'community', '01002', 'index.html'), 'utf8');
  ok(r0.status === 0 && !existsSync(join(o0, 'project')) &&
     z0.includes('<a href="https://permits.example.gov/r/1" rel="nofollow noopener">Olympia Place Apartments</a>'),
     'a fixture without project data writes no project page and cards link to the record as before');
}

// ---- 9. guide pages (plan step 13) -----------------------------------------------------
{
  const W = '/guides/what-is-being-built-near-me/';
  const C = '/guides/check-proposed-development-near-a-house/';
  const gw = read(out, W);
  const gc = read(out, C);
  ok(JSON.stringify(man.guide_pages) === JSON.stringify([C, W].sort()), 'the manifest lists exactly the two guides');
  const smG = [...sm.matchAll(/<loc>https:\/\/homesignal\.net(\/guides\/[^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  ok(JSON.stringify(smG) === JSON.stringify([C, W].sort()) && man.sitemap_guide_urls === 2,
     'the sitemap advertises exactly the two guides');
  for (const [p, g] of [[W, gw], [C, gc]]) {
    ok(/<meta name="robots" content="index, follow">/.test(g) && g.includes(`<link rel="canonical" href="https://homesignal.net${p}">`),
       `${p} is indexable and self-canonical`);
    ok(g.includes('<form class="zsec" action="/homesignalmap.html" method="get" role="search">') &&
       /<input id="[a-zA-Z]+" name="zip"/.test(g), `${p} has a ZIP lookup that works with no script`);
    ok(g.includes('<a href="/homesignalmap.html">Search it on the Development map</a>'),
       `${p} points to the address search`);
    ok(!/<script[\s>]/i.test(g) && g.includes("script-src 'none'"), `${p} ships no script`);
  }
  ok(gw.includes(`<a href="${C}">`) && gc.includes(`<a href="${W}">`), 'the guides link to each other');
  ok(gw.includes('<a href="/city/ma/amherst/">Amherst</a> <span class="quiet">7 projects</span>') &&
     gw.includes('1 city has enough development'), 'the first guide lists every city page, counted');
  const proposed = Object.entries(docs.projectsDoc.projects)
    .filter(([, v]) => v.status === 'Proposed' && v.date)
    .sort((a, b) => (b[1].date + b[0] > a[1].date + a[0] ? 1 : -1));
  const recentLinks = [...gc.matchAll(/<li><a href="(\/project\/[^"]+)">/g)].map((m) => m[1]);
  ok(recentLinks.length > 0 && recentLinks.length === Math.min(12, proposed.length),
     `the second guide lists the newest proposals (${recentLinks.length})`);
  ok(JSON.stringify(recentLinks) === JSON.stringify(proposed.slice(0, 12)
    .map(([k, v]) => expectedPath('town-permits', v.case, k))),
     'newest first, only proposals, each linking to its project page');
  ok(city.includes(`<a href="${W}">What is being built near me?</a>`), 'city pages link to the first guide');
  ok(pg1.includes(`<a href="${C}">How to check proposed development near a house</a>`),
     'project pages link to the second guide');
}

// ---- 10. family sitemaps (plan step 14) ---------------------------------------------------
{
  const fam = {};
  for (const n of ['zip-alerts', 'zip-development', 'city', 'project', 'guide']) {
    const f = join(out, 'sitemaps', `${n}.xml`);
    ok(existsSync(f), `sitemaps/${n}.xml is written`);
    fam[n] = [...readFileSync(f, 'utf8').matchAll(/<loc>https:\/\/homesignal\.net([^<]+)<\/loc>/g)].map((m) => m[1]);
    ok(fam[n].length === man.family_sitemaps[n], `${n}: the manifest records its count (${fam[n].length})`);
  }
  ok(JSON.stringify([...fam.project].sort()) === JSON.stringify(man.project_pages), 'the project family is exactly the project pages');
  ok(JSON.stringify([...fam.city].sort()) === JSON.stringify(man.city_pages), 'the city family is exactly the city pages');
  ok(JSON.stringify([...fam.guide].sort()) === JSON.stringify(man.guide_pages), 'the guide family is exactly the guides');
  ok(fam['zip-development'].includes('/community/01002/') && !fam['zip-alerts'].includes('/community/01002/'),
     'a Rule-D-only ZIP is in the development family and not the alerts family');
  const mainGen = new Set([...sm.matchAll(/<loc>https:\/\/homesignal\.net(\/(?:community|city|project|guides)\/[^<]+)<\/loc>/g)].map((m) => m[1]));
  const union = new Set(Object.values(fam).flat());
  ok(union.size === mainGen.size && [...union].every((u) => mainGen.has(u)),
     `together the families cover exactly sitemap.xml's generated URLs (${union.size})`);
  const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
  ok(['zip-alerts', 'zip-development', 'city', 'project', 'guide']
    .every((n) => robots.includes(`Sitemap: https://homesignal.net/sitemaps/${n}.xml`)) &&
     robots.includes('Sitemap: https://homesignal.net/sitemap.xml'),
     'robots.txt lists sitemap.xml and every family sitemap');
}

// ---- 8. determinism --------------------------------------------------------------------
ok(read(build(makeInputs()).out, p1) === pg1, 'two builds of the same input write byte-identical project pages');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
