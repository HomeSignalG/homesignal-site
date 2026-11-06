// The development-dossier fixture and the build helper, shared by development-pages.test.mjs
// (offline) and development-pages-tiles.browser.test.mjs (Chromium). Runs the SHIPPED generator.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
const FIXDIR = join(root, 'test', 'fixtures', 'city-pages');
const ZIPS = readFileSync(join(FIXDIR, 'zip-pages.json'), 'utf8');
const PLANE = JSON.parse(readFileSync(join(FIXDIR, 'development_seo_plane.json'), 'utf8'));

export const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://jodytracks.com/</loc>
  </url>
</urlset>
`;
export const PKEY = 'arcgis:town-permits:BLD-2026-0001|1';
export const W = 'https://water.example.gov/change/x123';

export function dossiers() {
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
            evidence_url: 'https://atlas.example.org/dc/1', evidence_label: 'Data-center listing', text: 'Valley campus (atlas record dc-1; status proposed)',
            facts: { classification: 'CONFIRMED_DC' } },
          { kind: 'land_assembly', ref: 'valley-campus', role: 'associated_land', grade: 'a', evidence_url: 'https://county.example.gov/parcels',
            facts: { display_name: 'Valley data center <campus>', display_name_basis: 'descriptive',
                     zips: [{ zip: '01002', parcels: 12, primary: true }, { zip: '01003', parcels: 1, primary: false }] } },
          { kind: 'water_filing', ref: 'ut_dwr:x123', role: 'water_change_application', grade: 'a', evidence_url: W,
            evidence_label: 'Change record x123', date: null,
            facts: { filing_no: 'x123', filing_type: 'Permanent change application', status: 'Unapproved',
                     filed_on: '2026-10-15', date_label: 'Priority date', record_url: W, points: 2 } },
          { kind: 'organization', ref: 'MA:Example Ranch, Inc.', role: 'landowner_of_record', grade: 'a', evidence_url: W,
            evidence_label: 'Change record x123', text: 'Owner of the water right being changed, filed 2026-10-15', facts: {} },
          { kind: 'government_record', ref: 'https://board.example.gov/agenda/9', role: 'agenda_item', grade: 'a',
            evidence_url: 'https://board.example.gov/agenda/9', evidence_label: 'Board agenda', text: 'Board agenda item 9',
            date: '2026-07-15', date_label: 'On agenda', aspect: 'Approvals', facts: {} },
          { kind: 'youtube_video', ref: 'youtube:q-phnTGrMRQ', role: 'explains', grade: 'a',
            evidence_url: 'https://www.youtube.com/watch?v=q-phnTGrMRQ',
            facts: { title: 'What the water filing says', url: 'https://www.youtube.com/watch?v=q-phnTGrMRQ', kind: 'main' } },
          { kind: 'youtube_video', ref: 'youtube:shortAAAAAA', role: 'explains', grade: 'a',
            evidence_url: 'https://www.youtube.com/shorts/shortAAAAAA',
            facts: { title: 'The filing in 40 seconds #Shorts #jodytracks', url: 'https://www.youtube.com/shorts/shortAAAAAA', kind: 'short' } },
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

export function inputs() {
  const { cities, ...zipPlane } = JSON.parse(JSON.stringify(PLANE));
  return {
    zipPlane,
    cities: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, cities },
    projects: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, scope: 'featured',
      projects: { [PKEY]: { registry_id: 'town-permits', case: 'BLD-2026-0001', name: 'Olympia Apartments', type: 'Residential',
        status: 'Approved', source_url: 'https://permits.example.gov/r/1', zips: ['01002'], date: '2026-09-01', date_kind: 'filed' } } },
  };
}

export function build(dv, { now = '2026-10-29T00:00:00' } = {}) {
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
export const read = (out, p) => readFileSync(join(out, ...p.split('/').filter(Boolean), 'index.html'), 'utf8');
