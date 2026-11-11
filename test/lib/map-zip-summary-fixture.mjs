// Shared fixture for test/map-zip-summary*.test.mjs: runs the SHIPPED generator over the city-pages fixture
// (the one test/project-pages.test.mjs uses) with a pilot manifest.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GEN = join(root, 'scripts', 'gen_zip_pages.py');
export const FIXDIR = join(root, 'test', 'fixtures', 'city-pages');
export const ZIPS = readFileSync(join(FIXDIR, 'zip-pages.json'), 'utf8');
export const BASE_PLANE = JSON.parse(readFileSync(join(FIXDIR, 'development_seo_plane.json'), 'utf8'));

export const TREAT = ['01002', '01004', '01009'];   // counted · held (not measured) · absent from the plane
export const CONTROL = ['01003'];
export const SITEMAP = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://jodytracks.com/</loc>\n  </url>\n</urlset>\n';

export function makeDocs(mutate) {
  const plane = JSON.parse(JSON.stringify(BASE_PLANE));
  const projects = {};
  let i = 0;
  for (const [z, rec] of Object.entries(plane.zips)) {
    for (const e of rec.representative_entities || []) {
      i += 1;
      const cs = `BLD-2026-${String(i).padStart(4, '0')}`;
      e.key = `arcgis:town-permits:${cs}|1`;
      projects[e.key] = { registry_id: 'town-permits', case: cs, name: e.name, type: e.type, status: e.status,
        source_url: e.source_url, zips: [z], ...(e.date ? { date: e.date, date_kind: 'filed' } : {}) };
    }
  }
  const { cities, ...zipPlane } = plane;
  const docs = {
    zipPlane,
    cities: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, cities },
    projects: { version: '1.0.0', identity: zipPlane.identity, generated_at: zipPlane.generated_at, scope: 'featured', projects },
  };
  if (mutate) mutate(docs);
  return docs;
}

export function manifest(mode, treatment = TREAT, control = CONTROL) {
  const p = join(mkdtempSync(join(tmpdir(), 'mzs-man-')), 'pilot.json');
  writeFileSync(p, JSON.stringify({ mode, treatment, control }));
  return p;
}

export function build(docs, pilot, { baseline, now = '2026-09-28T00:00:00', out } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mzs-fix-'));
  writeFileSync(join(dir, 'zip-pages.json'), ZIPS);
  writeFileSync(join(dir, 'development_seo_plane.json'), JSON.stringify(docs.zipPlane));
  writeFileSync(join(dir, 'development_seo_cities.json'), JSON.stringify(docs.cities));
  writeFileSync(join(dir, 'development_seo_projects.json'), JSON.stringify(docs.projects));
  out = out || mkdtempSync(join(tmpdir(), 'mzs-out-'));
  if (!existsSync(join(out, 'sitemap.xml'))) writeFileSync(join(out, 'sitemap.xml'), SITEMAP);
  const delta = join(dir, 'delta.json');
  const args = [GEN, '--fixture', join(dir, 'zip-pages.json'), '--out', out, '--now', now, '--map-pilot', pilot,
    '--delta-out', delta];
  if (baseline) args.push('--baseline', baseline);
  const r = spawnSync('python3', args, { encoding: 'utf8' });
  return { r, out, delta: existsSync(delta) ? JSON.parse(readFileSync(delta, 'utf8')) : null };
}
export const read = (out, p) => readFileSync(join(out, ...p.split('/').filter(Boolean), 'index.html'), 'utf8');
export const outsideTemplate = (h) => h.replace(/<template\b[\s\S]*?<\/template>/i, '');
export const visibleText = (h) => outsideTemplate(h).replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
export const summaryOf = (h) => (outsideTemplate(h).match(/<section class="hs-map-zip-summary"[\s\S]*?<\/section>/) || [''])[0];

