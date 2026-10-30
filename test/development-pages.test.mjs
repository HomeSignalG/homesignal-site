// Gates for the development dossier pages (/development/<state>/<project_key>/, 2026-10-29).
//
// Runs the SHIPPED generator over the city-pages fixture plus a published-snapshot document with
// two dossiers: one data-centre-shaped (defining record = the DC entity, no app_projects record,
// named by its land assembly) and one non-data-centre (defining record = a source record that has
// a /project/ page). Pinned:
//   1. a page per dossier at its path; indexable, self-canonical, one H1, in the master and the
//      `development` family sitemap; no script but inert structured data
//   2. Type and lifecycle come from lib/project-type.js run on the defining record
//   3. every section's facts and their source links are in the raw HTML; media in its own list
//   4. a descriptive name says so; a record name does not
//   5. the ZIP page links to the dossier; the linked /project/ page says "Part of"
//   6. the renderer names no project, place or filing (one code path for every development)
//   7. a malformed snapshot or a link with no https source fails the build
//   8. identical input produces byte-identical pages, and the build day never moves a fingerprint
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
const FIXDIR = join(root, 'test', 'fixtures', 'city-pages');
const ZIPS = readFileSync(join(FIXDIR, 'zip-pages.json'), 'utf8');
const PLANE = JSON.parse(readFileSync(join(FIXDIR, 'development_seo_plane.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m, d); } };

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://jodytracks.com/</loc>
  </url>
</urlset>
`;
const PKEY = 'arcgis:town-permits:BLD-2026-0001|1';
const W = 'https://water.example.gov/change/x123';

function dossiers() {
  return {
    schema: 'development-dossiers/1', generated_at: '2026-10-29T00:00:00Z',
    dossiers: {
      'valley-campus': {
        project_key: 'valley-campus', state: 'MA', path: '/development/ma/valley-campus/',
        display_name: 'Valley data center <campus>', name_source: 'resolved_project', name_basis: 'descriptive',
        defining: { kind: 'dc_entity', role: 'defining_record', evidence_url: 'https://atlas.example.org/dc/1',
                    evidence_label: 'Data-center listing', facts: { classification: 'CONFIRMED_DC' } },
        links: [
          { kind: 'dc_entity', ref: 'fe2068de-0000-4000-8000-000000000001', role: 'defining_record', grade: 'a',
            evidence_url: 'https://atlas.example.org/dc/1', evidence_label: 'Data-center listing', facts: { classification: 'CONFIRMED_DC' } },
          { kind: 'land_assembly', ref: 'valley-campus', role: 'associated_land', grade: 'a', evidence_url: 'https://county.example.gov/parcels',
            facts: { display_name: 'Valley data center <campus>', display_name_basis: 'descriptive',
                     zips: [{ zip: '01002', parcels: 12, primary: true }, { zip: '01003', parcels: 1, primary: false }] } },
          { kind: 'water_filing', ref: 'ut_dwr:x123', role: 'water_change_application', grade: 'a', evidence_url: W,
            evidence_label: 'Change record x123', date: null,
            facts: { filing_no: 'x123', filing_type: 'Permanent change application', status: 'Unapproved',
                     filed_on: '2026-10-15', date_label: 'Priority date', record_url: W, points: 2 } },
          { kind: 'organization', ref: 'MA:Example Ranch, Inc.', role: 'landowner_of_record', grade: 'a', evidence_url: W,
            evidence_label: 'Change record x123', text: 'Owner of the water right being changed', facts: {} },
          { kind: 'government_record', ref: 'https://board.example.gov/agenda/9', role: 'agenda_item', grade: 'a',
            evidence_url: 'https://board.example.gov/agenda/9', evidence_label: 'Board agenda', text: 'Board agenda item 9',
            date: '2026-07-15', date_label: 'On agenda', aspect: 'Approvals', facts: {} },
          { kind: 'youtube_video', ref: 'youtube:q-phnTGrMRQ', role: 'explains', grade: 'a',
            evidence_url: 'https://www.youtube.com/watch?v=q-phnTGrMRQ',
            facts: { title: 'What the water filing says', url: 'https://www.youtube.com/watch?v=q-phnTGrMRQ', kind: 'main' } },
          { kind: 'youtube_video', ref: 'youtube:shortAAAAAA', role: 'explains', grade: 'a',
            evidence_url: 'https://www.youtube.com/shorts/shortAAAAAA',
            facts: { title: 'The filing in 40 seconds', url: 'https://www.youtube.com/shorts/shortAAAAAA', kind: 'short' } },
          { kind: 'bluesky_post', ref: 'bsky:at://did:plc:x/app.bsky.feed.post/aaa', role: 'explains', grade: 'a',
            evidence_url: 'https://bsky.app/profile/x/post/aaa',
            facts: { text: 'A filing to move ranch water to a data center', published_at: '2026-10-29T15:00:00Z' } },
        ],
        statements: [
          { kind: 'summary', body: 'A data center campus proposed for ranch land.', evidence_url: W, evidence_label: 'Change record x123' },
          { kind: 'unknown', body: 'Whether the board adopted the agenda item.' },
          { kind: 'next', body: 'No hearing has been scheduled on the filing.', checked_on: '2026-10-28' },
        ],
        withheld: [{ kind: 'youtube_video', ref: 'youtube:privateAAAA' }], updated_at: '2026-10-29T10:00:00Z',
      },
      'olympia-mixed-use': {
        project_key: 'olympia-mixed-use', state: 'MA', path: '/development/ma/olympia-mixed-use/',
        display_name: 'Olympia mixed-use building', name_source: 'project', name_basis: null,
        defining: { kind: 'source_record', ref: PKEY, role: 'defining_record', evidence_url: 'https://permits.example.gov/r/1',
                    evidence_label: 'Permit BLD-2026-0001',
                    facts: { name: 'Olympia Apartments', type: 'Residential', status: 'Approved', zips: ['01002'] } },
        links: [
          { kind: 'source_record', ref: PKEY, role: 'defining_record', grade: 'a', evidence_url: 'https://permits.example.gov/r/1',
            evidence_label: 'Permit BLD-2026-0001', date: '2026-09-01', date_label: 'Filed',
            facts: { name: 'Olympia Apartments', type: 'Residential', status: 'Approved', zips: ['01002'] } },
        ],
        statements: [{ kind: 'summary', body: 'A four-story apartment building.', evidence_url: 'https://permits.example.gov/r/1' }],
        withheld: [], updated_at: '2026-10-20T00:00:00Z',
      },
    },
  };
}

function inputs() {
  const { cities, ...zipPlane } = JSON.parse(JSON.stringify(PLANE));
  return {
    zipPlane,
    cities: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, cities },
    projects: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, scope: 'featured',
      projects: { [PKEY]: { registry_id: 'town-permits', case: 'BLD-2026-0001', name: 'Olympia Apartments', type: 'Residential',
        status: 'Approved', source_url: 'https://permits.example.gov/r/1', zips: ['01002'], date: '2026-09-01', date_kind: 'filed' } } },
  };
}

function build(dv, { now = '2026-10-29T00:00:00' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'devfix-'));
  const inp = inputs();
  writeFileSync(join(dir, 'zip-pages.json'), ZIPS);
  writeFileSync(join(dir, 'development_seo_plane.json'), JSON.stringify(inp.zipPlane));
  writeFileSync(join(dir, 'development_seo_cities.json'), JSON.stringify(inp.cities));
  writeFileSync(join(dir, 'development_seo_projects.json'), JSON.stringify(inp.projects));
  if (dv !== undefined) writeFileSync(join(dir, 'development_dossiers.json'), typeof dv === 'string' ? dv : JSON.stringify(dv));
  const out = mkdtempSync(join(tmpdir(), 'dev-'));
  writeFileSync(join(out, 'sitemap.xml'), SITEMAP);
  const r = spawnSync('python3', [GEN, '--fixture', join(dir, 'zip-pages.json'), '--out', out, '--now', now], { encoding: 'utf8' });
  return { r, out };
}
const read = (out, p) => readFileSync(join(out, ...p.split('/').filter(Boolean), 'index.html'), 'utf8');

const { r, out } = build(dossiers());
ok(r.status === 0, 'the build succeeds', (r.stderr || '').slice(-600));
const man = JSON.parse(readFileSync(join(out, 'zip-pages-manifest.json'), 'utf8'));
const A = '/development/ma/valley-campus/', B = '/development/ma/olympia-mixed-use/';

// 1. existence, robots, canonical, sitemaps
ok(JSON.stringify(man.development_pages) === JSON.stringify([B, A].sort()), 'the manifest lists both dossier pages', JSON.stringify(man.development_pages));
const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
ok(sm.includes(`<loc>https://jodytracks.com${A}</loc>`) && sm.includes(`<loc>https://jodytracks.com${B}</loc>`), 'both are in the master sitemap');
const fam = readFileSync(join(out, 'sitemaps', 'development.xml'), 'utf8');
ok((fam.match(/<loc>/g) || []).length === 2 && fam.includes(A), 'and in the development family sitemap');
const pa = read(out, A), pb = read(out, B);
for (const [p, h] of [[A, pa], [B, pb]]) {
  ok(/<meta name="robots" content="index, follow">/.test(h), `${p} is indexable`);
  ok(h.includes(`<link rel="canonical" href="https://jodytracks.com${p}">`), `${p} is self-canonical`);
  ok((h.match(/<h1>/g) || []).length === 1, `${p} has one H1`);
  ok(!/<script(?![^>]*application\/ld\+json)/.test(h), `${p} ships no script but structured data`);
  ok(/script-src 'none'/.test(h), `${p} forbids scripts in its CSP`);
}

// 2. Type and lifecycle from the one authority
const ctx = { window: { HS: {} }, console }; ctx.HS = ctx.window.HS; vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'lib', 'project-type.js'), 'utf8'), ctx);
const HS = ctx.window.HS;
const tB = HS.canonicalProjectType({ name: 'Olympia Apartments', type: 'Residential', status: 'Approved' });
const lB = HS.canonicalLifecycle({ name: 'Olympia Apartments', type: 'Residential', status: 'Approved' });
ok(pb.includes(`<p>${tB.label} · ${lB.label}`), `the non-DC page shows ${tB.label} · ${lB.label} from lib/project-type.js`);
const tA = HS.canonicalProjectType({ name: 'x', type: 'Data center' });
ok(pa.includes(`<p>${tA.label} · Lifecycle unknown`), 'the DC page shows Data center · Lifecycle unknown (no lifecycle claimed without a source)');

