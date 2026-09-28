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
const keyFor = (url) => `arcgis:town-permits:${CASES[url]}|1`;

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
  .map((k) => { const [, reg, cs] = k.match(/^[^:]+:([^:]+):(.+)\|1$/); return expectedPath(reg, cs, k); }).sort()),
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
ok(pathOf('https://permits.example.gov/r/2').startsWith('/project/town-permits/civ-2026-002-'),
   'punctuation in a record number collapses to hyphens');

// ---- 3. cards link to the page and keep the record -------------------------------------
const z1 = readFileSync(join(out, 'community', '01002', 'index.html'), 'utf8');
ok(z1.includes(`<a href="${p1}">Olympia Place Apartments</a>`), 'a ZIP card links the name to its project page');
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
ok(!/<script[\s>]/i.test(pg1) && pg1.includes("script-src 'none'"), 'a project page ships no script and refuses one');

// ---- 6. inbound links -------------------------------------------------------------------
{
  const orphan = makeInputs({ mutate: (d) => {
    d.projectsDoc.projects['arcgis:town-permits:ORPHAN-1|1'] = { registry_id: 'town-permits',
      case: 'ORPHAN-1', name: 'Nobody Links Here', type: 'Residential', status: 'Proposed',
      source_url: 'https://permits.example.gov/r/99', zips: ['01002'] };
  } });
  const b = build(orphan);
  ok(b.r.status !== 0 && /would have no link from any ZIP or city page/.test(b.r.stderr + b.r.stdout),
     'a project page no card links to fails the build');
  orphan.projectsDoc.projects['arcgis:town-permits:ORPHAN-1|1'].held = true;
  const h = build(orphan);
  ok(h.r.status === 0 && existsSync(join(h.out, 'project', 'town-permits')) &&
     readdirSync(join(h.out, 'project', 'town-permits')).length === nProjects + 1,
     'a HELD project keeps its page while its source is checked');
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

// ---- 8. determinism --------------------------------------------------------------------
ok(read(build(makeInputs()).out, p1) === pg1, 'two builds of the same input write byte-identical project pages');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
