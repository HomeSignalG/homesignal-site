// THE OVERVIEW PUTS THE LARGEST NEW BUILDINGS FIRST (founder, 2026-11-02: "is there a way to rank biggest impact developments first ... a proposed 8-story,
// 254-unit apartment building ... does not appear in the six most significant changes on page 1"; then "yes build nationally").
// The engine reads each record's documented scale (units, stories, floor area) from the record's own words, never from an existing building and never
// estimated (documentedScale, carried as relevance.scale). The report view gives up to four overview lines to new buildings, largest first, then to changes
// of use that state a unit count; the rest go one per kind as before. Built on the real records near 3101 Western Ave, Seattle, and on other agencies' wording.
// Run: node test/report-overview-scale.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../supabase/functions/_shared/national-report.ts');
globalThis.window = globalThis;
await import('../lib/project-type.js');
await import('../lib/da-report-view.js');
const V = globalThis.HS.daReportView;
let fails = 0, total = 0;
const ok = (c, name, detail) => { total++; console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 700)); } };
const read = (f) => readFileSync(join(root, f), 'utf8');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. documentedScale: real phrasings from several agencies (the 5,000-record national sample, 2026-11-02) ----------------------------------------------
{
  const S = M.documentedScale;
  ok(eq(S('Master Use Permit Land Use Application to allow an 8-story, 254-unit apartment building. Parking for 212 vehicles proposed.'), { units: 254, stories: 8 }),
    '1a Seattle: "8-story, 254-unit" reads 254 units and 8 stories; "212 vehicles" is not a unit count');
  ok(eq(S('Establish use as permanent supportive housing for 83 stacked dwelling units and human service use'), { units: 83 }), '1b "83 stacked dwelling units" reads 83 units');
  ok(eq(S('PERMIT - NEW CONSTRUCTION SPR 2019 CBC, ERECT A 4-STORY TYPE IIIA MASONRY RESIDENTIAL BUILDING WITH 15 UNITS, BASEMENT'), { units: 15, stories: 4 }), '1c Chicago upper case: 15 units, 4 stories');
  ok(eq(S('Building Townhomes, 6 units, Lots 108-113, 3 stories, VB Construction'), { units: 6, stories: 3 }), '1d Raleigh-style townhomes: 6 units, 3 stories');
  ok(eq(S('Construct a 45,000 sq ft warehouse'), { sqft: 45000 }) && eq(S('New 2,500 SF single family residence'), { sqft: 2500 }), '1e floor area with a thousands comma, "sq ft" and "SF"');
  ok(S('Commercial 395 SOUTH CROW CREEK DR NW 28467 Unit 1517') === undefined && S('Residential 1282 LANVALE RD NE 28451 UNIT A') === undefined
    && S('Alteration/Tenant Finish 3131 E Alameda AVE 1605 UNIT') === undefined && S('Repairs to unit 405') === undefined,
    '1f a ZIP or house number before "Unit", or a unit number, is an address, never a count');
  ok(S('Construct alterations to existing 12-story office building') === undefined
    && S('Construct repairs to exterior of existing multifamily building (floors 2-12  55 balconies)') === undefined,
    '1g a number about a building that already stands is not read ("existing 12-story", "floors 2-12", "55 balconies")');
  ok(S('SF residence addition') === undefined && S('') === undefined && S(null) === undefined, '1h no number, no scale; empty input is safe');
}

