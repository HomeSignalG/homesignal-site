// Gates for the development dossier pages (/development/<state>/<project_key>/, 2026-10-29).
//
// Runs the SHIPPED generator over the city-pages fixture plus a published-snapshot document with
// two dossiers: one data-centre-shaped (defining record = the DC entity, no app_projects record,
// named by its land assembly) and one non-data-centre (defining record = a source record that has
// a /project/ page). Pinned:
//   1. a page per dossier at its path; indexable, self-canonical, one H1, in the master and the
//      `development` family sitemap; only the header's own script, and inert structured data
//   2. Type and lifecycle come from lib/project-type.js run on the defining record
//   3. every section's facts and their source links are in the raw HTML; media in its own list
//   4. a descriptive name says so; a record name does not
//   5. the ZIP page links to the dossier; the linked /project/ page says "Part of"
//   6. the renderer names no project, place or filing (one code path for every development)
//   7. a malformed snapshot or a link with no https source fails the build
//   8. identical input produces byte-identical pages, and the build day never moves a fingerprint
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
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

import { SITEMAP, PKEY, W, dossiers, inputs, build, read } from './lib/development-pages-fixture.mjs';

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
  ok((h.match(/<h1[ >]/g) || []).length === 1, `${p} has one H1`);
  ok(!/href="\/(layout|app)\.css/.test(h) && /<style>[^<]*\.wrap\{/.test(h), `${p} carries its own layout, not the app shell's stylesheets`);
  const scripts = [...h.matchAll(/<script\b[^>]*>/g)].map(m => m[0]).filter(t => !/application\/ld\+json/.test(t));
  ok(scripts.length === 2 && /^<script src="\/lib\/share-modal\.js\?v=[0-9a-f]{8}" defer>$/.test(scripts[0])
     && /^<script src="\/lib\/dossier-header\.js\?v=[0-9a-f]{8}" defer>$/.test(scripts[1]),
     `${p} ships only the site Share box script, the header script and structured data`, JSON.stringify(scripts));
  ok(h.includes('<div class="overlay" id="shareModal">') && !/<div class="overlay" id="shareModal"[^>]*onclick/.test(h)
     && !/\son[a-z]+="/.test(h), `${p} carries the site Share box with no inline handlers`);
  ok(/script-src 'self';/.test(h) && !/script-src[^;]*unsafe-inline/.test(h), `${p} allows only same-origin scripts, no inline code`);
}

// 2. Type and lifecycle from the one authority
const ctx = { window: { HS: {} }, console }; ctx.HS = ctx.window.HS; vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'lib', 'project-type.js'), 'utf8'), ctx);
const HS = ctx.window.HS;
const tB = HS.canonicalProjectType({ name: 'Olympia Apartments', type: 'Residential', status: 'Approved' });
const lB = HS.canonicalLifecycle({ name: 'Olympia Apartments', type: 'Residential', status: 'Approved' });
ok(pb.includes(`<span class="pill type">${tB.label}</span><span class="pill life">${lB.label}</span>`), `the non-DC page shows ${tB.label} · ${lB.label} from lib/project-type.js`);
const tA = HS.canonicalProjectType({ name: 'x', type: 'Data center' });
ok(pa.includes(`<span class="pill type">${tA.label}</span><span class="pill life">Lifecycle unknown</span>`), 'the DC page shows Data center · Lifecycle unknown (no lifecycle claimed without a source)');

// 2b. a DC record's lifecycle is Map 1's own decision, carried by the snapshot (facts.lifecycle)
const withLife = dossiers();
for (const x of [withLife.dossiers['valley-campus'].defining, withLife.dossiers['valley-campus'].links[0]]) x.facts.lifecycle = 'Proposed';
const lifeOut = build(withLife);
const pLife = read(lifeOut.out, A);
const lP = HS.canonicalLifecycle({ status: 'Proposed' });
ok(lifeOut.r.status === 0 && pLife.includes(`<span class="pill type">${tA.label}</span><span class="pill life">${lP.label}</span>`),
   `a DC record with a stated lifecycle shows ${lP.label}`);
// the lookup's lifecycle map is Map 1's, word for word (docs/map1-dc-publication.sql)
const valuesOf = (file, after) => {
  const t = readFileSync(join(root, 'docs', file), 'utf8');
  const i = t.indexOf(after); const m = i < 0 ? null : t.slice(i).match(/lifecycle\(v, map_status\) as \(values([\s\S]*?\))\)/);
  return m ? [...m[1].matchAll(/\('([a-z_]+)',\s*'([A-Za-z]+)'\)/g)].map((x) => x[1] + '=' + x[2]).sort() : null;
};
const vMap = valuesOf('map1-dc-publication.sql', 'create or replace function public.map1_dc_zip_members');
const vDos = valuesOf('development-dossier.sql', 'create or replace function public.dc_entity_map_status');
ok(vMap && vMap.length === 4 && JSON.stringify(vMap) === JSON.stringify(vDos),
   'the dossier lifecycle lookup uses exactly Map 1\'s lifecycle map', JSON.stringify({ vMap, vDos }));