// 3. facts and their sources in the raw HTML
ok(pa.includes('Permanent change application x123') && pa.includes(`href="${W}"`), 'the water filing and its record');
ok(pa.includes('<strong>Example Ranch, Inc.</strong> — Landowner of record'), 'the organization and its role');
ok(pa.includes('Board agenda item 9') && pa.includes('href="https://board.example.gov/agenda/9"'), 'the government record');
ok(/id="timeline".*2026-10-15.*2026-07-15/s.test(pa), 'the timeline lists the filing before the older agenda item');
ok(/<h3>Videos<\/h3><ul><li><a href="https:\/\/www\.youtube\.com\/watch\?v=q-phnTGrMRQ"/.test(pa), 'the main video under Videos');
ok(/<h3>Shorts<\/h3><ul><li><a href="https:\/\/www\.youtube\.com\/shorts\/shortAAAAAA"/.test(pa), 'the Short under Shorts');
ok(pa.includes('A filing to move ranch water to a data center') && pa.includes('href="https://bsky.app/profile/x/post/aaa"'), 'the Bluesky post');
ok(!pa.includes('privateAAAA'), 'a withheld video is not on the page');
ok(pa.includes('href="/map/01002/"') && pa.includes('12 associated parcels'), 'map links with the associated parcels');
ok(pa.includes('It is not a confirmed project footprint'), 'associated land is not called a footprint');
ok(pa.includes('href="/follow-development.html?d=ma/valley-campus"'), 'the Follow link');
ok(pa.includes('Valley data center &lt;campus&gt;') && !pa.includes('<campus>'), 'source text is escaped');