// ---- 2. the engine carries it on every included record's relevance, and only what the record states -------------------------------------------------
{
  const r = M.relevance({ name: 'Master Use Permit Land Use Application to allow an 8-story, 254-unit apartment building.', type_raw: 'Master Use Permit' }, 'residential');
  ok(r.include && r.basis === 'land_use' && r.proposes === 'new_construction' && eq(r.scale, { units: 254, stories: 8 }), '2a a land-use application for a building carries proposes and its scale', r);
  const q = M.relevance({ name: 'Commercial Demolish commercial warehouse building per plan.', type_raw: 'Commercial' }, 'commercial');
  ok(q.include && !('scale' in q), '2b a record that states no size carries no scale (nothing is estimated)', q);
  const fx = JSON.parse(read('test/fixtures/report-quality/seattle-3101-western-2026-11-02.json'));
  const attribution = JSON.parse(read('supabase/functions/_shared/source-attribution.json'));
  const SUBJECT = { address: '3101 Western Ave, Seattle, WA 98121', matched_address: null, lat: fx._meta.subject_point[0], lng: fx._meta.subject_point[1], zip: '98121' };
  const a = M.assemble({ now: new Date('2026-11-02T18:00:00Z'), subject: SUBJECT, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution,
    rows: fx.rows, projects: fx.projects, ledger: fx.ledger, events: fx.events, health: fx.health });
  const big = a.intelligence.projects.find((p) => /254-unit/.test(p.title ?? '') || /254-unit/.test(JSON.stringify(p)));
  ok(big && eq(big.relevance.scale, { units: 254, stories: 8 }), '2c the Seattle report carries the 254-unit building\'s scale in its relevance', big && big.relevance);

  // ---- 3. the view: the largest new buildings lead the overview ---------------------------------------------------------------------------------------
  const html = V.html({ status: 'OK', coverage_state: a.coverage_state, report: a.intelligence, render: a.renderOnly }, { subject: SUBJECT.address });
  const ov = (html.match(/data-da-overview>([\s\S]*?)<\/ol>/) || ['', ''])[1];
  const lines = [...ov.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'));
  ok(lines.length === 6 && /254-unit apartment building/.test(lines[0]) && /10-story/.test(lines[1]) && /residential high rise/.test(lines[2]) && /83 stacked dwelling units/.test(lines[3]),
    '3a Seattle: the 254-unit building leads, then the 10-story building, the high rise that states no size, then the 83-unit supportive housing', lines);
  ok(/Shoreline/.test(lines[4]) && /^Demolition/.test(lines[5]), '3b the last two lines still cover other kinds of change (land use, demolition), one per kind', lines.slice(4));
  ok(/new buildings first, largest first by the units, stories or floor area the record states/.test(html) && /Not by any predicted effect/.test(html),
    '3c the note under the list says how it is ordered, and that it predicts nothing');
}

// ---- 4. the view, on the real Seattle response with chosen sizes: ordering and the four-line cap --------------------------------------------------------
{
  const fx = JSON.parse(read('test/fixtures/report-quality/seattle-3101-western-2026-11-02.json'));
  const attribution = JSON.parse(read('supabase/functions/_shared/source-attribution.json'));
  const SUBJECT = { address: '3101 Western Ave, Seattle, WA 98121', matched_address: null, lat: fx._meta.subject_point[0], lng: fx._meta.subject_point[1], zip: '98121' };
  const a = M.assemble({ now: new Date('2026-11-02T18:00:00Z'), subject: SUBJECT, radius_mi: 0.5, view: 'customer', zip_supported: true, attribution,
    rows: fx.rows, projects: fx.projects, ledger: fx.ledger, events: fx.events, health: fx.health });
  // each test record is a real project from the report, renamed and given a basis and scale; every other project leaves the overview (no basis)
  const ovOf = (spec) => {
    const rep = JSON.parse(JSON.stringify(a.intelligence));
    rep.projects.forEach((p, i) => {
      const s = spec[i];
      if (!s) { p.relevance = {}; return; }
      p.name = 'Record ' + s[0] + ' with a long enough title to keep'; p.publisher_type = null; p.title_cut = false;
      p.relevance = { basis: s[1], evidence: s[1], ...(s[2] ? { scale: s[2] } : {}), ...(s[3] || {}), rule_version: 'relevance-2' };
    });
    const h = V.html({ status: 'OK', coverage_state: a.coverage_state, report: rep, render: a.renderOnly }, { subject: SUBJECT.address });
    return [...((h.match(/data-da-overview>([\s\S]*?)<\/ol>/) || ['', ''])[1]).matchAll(/Record (\S+) with/g)].map((m) => m[1]);
  };
  const o = ovOf([['demo', 'demolition'], ['house', 'new_construction', { sqft: 1800 }], ['tower', 'new_construction', { units: 300, stories: 30 }],
    ['mid', 'land_use', { stories: 12 }, { proposes: 'new_construction' }], ['nosize', 'new_construction'], ['hotel', 'change_of_use', { units: 120 }],
    ['restaurant', 'change_of_use'], ['addition', 'addition']]);
  ok(eq(o.slice(0, 4), ['tower', 'mid', 'house', 'nosize']), '4a units outrank stories, stories outrank floor area, a stated size outranks none (and four lines is the cap)', o);
  ok(eq(o.slice(4), ['demo', 'hotel']), '4b the cap keeps two lines for other kinds of change, one per kind (demolition, then change of use)', o);
  const o2 = ovOf([['demo', 'demolition'], ['hotel', 'change_of_use', { units: 120 }], ['restaurant', 'change_of_use'], ['one', 'new_construction', { units: 4 }]]);
  ok(eq(o2.slice(0, 2), ['one', 'hotel']), '4c with one building, a change of use that states units comes next', o2);
  const o3 = ovOf([['a', 'new_construction', { units: 10 }], ['b', 'new_construction', { units: 10 }], ['c', 'new_construction', { units: '500' }]]);
  ok(o3.length === 3 && o3[2] === 'c' && eq(o3.slice(0, 2).sort(), ['a', 'b']), '4d a size that is not a number ("500" as text) counts as none (equal sizes keep the report\'s own order)', o3);
}

console.log(`\n${total - fails} passed, ${fails} failed of ${total}`);
process.exit(fails ? 1 : 0);