// 3. facts and their sources in the raw HTML
ok(pa.includes('Permanent change application x123') && pa.includes(`href="${W}"`), 'the water filing and its record');
ok(pa.includes('<p class="t">Example Ranch, Inc.</p><p><strong>Landowner of record</strong>'), 'the entity and its role');
ok(pa.includes('<h2 id="h-entities">Organizations &amp; People</h2>'), 'the entities tile is called Organizations & People');
// one card per entity: a second role for the same entity sits under the same name
const two = dossiers();
two.dossiers['valley-campus'].links.push({ kind: 'organization', ref: 'MA:Example Ranch, Inc.', role: 'applicant', grade: 'b', evidence_url: W,
  evidence_label: 'Change record x123', text: 'Applicant on the change', facts: {} });
const pTwo = read(build(two).out, A);
ok((pTwo.match(/<p class="t">Example Ranch, Inc\.<\/p>/g) || []).length === 1
   && /<p class="t">Example Ranch, Inc\.<\/p><p><strong>Applicant<\/strong>\. Applicant on the change<\/p>.*?<p><strong>Landowner of record<\/strong>/.test(pTwo),
   'an entity with two roles is one card listing both');
two.dossiers['valley-campus'].links.push({ kind: 'organization', ref: 'MA:Water Board', role: 'governing_body', grade: 'a', evidence_url: W, facts: {} });
const pOrd = read(build(two).out, A);
ok(pOrd.indexOf('<p class="t">Water Board</p>') > 0 && pOrd.indexOf('<p class="t">Water Board</p>') < pOrd.indexOf('<p class="t">Example Ranch, Inc.</p>'),
   'the governing body is listed before the landowner');
ok(pa.includes('Board agenda item 9') && pa.includes('href="https://board.example.gov/agenda/9"'), 'the government record');
ok(/id="timeline".*2026-10-15.*2026-07-15/s.test(pa), 'the timeline lists the filing before the older agenda item');
// videos: one reel of YouTube thumbnails with the title under each, main video first, then Shorts
const reel = (pa.match(/<div class="reel moving" role="region" aria-label="Videos"><ul class="reel-track" style="--n:2">(.*?)<\/ul><\/div>/) || [])[1] || '';
const items = reel.split('</li>').filter(Boolean);
ok(items.length === 4, 'the reel holds both videos, then a hidden copy of each so it can loop', String(items.length));
ok(items[0].includes('href="https://www.youtube.com/watch?v=q-phnTGrMRQ"')
   && items[0].includes('<img src="https://i.ytimg.com/vi/q-phnTGrMRQ/hqdefault.jpg"')
   && /<\/span><span class="vtitle">What the water filing says<\/span>/.test(items[0]), 'the main video: thumbnail, then its title');
ok(items[1].includes('i.ytimg.com/vi/shortAAAAAA/hqdefault.jpg') && items[1].includes('<span class="vtag">Short</span>'), 'the Short is labelled');
ok(!items[0].includes('aria-hidden') && !items[0].includes('tabindex')
   && items.slice(2).every((x) => x.startsWith('<li aria-hidden="true">') && x.includes('tabindex="-1"')),
   'only the loop copies are hidden from screen readers and the keyboard');
ok(/\.reel\.moving:hover \.reel-track,\.reel\.moving:focus-within \.reel-track\{animation-play-state:paused\}/.test(pa)
   && /prefers-reduced-motion:reduce\)\{[^}]*\}\.reel\.moving \.reel-track\{animation:none\}/.test(pa),
   'the reel pauses on hover or focus and does not move for reduced motion');
ok(pa.includes("img-src 'self' data: https://i.ytimg.com;") && !pb.includes('i.ytimg.com'),
   'the CSP allows YouTube thumbnails only on a page that shows videos');
ok(pa.includes('A filing to move ranch water to a data center') && pa.includes('href="https://bsky.app/profile/x/post/aaa"'), 'the Bluesky post');
ok(!pa.includes('privateAAAA'), 'a withheld video is not on the page');
ok(pa.includes('href="/map/01002/"') && pa.includes('12 associated parcels'), 'map links with the associated parcels');
ok(pa.includes('It is not a confirmed project footprint'), 'associated land is not called a footprint');
ok(pa.includes('href="/follow-development.html?d=ma/valley-campus"'), 'the Follow link');
ok(pa.includes('Valley data center &lt;campus&gt;') && !pa.includes('<campus>'), 'source text is escaped');