// 4. name basis
ok(pa.includes('Descriptive label by HomeSignal. No public record names this project.'), 'a descriptive name says so');
ok(!pb.includes('Descriptive label'), 'a project-named page does not');

// 5. links in
const z = read(out, '/community/01002/');
ok(z.includes(`href="${A}"`) && z.includes(`href="${B}"`), 'the ZIP page links to both dossiers');
const proj = man.project_pages.find((p) => p.startsWith('/project/town-permits/bld-2026-0001-'));
ok(proj && read(out, proj).includes(`Part of <a href="${B}">Olympia mixed-use building</a>`), 'the defining /project/ page says Part of');

// 6. one code path
const src = readFileSync(join(root, 'scripts', 'development_pages.py'), 'utf8').toLowerCase();
ok(!/stratos|proctor|a55167|84336|box elder|tacoma|eagle mountain/.test(src), 'the renderer names no project, place or filing');

// 7. bad input stops the build
const bad1 = dossiers(); bad1.dossiers['valley-campus'].links[2].evidence_url = 'http://insecure.example.gov/';
ok(build(bad1).r.status !== 0, 'a link with no https source fails the build');
ok(build('{"schema":"other","dossiers":{}}').r.status !== 0, 'a snapshot with the wrong schema fails the build');
const bad3 = dossiers(); bad3.dossiers['valley-campus'].path = '/development/ma/other/';
ok(build(bad3).r.status !== 0, 'a dossier whose path does not match its key fails the build');
const none = build(undefined);
ok(none.r.status === 0 && !existsSync(join(none.out, 'development')), 'a fixture with no dossiers builds no dossier pages');

