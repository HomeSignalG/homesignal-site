// The sitemap limit (2026-11-09): every pages build on main failed with
// "sitemap.xml lists 50681 URLs, over the 50000 limit" (24,772 project pages + 12,742 ZIP pages +
// 12,742 map pages + the rest). Two rules, both in scripts/gen_zip_pages.py:
//   1. project pages are a FAMILY_ONLY family: listed in sitemaps/project.xml (declared in robots.txt),
//      never in sitemap.xml. So sitemap.xml no longer grows with the project count.
//   2. a family past one file's limits (URLs or bytes) is split into sitemaps/<name>-N.xml under a
//      sitemap index at sitemaps/<name>.xml, so a family can grow past 50,000 without failing the build.
// This test drives the shipped functions over inputs larger than one file allows (with the limits made
// small, the same code path) and checks no URL is lost, duplicated or listed in the wrong file.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('PASS — ' + msg); } else { fail++; console.log('FAIL — ' + msg); } }

function py(code) {
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8', cwd: join(ROOT, 'scripts') });
  return r;
}

const out = mkdtempSync(join(tmpdir(), 'smsplit-'));

// ---- 1. a family past the URL limit is split, every URL listed once, in order ----------------
{
  const r = py(`
import json, gen_zip_pages as g
fams = {"project": [f"/project/src/k{i:05d}/" for i in range(2503)], "city": ["/city/wa/a/"]}
lm = {"/project/src/k00007/": "2026-09-20"}
counts, files = g.write_family_sitemaps(${JSON.stringify(out)}, fams, lastmod=lm, max_urls=1000)
locs = g.sitemap_locs(${JSON.stringify(out)}, "sitemaps/project.xml")
print(json.dumps({"counts": counts, "files": files, "locs": locs}))
`);
  ok(r.status === 0, `write_family_sitemaps runs (${(r.stderr || '').trim().slice(-200)})`);
  const j = JSON.parse(r.stdout);
  const want = Array.from({ length: 2503 }, (_, i) => `https://jodytracks.com/project/src/k${String(i).padStart(5, '0')}/`);
  ok(j.files.project === 3 && j.counts.project === 2503, '2,503 project URLs at a 1,000 limit -> 3 files');
  ok(j.files.city === 1, 'a family within the limit stays one file');
  ok(JSON.stringify(j.locs) === JSON.stringify(want), 'reading the index gives every URL exactly once, in order');
  const idx = readFileSync(join(out, 'sitemaps', 'project.xml'), 'utf8');
  ok(idx.includes('<sitemapindex') && !idx.includes('<urlset'), 'sitemaps/project.xml is a sitemap index');
  ok((idx.match(/<loc>https:\/\/jodytracks\.com\/sitemaps\/project-\d\.xml<\/loc>/g) || []).length === 3,
     'the index names project-1.xml .. project-3.xml on the site host');
  const sizes = [1, 2, 3].map((i) => (readFileSync(join(out, 'sitemaps', `project-${i}.xml`), 'utf8').match(/<url>/g) || []).length);
  ok(JSON.stringify(sizes) === '[1000,1000,503]', `chunk sizes ${sizes}`);
  ok(readFileSync(join(out, 'sitemaps', 'project-1.xml'), 'utf8').includes(
       '<loc>https://jodytracks.com/project/src/k00007/</loc>\n    <lastmod>2026-09-20</lastmod>'),
     'a chunk keeps the page lastmod');
  ok(readFileSync(join(out, 'sitemaps', 'city.xml'), 'utf8').includes('<urlset'), 'city.xml stays a urlset');

  // shrinking back to one file removes the stale chunks
  const r2 = py(`
import gen_zip_pages as g
g.write_family_sitemaps(${JSON.stringify(out)}, {"project": ["/project/src/a/"]}, max_urls=1000)
`);
  const left = readdirSync(join(out, 'sitemaps')).filter((f) => /^project-\d+\.xml$/.test(f));
  ok(r2.status === 0 && left.length === 0 && readFileSync(join(out, 'sitemaps', 'project.xml'), 'utf8').includes('<urlset'),
     'a family that fits again is one urlset and no stale chunk survives');
}