// 3b. presentation (2026-10-30 audit): dates as words, no hashtags, the defining record named by
// the source it opens, empty sections said once, map links only in Map & land, the county crumb
ok(pa.includes('being changed, filed Oct 15, 2026') && !pa.includes('filed 2026-10-15'), 'an ISO date in source text reads as a date');
ok(pa.includes('>The filing in 40 seconds</span>') && !/#Shorts|#jodytracks/.test(pa), 'hashtags are dropped from a title');
ok(pa.includes('<p class="t">Data-center listing</p><p class="small">Defining record</p>') && !pa.includes('atlas record dc-1'),
   'the defining-record card is named by the source it links to');
ok(!pa.includes('id="changed"') && !pa.includes('href="/development/ma/valley-campus/#changed"')
   && pa.includes('<div class="empty" id="not-yet"><p>No recorded change in the sources HomeSignal tracks.</p></div>'),
   'an empty section is not drawn or listed; what is missing is said once, one line per gap',
   (pa.match(/id="not-yet">.*?<\/div>/) || [''])[0]);
ok(pb.includes('id="not-yet"') && !/a linked entity|a location|Not on record yet/.test(pb),
   'gaps a reader does not need (no entity, no location) are not listed', (pb.match(/id="not-yet">.*?<\/div>/) || [''])[0]);
const hero = pa.slice(pa.indexOf('<section class="hero"'), pa.indexOf('</section>', pa.indexOf('<section class="hero"')));
ok(!hero.includes('/map/') && pa.includes('href="/map/01002/"'), 'the hero does not repeat the map links');
ok(/<nav class="crumbs"[^>]*><a href="\/">HomeSignal<\/a> › <span>Hampshire County, MA<\/span> › <span aria-current="page">/.test(pa),
   'the breadcrumb names the county, not a town', (pa.match(/<nav class="crumbs".*?<\/nav>/) || [''])[0]);
ok(pa.includes('<time datetime="2026-10-29">Oct 29, 2026</time>.</p>'), 'the footer date reads as a date');

// 4. name basis
ok(pa.includes('Descriptive label by HomeSignal. No public record names this project.'), 'a descriptive name says so');
ok(!pb.includes('Descriptive label'), 'a project-named page does not');

// 5. links in
const z = read(out, '/community/01002/');
ok(z.includes(`href="${A}"`) && z.includes(`href="${B}"`), 'the ZIP page links to both dossiers');
const proj = man.project_pages.find((p) => p.startsWith('/project/town-permits/bld-2026-0001-'));
ok(proj && read(out, proj).includes(`Part of <a href="${B}">Olympia mixed-use building</a>`), 'the defining /project/ page says Part of');

// 3c. a water filing's open protest window: the agency's form, only while the window is open
const PF = 'https://agency.example.gov/protest-form', PH = 'https://agency.example.gov/protest-guide.pdf';
const withProtest = (end, form = PF) => {
  const x = dossiers();
  x.dossiers['valley-campus'].links[2].facts.protest = { protest_end: end, protested: 'Protested', record_url: W,
    checked_at: '2026-10-28T12:29:08Z', agency: 'Example Water Agency', form_url: form, form_label: 'File a protest with the agency',
    help_url: PH, help_label: 'Protest guide', who: 'Anyone affected may file a protest.', how: 'The form asks for your reasons.' };
  return x;
};
const pOpen = read(build(withProtest('2026-12-01')).out, A);
ok(pOpen.includes('<p class="t">Protest period open until Dec 1, 2026</p>') && pOpen.includes(`<a class="btn" href="${PF}"`)
   && pOpen.includes(`href="${PH}"`) && pOpen.includes('lists it as protested'), 'an open protest window shows the agency\'s form');
ok(pOpen.indexOf('class="protest"') > 0 && pOpen.indexOf('class="protest"') < pOpen.indexOf('<section class="tile"'), 'the protest box sits in the page header, above the tiles');
ok(read(build(withProtest('2026-12-01'), { now: '2026-12-01T20:00:00' }).out, A).includes(`href="${PF}"`), 'the last day still shows it');
ok(!read(build(withProtest('2026-12-01'), { now: '2026-12-02T00:00:00' }).out, A).includes('class="protest"'), 'a closed window shows no form');
ok(!read(build(withProtest('2026-12-01'), { now: '2026-12-02T00:00:00' }).out, A).includes('class="due"'), 'a closed window leaves the timeline too');
ok(!read(build(withProtest('2026-12-01', 'http://agency.example.gov/f')).out, A).includes('class="protest"'), 'a form link that is not https is not shown');
ok(!read(build(withProtest('soon')).out, A).includes('class="protest"'), 'an undated window is not shown');
ok(!pa.includes('class="protest"'), 'a filing with no protest window shows no box');

// 3e. SEO/editorial review (2026-11-06): a summary under the title built from the reviewed links,
// no contradicting "no deadline" line, one timeline event per filing, grouped entities, plain
// citations, a curated Bluesky list, and the record dates in the footer.
{
  const x = withProtest('2026-12-01');
  const v = x.dossiers['valley-campus'];
  v.statements = v.statements.filter((s) => s.kind !== 'summary' && s.kind !== 'next');
  v.links.push(
    { kind: 'organization', ref: 'MA:Example Digital, LLC', role: 'master_developer', grade: 'a', evidence_url: W,
      evidence_label: 'Change record x123', text: 'Named as the developer in the change record', facts: {} },
    { kind: 'organization', ref: 'MA:Example Authority', role: 'governing_body', grade: 'a', evidence_url: 'https://notice.example.gov/1',
      evidence_label: 'Authority notices', text: 'Adopted the project area plan', facts: {} },
    { kind: 'organization', ref: 'MA:Example Ranch, Inc.', role: 'applicant', grade: 'b', evidence_url: W, date: '2026-10-15',
      evidence_label: 'Change record x123', text: 'Applicant on change application x123', facts: {} },
    { kind: 'organization', ref: 'MA:Example Water LLC', role: 'consultant', grade: 'a', evidence_url: 'https://water.example.gov/doc.pdf',
      evidence_label: 'Application page 8', text: 'Prepared the depletion study', facts: {} },
    { kind: 'document', ref: 'https://water.example.gov/doc.pdf', role: 'primary_document', grade: 'a', date: '2026-10-15',
      date_label: 'Filed', evidence_url: 'https://water.example.gov/doc.pdf', evidence_label: 'Scanned document 1',
      text: 'Change application x123, as filed, with exhibits', aspect: 'Water', facts: {} },
    { kind: 'document', ref: W + '?details', role: 'primary_document', grade: 'a', date: '2026-10-15', date_label: 'Filed',
      evidence_url: W, evidence_label: 'Change Details x123', text: 'Change details for x123', aspect: 'Water', facts: {} },
    { kind: 'document', ref: 'https://water.example.gov/other.pdf', role: 'primary_document', grade: 'a', date: '2026-10-15',
      date_label: 'Filed', evidence_url: 'https://water.example.gov/other.pdf', evidence_label: 'Scanned document 2',
      text: 'Request to consolidate x1234', facts: {} },
    { kind: 'news_report', ref: 'https://news.example.com/a', role: 'reported_by', grade: 'b', date: '2026-06-04',
      date_label: 'Published', evidence_url: 'https://news.example.com/a', evidence_label: 'Example News', text: 'Developer shrinks the site', facts: {} });
  const P = (rk, day, text) => ({ kind: 'bluesky_post', ref: 'bsky:at://did:plc:x/app.bsky.feed.post/' + rk, role: 'explains', grade: 'a',
    evidence_url: 'https://bsky.app/profile/x/post/' + rk, facts: { text, published_at: day + 'T12:00:00Z' } });
  const long = 'A water filing says the campus would use about 987 acre-feet a year, near the ranch figure that it would replace each year. Is th';
  v.links = v.links.filter((l) => l.kind !== 'bluesky_post');
  v.links.push(P('p1', '2026-10-20', 'one'), P('p2', '2026-10-21', 'two'), P('p3', '2026-10-22', 'three'),
    P('p4', '2026-10-23', 'four'), P('p5', '2026-10-24', long),
    P('p6', '2026-11-02', 'The filing covers 558 MILLION gallons.\n\n🎥 https://youtu.be/q-phnTGrMRQ\nhttps://jodytracks.com\n\n#Tag'));
  const pg = read(build(x).out, A);
  const hero = pg.slice(pg.indexOf('<section class="hero"'), pg.indexOf('</section>', pg.indexOf('<section class="hero"')));
  ok(/<title>Valley data center &lt;campus&gt;, Hampshire County, MA \| HomeSignal<\/title>/.test(pg),
     'the title is the name and the place (short state when the full name runs past 64 characters); no Type word', (pg.match(/<title>.*?<\/title>/) || [''])[0]);
  ok(/<meta name="description" content="Track the Valley data center &lt;campus&gt; in Hampshire County, Massachusetts: official records, parcels, the developer, water filings and timeline\.">/.test(pg),
     'the description names what the page holds', (pg.match(/<meta name="description"[^>]*>/) || [''])[0]);
  ok(hero.includes('<ul class="dsum">') && hero.indexOf('class="dsum"') < hero.indexOf('Follow this development'),
     'a summary sits under the title, before the Follow button');
  ok(hero.includes('is a data center in Hampshire County, Massachusetts.') && hero.includes('href="https://atlas.example.org/dc/1"'),
     'its first sentence is the Type and place, with the defining record as source');
  ok(hero.includes('name Example Digital, LLC as the master developer') && hero.includes('Example Authority as the governing body'),
     'it names the developer and governing body from their links');
  ok(hero.includes('Permanent change application x123, filed Oct 15, 2026. The state lists it as unapproved (checked Oct 28, 2026). That status is for the water-rights application, not for the development as a whole.'),
     'it states the filing status as the application\'s, not the development\'s');
  ok(hero.includes('tie 13 parcels in ZIP 01002 and 01003 to the project. That is associated land, not a confirmed project footprint.'),
     'it counts the associated land without calling it a footprint');
  ok(!pg.includes('No HomeSignal summary published') && !/upcoming hearing or deadline/.test(pg),
     'no gap line contradicts the summary or the open protest window');
  ok(/<div class="tb" id="next">.*Dec 1, 2026<\/strong>: protest period ends for Permanent change application x123/.test(pg),
     'the protest deadline is listed under What\'s next');
  const tl = (pg.match(/<ol class="timeline">.*?<\/ol>/) || [''])[0];
  const oct15 = tl.split('<li>').filter((li) => li.includes('datetime="2026-10-15"'));
  ok(oct15.length === 2, 'the filing and the documents that name it are one event; a document for another filing stays its own', String(oct15.length));
  ok(oct15.some((li) => li.includes('Water-rights filing: Permanent change application x123') && li.includes('Filed by Example Ranch, Inc.')
     && li.includes('Change application x123, as filed, with exhibits') && li.includes('Sources:')),
     'the event names the applicant and lists each document as a source');
  ok(oct15.some((li) => li.includes('Request to consolidate x1234')), 'x1234 is not folded into x123');
  const due = tl.split('<li').filter((li) => li.includes('datetime="2026-12-01"'));
  ok(due.length === 1 && due[0].startsWith(' class="due"') && due[0].includes('<span>Deadline</span>')
     && due[0].includes('Deadline to protest Permanent change application x123')
     && due[0].includes('<a class="tform" href="https://agency.example.gov/protest-form" rel="nofollow noopener">File a protest with the agency</a>')
     && due[0].includes('State change record</a>'),
     'the open protest deadline is on the timeline with the form and the state record', due.join('|'));
  ok(tl.indexOf('datetime="2026-12-01"') < tl.indexOf('datetime="2026-10-15"'), 'the deadline sits at the top (newest first)');
  ok(pg.includes('An upcoming deadline is marked and sits at the top.'), 'the timeline intro says a deadline is listed');
  ok(/<span>Reported<\/span>.*?<span class="chip">News report<\/span>/.test(tl), 'a news report is marked as reporting');
  const ents = (pg.match(/<div class="tb" id="entities">.*?<\/details>/) || [''])[0];
  ok(ents.indexOf('<h3>Developer and governing agencies</h3>') >= 0
     && ents.indexOf('<h3>Developer and governing agencies</h3>') < ents.indexOf('<h3>Applicants, buyers and landowners</h3>')
     && ents.indexOf('<h3>Applicants, buyers and landowners</h3>') < ents.indexOf('<h3>Consultants and designers</h3>'),
     'entities are grouped: decision-makers, then applicants and owners, then consultants');
  ok(pg.includes('<h2 id="h-map">Land &amp; Maps</h2>') && pg.includes('Associated parcels and links to the ZIP maps'), 'the land tile says what it holds');
  const main = pg.slice(pg.indexOf('<main'), pg.indexOf('</main>'));
  const cites = [...main.matchAll(/<a href="https:\/\/[^"]+" rel="([^"]+)"/g)].map((m) => m[1]);
  ok(cites.length > 10 && cites.every((r) => r === 'noopener'), 'source citations carry no nofollow', JSON.stringify(cites));
  ok(/<a class="btn" href="https:\/\/agency\.example\.gov\/protest-form" rel="nofollow noopener">/.test(pg), 'the protest form action keeps nofollow');
  ok(/href="\/follow-development\.html[^"]*" rel="nofollow"/.test(pg), 'the Follow action keeps nofollow');
  const bs = (pg.match(/<h3>Bluesky<\/h3>.*?<\/ul><\/div>/) || [''])[0];
  ok(!pg.includes('Bluesky updates'), 'the heading is just "Bluesky"');
  ok(!pg.includes('own explainers'), 'no "own explainers" sentence above the videos');
  ok(!pg.includes('editorial coverage') && !pg.includes('listed separately below') && (bs.match(/<li>/g) || []).length === 5
     && (bs.match(/<li aria-hidden="true">/g) || []).length === 5,
     'Bluesky: at most five posts, then a hidden copy of each so the reel can loop', String((bs.match(/<li>/g) || []).length));
  ok(bs.includes('<div class="reel moving" role="region" aria-label="Bluesky posts"><ul class="reel-track posts" style="--n:5">'),
     'the posts are tiles in a moving reel, like the videos');
  ok(!/<li aria-hidden="true">.*?<a (?!tabindex="-1")/.test(bs.replace(/<li>.*?<\/li>/g, '')), 'the copies are out of the keyboard order');
  ok(bs.indexOf('Nov 2, 2026') < bs.indexOf('Oct 24, 2026') && !bs.includes('>one<'), 'newest first; the oldest past five is left out');
  ok(bs.includes('<p class="ptext">The filing covers 558 MILLION gallons.</p>') && !/youtu\.be|jodytracks\.com|🎥|#Tag/.test(bs),
     'a post excerpt drops links, emoji and hashtags');
  ok(bs.includes('near the ranch figure that it would replace each year. Is th…</p>'), 'a cut-off excerpt says so');
  ok(bs.includes('href="https://bsky.app/profile/x/post/p6" rel="noopener">View post on Bluesky</a>'), 'each post links to Bluesky');
  ok(!tl.includes('bsky.app'), 'posts are not timeline events');
  ok(/Status of Permanent change application x123 last checked with the state: <time datetime="2026-10-28">Oct 28, 2026<\/time>/.test(pg)
     && /Last updated <time datetime="2026-10-29">/.test(pg)
     && pg.includes('href="/how-it-works.html"') && pg.includes('href="/contact.html">Report a correction'),
     'the footer gives the record dates, how sources are checked, and how to report a correction');
}

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

// 7c. every file the build writes is one the deploy's artifact audit accepts (pages.yml,
// "Audit the REAL artifact"). 2026-10-30: the first real dossier build failed that audit on
// development/ut/stratos-box-elder/index.html and development/land-index.json.
const PAGES = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
const gen = PAGES.slice(PAGES.indexOf('def generated(p):'), PAGES.indexOf('unexpected = sorted('));
const exact = [...(gen.match(/p in \(([^)]*)\)/) || [, ''])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const prefixes = [...gen.matchAll(/p\.startswith\('([^']+)'\)/g)].map((m) => m[1]);
ok(prefixes.length >= 8 && exact.includes('zip-pages-manifest.json'), 'the audit list of accepted files was read', JSON.stringify([exact, prefixes]));
const walk = (d, base = '') => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name), base + e.name + '/') : [base + e.name]);
const written = walk(out).filter((p) => p !== 'sitemap.xml');
const refused = written.filter((p) => !exact.includes(p) && !prefixes.some((x) => p.startsWith(x)));
ok(written.some((p) => p.startsWith('development/')) && refused.length === 0,
   'the artifact audit accepts every file the build writes', JSON.stringify(refused.slice(0, 10)));