// 7b. the land index Map 1 reads: built from the same snapshot, one entry per land with one page
const LI = join(out, 'development', 'land-index.json');
const li = existsSync(LI) ? JSON.parse(readFileSync(LI, 'utf8')) : null;
ok(li && li.schema === 'development-land-index/1', 'the build writes development/land-index.json', JSON.stringify(li));
ok(li && JSON.stringify(li.land) === JSON.stringify({ 'valley-campus': { name: 'Valley data center <campus>', path: A } }),
   'it maps the approved land link to its page, and nothing else', JSON.stringify(li && li.land));
const twice = dossiers();
twice.dossiers['olympia-mixed-use'].links.push(JSON.parse(JSON.stringify(twice.dossiers['valley-campus'].links[1])));
const tw = build(twice);
const liTw = JSON.parse(readFileSync(join(tw.out, 'development', 'land-index.json'), 'utf8'));
ok(tw.r.status === 0 && JSON.stringify(liTw.land) === '{}', 'land linked from two pages is left out, not guessed between',
   JSON.stringify(liTw.land));
ok(!existsSync(join(none.out, 'development', 'land-index.json')), 'no dossiers, no land index');

// 8. determinism and the build day
const again = build(dossiers());
ok(read(again.out, A) === pa, 'identical input produces a byte-identical page');
const later = build(dossiers(), { now: '2026-11-03T00:00:00' });
const st1 = JSON.parse(readFileSync(join(out, 'sitemaps', 'page-state.json'), 'utf8'));
const st2 = JSON.parse(readFileSync(join(later.out, 'sitemaps', 'page-state.json'), 'utf8'));
const h = (st, p) => (st.pages || st.entries || {})[p];
ok(h(st1, A) && JSON.stringify(h(st1, A).h) === JSON.stringify(h(st2, A).h), 'a later build day does not move the fingerprint',
   JSON.stringify([h(st1, A), h(st2, A)]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