// ---- 2. the byte limit splits too ------------------------------------------------------
{
  const o2 = mkdtempSync(join(tmpdir(), 'smsplit-b-'));
  const r = py(`
import json, os, gen_zip_pages as g
fams = {"project": [f"/project/src/k{i:05d}/" for i in range(300)]}
counts, files = g.write_family_sitemaps(${JSON.stringify(o2)}, fams, max_bytes=20000)
sizes = [os.path.getsize(os.path.join(${JSON.stringify(o2)}, "sitemaps", f"project-{i}.xml")) for i in range(1, files["project"] + 1)]
print(json.dumps({"files": files["project"], "sizes": sizes, "n": len(g.sitemap_locs(${JSON.stringify(o2)}, "sitemaps/project.xml"))}))
`);
  const j = JSON.parse(r.stdout || '{}');
  ok(r.status === 0 && j.files > 1 && j.sizes.every((s) => s <= 20000) && j.n === 300,
     `a 20,000-byte limit splits 300 URLs into ${j.files} files, each within it, none lost`);
}

// ---- 3. a duplicate URL is refused, not silently listed twice ----------------------------
{
  const r = py(`
import gen_zip_pages as g
g.write_family_sitemaps(${JSON.stringify(out)}, {"city": ["/city/wa/a/", "/city/wa/a/"]})
`);
  ok(r.status !== 0 && /twice/.test(r.stderr + r.stdout), 'a family listing one URL twice fails the build');
}

// ---- 4. sitemap.xml does not grow with project pages -------------------------------------
{
  const o3 = mkdtempSync(join(tmpdir(), 'smsplit-m-'));
  writeFileSync(join(o3, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '  <url>\n    <loc>https://homesignal.net/</loc>\n  </url>\n</urlset>\n');
  const r = py(`
import json, gen_zip_pages as g
zips = [f"{i:05d}" for i in range(10000, 22745)]
proj = [f"/project/src/k{i:05d}/" for i in range(60000)]
res = g.reconcile_sitemap(${JSON.stringify(o3)}, zips, project_paths=proj, map_paths=[f"/map/{z}/" for z in zips])
txt = open(${JSON.stringify(o3)} + "/sitemap.xml").read()
print(json.dumps({"res": res, "n": txt.count("<loc>"), "proj": txt.count("/project/")}))
`);
  ok(r.status === 0, `reconcile_sitemap with 60,000 project pages succeeds (${(r.stderr || '').trim().slice(-160)})`);
  const j = JSON.parse(r.stdout || '{}');
  ok(j.proj === 0 && j.n === 1 + 12745 * 2, `sitemap.xml lists ${j.n} URLs and no project page`);
  ok(j.res && j.res.projects === 0, 'the master reports 0 project URLs');
}

// ---- 5. the master still fails loudly at its own limit -----------------------------------
{
  const o4 = mkdtempSync(join(tmpdir(), 'smsplit-x-'));
  writeFileSync(join(o4, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
  const r = py(`
import gen_zip_pages as g
g.reconcile_sitemap(${JSON.stringify(o4)}, [], city_paths=[f"/city/wa/c{i}/" for i in range(50001)])
`);
  ok(r.status !== 0 && /over the 50000 limit/.test(r.stderr + r.stdout), 'a master past 50,000 URLs still fails the build');
}

// ---- 6. the index-all audit follows a sitemap index ---------------------------------------
{
  const r = py(`
import json, sys
sys.argv = ["x"]
import audit_index_all as a
print(json.dumps(sorted(a.page_locs(${JSON.stringify(out)}, "sitemaps/project.xml"))))
`);
  // section 1 rewrote project.xml to one URL; rebuild a split one for the audit check
  const o5 = mkdtempSync(join(tmpdir(), 'smsplit-a-'));
  const r5 = py(`
import json, gen_zip_pages as g, audit_index_all as a
g.write_family_sitemaps(${JSON.stringify(o5)}, {"project": [f"/project/src/k{i}/" for i in range(25)]}, max_urls=10)
print(json.dumps(sorted(a.page_locs(${JSON.stringify(o5)}, "sitemaps/project.xml"))))
`);
  const got = JSON.parse(r5.stdout || '[]');
  ok(r.status === 0 && r5.status === 0 && got.length === 25 && got.every((p) => /^\/project\/src\/k\d+\/$/.test(p)),
     'audit_index_all reads every page in a split family and no sitemap file as a page');
}

// ---- 7. the deploy gate reads the project family, not sitemap.xml ------------------------
{
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  ok(wf.includes("sitemap_locs('_site', 'sitemaps/project.xml')") &&
     wf.includes("assert not re.search(r'<loc>[^<]*/project/', sm)"),
     'pages.yml reconciles project pages against sitemaps/project.xml and refuses them in sitemap.xml');
  ok(readFileSync(join(ROOT, 'robots.txt'), 'utf8').includes('Sitemap: https://homesignal.net/sitemaps/project.xml'),
     'robots.txt declares the project sitemap');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