// 7d. Search-result basics (2026-11-06): a title and description that fit, the page's own structured
// data with the day the dossier last changed, a visible last-updated line, and more links to our own pages.
{
  const dec = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  const title = (h) => dec((h.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]);
  const desc = (h) => dec((h.match(/<meta name="description" content="([\s\S]*?)">/) || [, ''])[1]);
  const ldOf = (h) => JSON.parse((h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [, 'null'])[1]);
  for (const [p, h] of [[A, pa], [B, pb]]) {
    ok(title(h).length > 0 && title(h).length <= 64 && !title(h).includes(' — '), `${p}: the title fits a search result`, title(h));
    ok(desc(h).length > 0 && desc(h).length <= 155, `${p}: the description fits a search result`, String(desc(h).length));
    const g = (ldOf(h) || {})['@graph'] || [];
    ok(g.some((x) => x['@type'] === 'BreadcrumbList') && g.some((x) => x['@type'] === 'WebPage'), `${p}: breadcrumbs and the page itself are in the structured data`);
  }
  const wp = (h) => ((ldOf(h) || {})['@graph'] || []).find((x) => x['@type'] === 'WebPage') || {};
  ok(wp(pa).dateModified === '2026-10-29' && wp(pb).dateModified === '2026-10-20', 'dateModified is the dossier\'s own last change, not the build day',
     JSON.stringify([wp(pa).dateModified, wp(pb).dateModified]));
  ok(pa.includes('Last updated <time datetime="2026-10-29">Oct 29, 2026</time>.'), 'the page says when it was last updated');
  const noDate = dossiers();
  delete noDate.dossiers['valley-campus'].updated_at;
  const nd = read(build(noDate).out, A);
  ok(!('dateModified' in wp(nd)) && !nd.includes('Last updated <time'), 'with no change date on record, none is claimed');
  ok(/href="\/community\/01002\/">ZIP 01002 page<\/a>/.test(pa) && /href="\/community\/01003\/">ZIP 01003 page<\/a>/.test(pa),
     'each ZIP in Map & land links to its ZIP page as well as its map page');
  const recs = (pb.match(/<div id="records">[\s\S]*?<\/div>/) || [''])[0];
  ok(/<a href="\/project\/[^"]+\/">Olympia Apartments<\/a>/.test(recs), 'a linked source record is listed with its record page', recs.slice(0, 300));
  ok(!pa.includes('id="records"') && !/Not on record yet:[^<]*record page/.test(pa), 'with no linked record page the section is not drawn or called a gap');
  const py = (code) => spawnSync('python3', ['-c', 'import sys,json; sys.path.insert(0,"scripts"); import development_pages as d; ' + code], { cwd: root, encoding: 'utf8' });
  const STRATOS = 'A data center campus proposed for ranch land in Hansel Valley, in western Box Elder County. In October 2026, Bar H Ranch, Inc. asked the Utah Division of Water Rights to move water now used to irrigate the ranch to the project. The filing names O\'Leary Digital Utah DC Sub I, LLC as the developer.';
  const md = py(`print(json.dumps(d.meta_description(${JSON.stringify(STRATOS)}, "fallback")))`);
  const mdv = JSON.parse(md.stdout || '""');
  ok(mdv === 'A data center campus proposed for ranch land in Hansel Valley, in western Box Elder County.', 'the description is the first whole sentence that fits, and "Inc." does not end a sentence', mdv + md.stderr);
  // An abbreviation followed by a capital letter is not a sentence end: with this text the whole thing is one
  // sentence too long for a description, so it is cut at a word. Split at "Inc." it would return the short head.
  const INC = 'The applicant is Bar H Ranch, Inc. Utah regulators received its filing in October 2026 to move water now used to irrigate the ranch to a proposed data center campus.';
  const incd = JSON.parse(py(`print(json.dumps(d.meta_description(${JSON.stringify(INC)}, "fallback")))`).stdout || '""');
  ok(incd.includes('Bar H Ranch, Inc. Utah') && incd.endsWith('\u2026') && incd.length <= 155, '"Inc." followed by a capital does not end a sentence', incd);
  ok(/href="\/community\/01002\/">ZIP 01002 page<\/a>/.test(pb), 'a ZIP that comes from a linked record, not a land assembly, links to its ZIP page too');
  const longOne = py('print(json.dumps(d.meta_description("word " * 80, "fallback")))');
  const lv = JSON.parse(longOne.stdout || '""');
  ok(lv.length <= 155 && lv.endsWith('\u2026') && !lv.endsWith(' \u2026'), 'one sentence too long is cut at a word and ends with an ellipsis', lv);
  const fb = py('print(json.dumps(d.meta_description("", "fallback")))');
  ok(JSON.parse(fb.stdout || '""') === 'fallback', 'with no summary the plain fallback is used');
  const tt = py('print(json.dumps([d.page_title("Stratos data center project", "Box Elder County, Utah"), d.page_title("A very long project name that goes on and on and on", "Box Elder County, Utah"), d.page_title("Name", "")]))');
  const tv = JSON.parse(tt.stdout || '[]');
  ok(tv[0] === 'Stratos data center project, Box Elder County, Utah | HomeSignal' && tv[0].length <= 64, 'the title names the project and the place', JSON.stringify(tv));
  ok(tv[1] === 'A very long project name that goes on and on and on | HomeSignal' && tv[2] === 'Name | HomeSignal', 'a title too long drops the place and keeps the name; no place, no comma', JSON.stringify(tv));
}

