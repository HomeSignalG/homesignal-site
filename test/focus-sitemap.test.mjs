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
  ok(locs.length === 3 && locs.every((l) => /^https:\/\/jodytracks\.com\/community\/\d{5}\/$/.test(l)), 'lists every member as a jodytracks.com /community/<zip>/ URL');
  ok(locs.some((l) => l.includes('98397')) && Object.keys(rep.excluded).length === 0, 'INDEX-ALL POLICY: a member with little content is listed, nothing is excluded');
  ok(/<loc>[^<]*98401\/<\/loc>\s*<lastmod>2026-10-20<\/lastmod>/.test(xml) && (xml.match(/<lastmod>/g) || []).length === 1, 'lastmod only where a real semantic date exists');
  ok(!/priority|changefreq/.test(xml), 'no priority or changefreq');
} finally { rmSync(d, { recursive: true, force: true }); }

// ---- statewide entry (no county): every WA page is a member, only index-eligible ones are listed
const py2 = `
import sys, json, tempfile
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import gen_zip_pages as g
pages = {'98401': dict(state='WA', county='Pierce', rule_f_count=5), '98001': dict(state='WA', county='King', rule_f_count=9),
         '98397': dict(state='WA', county='Pierce', rule_f_count=1), '43001': dict(state='OH', county='Pierce', rule_f_count=9)}
d = sys.argv[1]
print(json.dumps(g.write_focus_sitemaps(d, [dict(slug='washington-state', name='WA', state='WA', expected_zips=3)], pages, ['98401', '98001', '43001'])))
`;
const d2 = mkdtempSync(join(tmpdir(), 'focus-'));
try {
  const rep = JSON.parse(execFileSync('python3', ['-I', '-c', py2, d2], { encoding: 'utf8' }).trim().split('\n').pop())['washington-state'];
  const locs = [...readFileSync(join(d2, 'sitemaps', 'washington-state.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok(JSON.stringify(rep.members) === '["98001","98397","98401"]' && locs.length === 3 && locs.some((l) => l.includes('98397')), 'statewide entry: all WA pages are members, only eligible ones listed, other states excluded');
} finally { rmSync(d2, { recursive: true, force: true }); }
const wa = cfg.find((a) => a.slug === 'washington-state');
ok(wa && wa.state === 'WA' && !wa.county && wa.expected_zips === 362, 'config names Washington State with 362 expected ZIPs');

// ---- area hub: one /guides/<slug>/ page per focus area, eligible ZIPs only, none when nothing is eligible
const py3 = `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(join(root, 'scripts'))})
import gen_zip_pages as g
pages = {z: dict(state='WA', county='Pierce', name='Town ' + z, rule_f_count=5) for z in ('98401', '98402', '98397')}
pages['98001'] = dict(state='WA', county='King', name='Auburn 98001', rule_f_count=9)
areas = [dict(slug='pierce-county-wa', name='Pierce County, WA', state='WA', county='Pierce', expected_zips=3),
         dict(slug='ohio-none', name='Ohio', state='OH', expected_zips=1)]
w = g.build_guides({}, {}, pages, sys.argv[1], '2026-10-23', None, areas=areas, indexable=['98401', '98402', '98001'])
print(json.dumps(w))
`;
const d3 = mkdtempSync(join(tmpdir(), 'focus-'));
try {
  const w = JSON.parse(execFileSync('python3', ['-I', '-c', py3, d3], { encoding: 'utf8' }).trim().split('\n').pop());
  ok(w.includes('/guides/pierce-county-wa/') && !w.some((x) => x.includes('ohio-none')), 'hub emitted for an area with eligible ZIPs, none for an area without');
  const h = readFileSync(join(d3, 'guides', 'pierce-county-wa', 'index.html'), 'utf8');
  const links = [...h.matchAll(/href="\/community\/(\d{5})\/"/g)].map((m) => m[1]);
  ok(links.includes('98401') && links.includes('98402') && links.includes('98397') && !links.includes('98001'), 'hub links every member of its own area');
} finally { rmSync(d3, { recursive: true, force: true }); }

// ---- wiring
const wf = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
ok(/focus_sitemaps/.test(wf) && /lists a noindex page/.test(wf) && /expected_zips/.test(wf), 'pages.yml gate checks the focus sitemap against sitemap.xml, robots and count');
const gen = readFileSync(join(root, 'scripts', 'gen_zip_pages.py'), 'utf8');
ok(/SITEMAP_FAMILIES = \("zip", "zip-alerts", "zip-development", "city", "project", "guide", "map", "project-list",\s+"development"\)/.test(gen), 'the national family sitemaps are the declared set (index-all policy adds zip and project-list; development dossiers 2026-10-29)');
ok(/Sitemap: https:\/\/homesignal\.net\/sitemaps\/pierce-county-wa\.xml/.test(readFileSync(join(root, 'robots.txt'), 'utf8')) &&
   /Sitemap: https:\/\/homesignal\.net\/sitemap\.xml/.test(readFileSync(join(root, 'robots.txt'), 'utf8')), 'robots.txt lists the focus sitemap and keeps the national one');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
