// A GEOGRAPHIC FOCUS AREA GETS ITS OWN SITEMAP, AS A SUBSET OF THE NATIONAL ONE.
// Drives the shipped write_focus_sitemaps() and reads the shipped config, workflow gate and robots.txt.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m); } };

const cfg = JSON.parse(readFileSync(join(root, 'data', 'seo-focus-areas.json'), 'utf8')).areas;
const pierce = cfg.find((a) => a.slug === 'pierce-county-wa');
ok(pierce && pierce.state === 'WA' && pierce.county === 'Pierce' && pierce.expected_zips === 65, 'config names Pierce County WA with 65 expected ZIPs');

// the tripwire equals the committed community seed (generated, not typed): distinct Pierce ZIPs
const seed = readFileSync(join(root, 'docs', 'washington-communities-seed.sql'), 'utf8');
const seedZips = new Set([...seed.matchAll(/'Pierce','[a-z0-9-]+','(\d{5})','pierce-county-wa'/g)].map((m) => m[1]));
ok(seedZips.size === pierce.expected_zips, `seed lists ${seedZips.size} Pierce ZIP pages == expected_zips`);

// ---- behaviour: fixture with Pierce WA, a same-named county in another state, one noindex Pierce ZIP
const py = `
import sys, json, os, tempfile
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import gen_zip_pages as g
pages = {
  '98401': dict(state='WA', county='Pierce', rule_f_count=5),
  '98402': dict(state='WA', county='Pierce', rule_f_count=3),
  '98397': dict(state='WA', county='Pierce', rule_f_count=1),
  '98001': dict(state='WA', county='King', rule_f_count=9),
  '43001': dict(state='OH', county='Pierce', rule_f_count=9),
  '99999': dict(state='WA', county=''),
}
indexable = ['98401', '98402', '98001', '43001']
out = sys.argv[1]
rep = g.write_focus_sitemaps(out, [dict(slug='pierce-county-wa', name='Pierce County, WA', state='WA', county='Pierce', expected_zips=3)],
                             pages, indexable, {'/community/98401/': '2026-10-20'})
print(json.dumps(rep))
`;
const d = mkdtempSync(join(tmpdir(), 'focus-'));
try {
  const rep = JSON.parse(execFileSync('python3', ['-I', '-c', py, d], { encoding: 'utf8' }).trim().split('\n').pop())['pierce-county-wa'];
  const xml = readFileSync(join(d, 'sitemaps', 'pierce-county-wa.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok(JSON.stringify(rep.members) === '["98397","98401","98402"]', 'members = WA + Pierce only (not King, not Pierce OH, not county-less)');
  ok(locs.length === 2 && locs.every((l) => /^https:\/\/jodytracks\.com\/community\/\d{5}\/$/.test(l)), 'lists only eligible jodytracks.com /community/<zip>/ URLs');
  ok(!locs.some((l) => l.includes('98397')) && Object.keys(rep.excluded).join() === '98397' && /noindex/.test(rep.excluded['98397']), 'noindex member is excluded with a reason, not listed');
  ok(/<loc>[^<]*98401\/<\/loc>\s*<lastmod>2026-10-20<\/lastmod>/.test(xml) && (xml.match(/<lastmod>/g) || []).length === 1, 'lastmod only where a real semantic date exists');
  ok(!/priority|changefreq/.test(xml), 'no priority or changefreq');
} finally { rmSync(d, { recursive: true, force: true }); }

// ---- wiring
const wf = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
ok(/focus_sitemaps/.test(wf) && /lists a noindex page/.test(wf) && /expected_zips/.test(wf), 'pages.yml gate checks the focus sitemap against sitemap.xml, robots and count');
const gen = readFileSync(join(root, 'scripts', 'gen_zip_pages.py'), 'utf8');
ok(/SITEMAP_FAMILIES = \("zip-alerts", "zip-development", "city", "project", "guide", "map"\)/.test(gen), 'national family sitemaps unchanged');
ok(/Sitemap: https:\/\/homesignal\.net\/sitemaps\/pierce-county-wa\.xml/.test(readFileSync(join(root, 'robots.txt'), 'utf8')) &&
   /Sitemap: https:\/\/homesignal\.net\/sitemap\.xml/.test(readFileSync(join(root, 'robots.txt'), 'utf8')), 'robots.txt lists the focus sitemap and keeps the national one');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