// 3f. Expandable information tiles (2026-11-06): the sections are closed <details> tiles; the
// name, place, Type, lifecycle, summary, Follow and an open protest window stay visible above them.
{
  const pg = read(build(withProtest('2026-12-01')).out, A);
  const tiles = pg.slice(pg.indexOf('<div class="tiles">'), pg.indexOf('</div>', pg.lastIndexOf('</details>')));
  const det = tiles.match(/<details[^>]*>/g) || [];
  ok(det.length >= 6 && det.every((t) => t === '<details>'), 'every tile is a <details> that starts closed', JSON.stringify(det));
  // The tiles open and close with no script. The only scripts are the JSON-LD and the site header's
  // own (lib/share-modal.js + lib/dossier-header.js), which never touch a tile.
  const scripts = pg.match(/<script(?! type="application\/ld\+json")[^>]*>/g) || [];
  ok(scripts.every((t) => /src="\/lib\/(?:share-modal|dossier-header)\.js/.test(t)) && !pg.includes('<nav class="toc"'),
     'no tile script (only the header scripts), and the separate jump list is gone', JSON.stringify(scripts));
  const heads = [...pg.matchAll(/<summary>.*?<h2 id="h-([a-z]+)">(.*?)<\/h2><span class="ts">(.*?)<\/span>.*?<\/summary><div class="tb" id="([a-z]+)">/g)];
  ok(heads.length === det.length && heads.every((m) => m[1] === m[4] && m[3].length > 0),
     'each tile has a heading and a one-line description in its summary, and the body carries the section id', JSON.stringify(heads.map((m) => [m[1], m[2], m[4]])));
  ok(JSON.stringify(heads.map((m) => m[1])) === JSON.stringify(['overview', 'next', 'timeline', 'entities', 'documents', 'map', 'coverage']),
     'the tiles in order; empty ones are not drawn', JSON.stringify(heads.map((m) => m[1])));
  ok(/<h2 id="h-coverage">HomeSignal Coverage<\/h2><span class="ts">2 videos, 1 Bluesky post<\/span>/.test(pg)
     && /<h2 id="h-timeline">Project Timeline<\/h2><span class="ts">\d+ dated events?, newest first<\/span>/.test(pg),
     'descriptions carry counts from the page\'s own lists');
  const hero = pg.slice(pg.indexOf('<section class="hero"'), pg.indexOf('<div class="tiles">'));
  ok(hero.includes('<h1') && hero.includes('class="where"') && hero.includes('class="pill type"') && hero.includes('class="pill life"')
     && hero.includes('Follow this development') && hero.includes('Protest period open until Dec 1, 2026') && !hero.includes('<details'),
     'name, place, Type, lifecycle, Follow and the open deadline are outside the tiles');
  ok(/<svg [^>]*focusable="false">/.test(tiles) && /<span class="ti" aria-hidden="true">/.test(tiles), 'icons are decorative');
  ok(pg.includes('.tile details[open]>summary .chev{transform:') && pg.includes('.tile summary::-webkit-details-marker{display:none}'),
     'the chevron turns when a tile is open and the default marker is hidden');
  // presentation-only: every source link in the old page is still on the new page
  const links = (t) => new Set([...t.matchAll(/href="(https:\/\/[^"]+)"/g)].map((m) => m[1]));
  ok([...links(pa)].length > 5 && [...links(pa)].every((u) => pa.includes(u)), 'control: links counted');
  const impactX = dossiers();
  impactX.dossiers['valley-campus'].statements.push({ kind: 'impact', body: 'Truck traffic on the ranch road.', evidence_url: W, evidence_label: 'Change record x123' });
  const pi = read(build(impactX).out, A);
  ok(/<h2 id="h-impacts">Community impacts<\/h2>.*Truck traffic on the ranch road\./s.test(pi) && !pa.includes('id="impacts"'),
     'Community impacts is drawn only when a record names an effect');
}

// 8. determinism and the build day
const again = build(dossiers());
ok(read(again.out, A) === pa, 'identical input produces a byte-identical page');
const later = build(dossiers(), { now: '2026-11-03T00:00:00' });
const st1 = JSON.parse(readFileSync(join(out, 'sitemaps', 'page-state.json'), 'utf8'));
const st2 = JSON.parse(readFileSync(join(later.out, 'sitemaps', 'page-state.json'), 'utf8'));
const h = (st, p) => (st.pages || st.entries || {})[p];
ok(h(st1, A) && JSON.stringify(h(st1, A).h) === JSON.stringify(h(st2, A).h), 'a later build day does not move the fingerprint',
   JSON.stringify([h(st1, A), h(st2, A)]));

// 3d. The header and footer are the site's own (founder, 2026-11-01: "they are not same as website").
{
  const shell = readFileSync(join(root, 'partials', 'shell.html'), 'utf8');
  const hrefs = (t) => [...t.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/^(?!https?:|\/)/, '/'));
  const sHead = shell.match(/<header class="hs-header"[\s\S]*?<\/header>/)[0];
  const sFoot = shell.match(/<footer class="hs-footer"[\s\S]*?<\/footer>/)[0];
  const pg = read(out, A);
  const pHead = (pg.match(/<header class="hs-header"[\s\S]*?<\/header>/) || [''])[0];
  const pFoot = (pg.match(/<footer class="hs-footer"[\s\S]*?<\/footer>/) || [''])[0];
  const navOf = (t) => (t.match(/<nav class="hs-nav"[\s\S]*?<\/nav>/) || [''])[0];
  const brandOf = (t) => t.slice(0, t.indexOf('<nav class="hs-nav"'));
  ok(pHead && JSON.stringify(hrefs(brandOf(pHead) + navOf(pHead))) === JSON.stringify(hrefs(brandOf(sHead) + navOf(sHead))),
     'the header has the site header\'s links, in order', JSON.stringify([hrefs(pHead), hrefs(sHead)]));
  // 2026-11-06 (founder: "where is share button and login in top right corner"): the account buttons are the site's.
  ok(/<button class="hs-header__share" type="button" id="hs-share" hidden>Share<\/button>/.test(pHead), 'the header has the Share button');
  ok(pHead.includes('<a class="hs-header__signin" id="hs-signin" href="/?signin=1&amp;return=%2Fdevelopment%2Fma%2Fvalley-campus%2F">Sign in</a>'),
     'Sign in opens the site sign-in and returns to this page');
  ok(/<a class="avatar hs-header__avatar" id="hs-avatar" href="\/properties\.html"[^>]* hidden>/.test(pHead), 'the account avatar is there, hidden until signed in');
  ok(!pg.includes('__HS_RETURN_PATH__'), 'no return placeholder is left on the page');
  ok(/\.hs-header \[hidden\]\{display:none!important\}/.test(pg), 'hidden header buttons stay hidden');
  ok(pFoot && JSON.stringify(hrefs(pFoot)) === JSON.stringify(hrefs(sFoot)), 'the footer has the site footer\'s links, in order',
     JSON.stringify([hrefs(pFoot), hrefs(sFoot)]));
  ok(hrefs(sHead).length >= 8 && hrefs(sFoot).length >= 8, 'control: the site header and footer were read');
  ok(!/HomeSignal home|How HomeSignal works|class="site"/.test(pg), 'the old hand-made header and footer are gone');
  ok(!/onclick=|<script/.test(pHead + pFoot), 'the header and footer need no script');
  ok(/@media \(max-width:1023px\)\{\.hs-menutoggle:checked~\.hs-nav\{display:flex\}\}/.test(pg)
     && pHead.indexOf('id="hs-menutoggle"') < pHead.indexOf('<nav class="hs-nav"'), 'the narrow-screen menu opens without a script');
  ok(pg.includes('.hs-header{position:sticky'), 'the site header styles are on the page');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
