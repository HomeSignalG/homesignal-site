// ZIP COVERAGE MODEL (founder, 2026-10-03). The 47 ZIPs a third-party dataset flagged
// "decommissioned" are NOT proven inactive and are no longer withheld. They keep their pages;
// a ZIP with no Census-drawn area gets a coverage panel instead of a map and ZIP-wide records.
//
// Offline. Drives the SHIPPED build_zip_coverage.py, gen_zip_pages.py and gen_sitemap.py, and
// reads the SHIPPED shell.js function text. The rendered behaviour is pinned by
// test/zip-coverage.browser.test.mjs.
//
//   §1 the model is COMPUTED from the Fix 4 record (never typed) and says only what is known
//   §2 the model's own rules: a third-party flag can never activate or retire a ZIP
//   §3 the approved copy, pinned WHOLE
//   §4 ONE rule for the page mode, in shell.js, gen_zip_pages.py and the live verifier
//   §5 the build: every ZIP keeps a document; no map, no ZIP-wide claim; usual SEO rule
//   §6 a USPS-verified retired ZIP (test-only fixture) gets no document and no sitemap entry
//   §7 nothing left of the withhold mechanism; nothing visitor-facing says retired/decommissioned
//   §8 the developer-only report (reads the INTERNAL record)
//   §9 the PUBLIC model carries page behavior only: no provenance, no notes, no vendor detail
//   §10 84684 and 84685 (existence unverified): no page, one mechanism with the 47
//
// TWO FILES (founder, 2026-10-03): docs/maps-coverage/fix4/zip-coverage-internal.json is the full,
// auditable record and is never deployed; lib/zip-coverage.json is what browsers receive.
//
// Run: node test/zip-coverage.test.mjs
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!c) { fails++; if (detail !== undefined) console.log('           detail: ' + JSON.stringify(detail).slice(0, 400)); }
};
const read = (p) => readFileSync(join(root, p), 'utf8');
const py = (args, opts = {}) => spawnSync('python3', args, { cwd: root, encoding: 'utf8', ...opts });

const INTERNAL = 'docs/maps-coverage/fix4/zip-coverage-internal.json';
const doc = JSON.parse(read('lib/zip-coverage.json'));          // PUBLIC: what the browser receives
const internal = JSON.parse(read(INTERNAL));                    // INTERNAL: full provenance
const PUB = doc.zips;
const Z = internal.zips;
const ALL = Object.keys(Z).sort();                                   // every modelled ZIP
const UNV = ALL.filter((z) => Z[z].page_mode === 'unverified');       // no page at all (84684, 84685)
const ZIPS = ALL.filter((z) => !UNV.includes(z));                    // the 47 coverage-limited pages

// ── §1 the model ────────────────────────────────────────────────────────────────────────
console.log('§1 the model is computed from the classification record');
const csvRaw = readFileSync(join(root, internal.source));
ok(createHash('md5').update(csvRaw).digest('hex') === internal.source_md5, '1a the source record is the one the model was computed from');
const chk = py(['scripts/build_zip_coverage.py', '--check']);
ok(chk.status === 0, '1b the internal record and lib/zip-coverage.json both equal what the classification record derives (no hand edit)', chk.stdout + chk.stderr);
// An independent re-derivation of the 47 and their modes, in this file, from the CSV text.
const lines = csvRaw.toString('utf8').trim().split('\n');
const head = lines[0].split(',');
const col = (n) => head.indexOf(n);
const rows = lines.slice(1).map((l) => l.split(',')).filter((r) => r[col('class')] === 'DECOMMISSIONED_IN_DATASET');
ok(rows.length === 47 && ZIPS.length === 47, '1c 47 ZIPs, the whole third-party-flagged class', { rows: rows.length, model: ZIPS.length });
ok(JSON.stringify(rows.map((r) => r[col('zip')]).sort()) === JSON.stringify(ZIPS), '1d the same 47 ZIPs, none added or dropped');
const want = (r) => (r[col('zipcodes_type')] === 'PO BOX' || r[col('zipcodes_type')] === 'UNIQUE') ? 'specialized_zip' : 'verification_pending';
ok(rows.every((r) => Z[r[col('zip')]].page_mode === want(r)), '1e page_mode follows the dataset type: PO BOX / UNIQUE -> specialized_zip, else verification_pending');
const tally = (m) => ZIPS.filter((z) => Z[z].page_mode === m).length;
ok(tally('specialized_zip') === 28 && tally('verification_pending') === 19 && tally('standard') === 0 && tally('retired') === 0,
  '1f 28 specialized_zip, 19 verification_pending, 0 standard, 0 retired');
const types = (t) => ZIPS.filter((z) => Z[z].zip_type === t).length;
ok(types('standard') === 19 && types('unique') === 20 && types('po_box') === 8, '1g types: 19 street ZIPs, 20 single-organization, 8 PO box');
ok(ZIPS.every((z) => Z[z].postal_status === 'unverified' && Z[z].postal_status_source === 'third_party_flag'
  && Z[z].postal_status_verified_at === null && Z[z].map_coverage === 'address_only'),
  '1h every one is unverified, from a third-party flag, never verified, address_only');
ok(!ZIPS.some((z) => ['active', 'retired'].includes(Z[z].postal_status) || Z[z].page_mode === 'retired'),
  '1i NO ZIP is marked active or retired: there is no USPS evidence in the repository');
ok(ZIPS.every((z) => /third_party|NOT confirmed with USPS/i.test(Z[z].verification_notes) && Z[z].verification_notes.includes(internal.source)),
  '1j provenance kept: every record says it is unconfirmed and names the record it came from');
ok(ZIPS.filter((z) => Z[z].zcta_2010_status === 'present').join() === '98205,98929' && ZIPS.every((z) => Z[z].zcta_2020_status === 'absent'),
  '1k only 98205 and 98929 had a 2010 Census area; none has one in 2020');
// the named fixtures, read from the file, never assumed
const T = (z) => `${Z[z].page_mode}/${Z[z].zip_type}`;
ok(T('75245') === 'verification_pending/standard', '1l 75245 (Dallas) is a regular street ZIP in the record, so it is verification_pending, not specialized', T('75245'));
ok(T('78769') === 'specialized_zip/po_box' && T('48391') === 'specialized_zip/po_box', '1m 78769 and 48391 are PO box ZIPs -> specialized_zip');
ok(T('75037') === 'specialized_zip/unique', '1n 75037 is a single-organization ZIP -> specialized_zip');
ok(T('98205') === 'verification_pending/standard' && Z['98205'].zcta_2010_status === 'present', '1o 98205 had a 2010 area, lost it by 2020, and is verification_pending');

// ── §2 the model's own rules ────────────────────────────────────────────────────────────
console.log('§2 a third-party flag can never activate or retire a ZIP');
const validate = (entryPatch) => {   // INTERNAL validator
  const e = { ...Z['75245'], ...entryPatch };
  const code = 'import sys,json; sys.path.insert(0,"scripts"); import build_zip_coverage as z\n'
    + 'e=json.loads(sys.argv[1])\ntry:\n z.validate({"zips":{e["zip_code"]:e}}); print("VALID")\nexcept ValueError as x: print("REFUSED:",x)';
  return py(['-c', code, JSON.stringify(e)]).stdout.trim();
};
ok(validate({}) === 'VALID', '2a the real record validates');
ok(/REFUSED/.test(validate({ postal_status: 'retired', page_mode: 'retired' })), '2b retired on a third-party flag is refused');
ok(/REFUSED/.test(validate({ postal_status: 'active' })), '2c active on a third-party flag is refused');
ok(/REFUSED/.test(validate({ postal_status: 'retired', page_mode: 'retired', postal_status_source: 'manual_review', postal_status_verified_at: '2026-10-03' })),
  '2d retired needs usps_verified, not manual review');
ok(/REFUSED/.test(validate({ postal_status: 'retired', page_mode: 'retired', postal_status_source: 'usps_verified' })), '2e retired needs a verification date');
ok(validate({ postal_status: 'retired', page_mode: 'retired', postal_status_source: 'usps_verified', postal_status_verified_at: '2026-10-03' }) === 'VALID',
  '2f a USPS-verified, dated retirement is the one accepted shape');
ok(/REFUSED/.test(validate({ page_mode: 'sideways' })) && /REFUSED/.test(validate({ map_coverage: 'polygon' })), '2g values outside the allowed vocabularies are refused');
ok(/REFUSED/.test(validate({ page_mode: 'standard', map_coverage: 'address_only' })), '2h a standard page needs map_coverage zcta');

// ── §3 the approved copy, pinned whole ──────────────────────────────────────────────────
console.log('§3 the approved copy');
const S = doc.copy.specialized_zip, V = doc.copy.verification_pending;
ok(S.title === 'HomeSignal coverage for ZIP {zip}', '3a specialized title is the pattern "HomeSignal coverage for ZIP [ZIP]"');
ok(!/active in HomeSignal|active/i.test(S.title), '3a2 the specialized title says nothing about the ZIP being active');
ok(JSON.stringify(S.body) === JSON.stringify([
  'This ZIP code does not have a Census-defined geographic area for mapping. Some ZIP codes are used for PO Boxes, a single organization, a government office, campus, or another specialized mail-delivery purpose.',
  'HomeSignal cannot show a ZIP-wide map or ZIP-wide development records for this location.']), '3b specialized body, both paragraphs whole');
ok(S.primary_cta === 'Search an address near this ZIP' && S.secondary_cta === 'Search nearby ZIPs', '3c specialized CTAs');
ok(V.title === 'ZIP coverage is being verified', '3d verification-pending title');
ok(JSON.stringify(V.body) === JSON.stringify([
  'This ZIP code does not currently have a Census-defined geographic area for mapping. HomeSignal is verifying its current postal and geographic coverage.',
  'HomeSignal cannot yet show a ZIP-wide map or ZIP-wide development records for this location. Enter a street address to see projects near a specific location.']), '3e verification-pending body, both paragraphs whole');
ok(V.primary_cta === 'Search an address' && V.secondary_cta === 'Search nearby ZIPs', '3f verification-pending CTAs');
ok(S.page_title === '{zip} ZIP Code Information | HomeSignal' && V.page_title === '{zip} ZIP Code Coverage | HomeSignal', '3g title patterns');
ok(S.meta_description === 'Information for ZIP code {zip}. This is a specialized mailing ZIP without a Census-defined map area. Search an address to see development activity nearby.'
  && V.meta_description === 'Coverage information for ZIP code {zip}. This ZIP does not currently have a Census-defined map area. Search an address to see development activity nearby.',
  '3h meta descriptions');

// ── §4 one rule for the page mode ───────────────────────────────────────────────────────
console.log('§4 the page mode is decided ONCE, in the build; the two browser-side readers only read it');
const shell = read('shell.js');
const fnSrc = (shell.match(/HS\.ZIP_PAGE_MODES = [\s\S]*?HS\.zipCoverageMode = function \(entry\) \{[\s\S]*?\n  \};/) || [''])[0];
ok(fnSrc.length > 0, '4a shell.js defines HS.zipCoverageMode');
const HS = {}; new Function('HS', fnSrc)(HS);
const live = await import('../scripts/lib/zip-coverage-live.mjs');
const cases = [...Object.values(PUB), undefined,
  { page_mode: 'standard', map_coverage: 'zcta' },
  { page_mode: 'retired' }, { page_mode: 'unverified' }, { page_mode: 'specialized_zip', map_coverage: 'address_only' },
  { page_mode: 'mystery', map_coverage: 'none' }, {}];
const jsModes = cases.map((c) => HS.zipCoverageMode(c));
const liveModes = cases.map((c) => live.coverageMode(c));
ok(JSON.stringify(jsModes) === JSON.stringify(liveModes), '4b shell.js and the live verifier read every entry, and every edge case, the same way', { js: jsModes.slice(-6), live: liveModes.slice(-6) });
ok(HS.zipCoverageMode(undefined) === 'standard' && HS.zipCoverageMode({ page_mode: 'standard', map_coverage: 'zcta' }) === 'standard', '4c no entry, or a ZCTA standard entry, is a standard page');
ok(HS.zipCoverageMode({ page_mode: 'mystery' }) === 'verification_pending', '4d a value nobody built fails SAFE to verification_pending');
ok(HS.zipCoverageMode({ page_mode: 'retired' }) === 'retired' && !ZIPS.some((z) => HS.zipCoverageMode(PUB[z]) === 'retired'),
  '4e the browser honours page_mode retired; the BUILD alone decides it (a third-party flag cannot reach it: 2b-2d), and none of the 47 is retired');
ok(!/def coverage_mode\b/.test(read('scripts/gen_zip_pages.py')) && /modes = \{z: e\["page_mode"\]/.test(read('scripts/gen_zip_pages.py')),
  '4f gen_zip_pages.py has no decision of its own: it reads the validated page_mode');
{
  const chk = (entry) => py(['-c', 'import sys,json; sys.path.insert(0,"scripts"); import build_zip_coverage as z\n'
    + 'd=json.load(open(sys.argv[1])); d["zips"]["78769"].update(json.loads(sys.argv[2]))\n'
    + 'try:\n z.validate_public(d); print("VALID")\nexcept ValueError as x: print("REFUSED:",x)', join(root, 'lib/zip-coverage.json'), JSON.stringify(entry)]).stdout.trim();
  ok(/^REFUSED/.test(chk({ page_mode: 'standard', map_coverage: 'none' })), '4g the build refuses a standard page without a Census area (the rule the readers used to repeat)');
  ok(/^REFUSED/.test(chk({ page_mode: 'mystery' })), '4h the build refuses a page_mode outside the vocabulary');
}

// ── §5 the build ────────────────────────────────────────────────────────────────────────
console.log('§5 the build writes a document for every one of them');
const out = mkdtempSync(join(tmpdir(), 'zcov-'));
const fx = JSON.parse(read('test/fixtures/zip-pages.json'));
const MOD = ['78769', '75245', '48391', '98205'];            // specialized, pending, specialized, pending
const real = ['01001', '01002'];
for (const z of MOD) {
  fx.zips.push(z);
  fx.meta.push({ zip: z, name: `${Z[z].city} (${z})`, county: Z[z].county, state: Z[z].state, data_quality: 'pass', indexable: true });
}
// Rule F evidence for 78769 only: copy 01001's non-weather changes onto it.
const src = fx.changes.filter((c) => c.zip === '01001' && c.category !== 'Local News');
const ln = fx.changes.filter((c) => c.zip === '01001' && c.category === 'Local News');
for (const c of [...src, ...ln]) fx.changes.push({ ...c, zip: '78769', title: c.title + ' (78769)', source_ref: c.source_ref + '?78769' });
fx.zips = [...new Set(fx.zips)].sort();
writeFileSync(join(out, 'fixture.json'), JSON.stringify(fx));
writeFileSync(join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
const site = join(out, 'site');
const gen = (extra = []) => py(['scripts/gen_zip_pages.py', '--fixture', join(out, 'fixture.json'), '--out', site, '--now', '2026-09-04T00:00:00',
  '--dev-plane', 'test/fixtures/development_seo_plane.json', ...extra]);
const g = gen();
ok(g.status === 0, '5a the build succeeds with these ZIPs in the registry', (g.stderr || g.stdout).slice(-300));
const man = JSON.parse(readFileSync(join(site, 'zip-pages-manifest.json'), 'utf8'));
ok(MOD.every((z) => existsSync(join(site, 'community', z, 'index.html'))), '5b every modelled ZIP has a document at its normal /community/<zip>/ URL');
ok(man.documents === fx.zips.length && man.canonical_registry === fx.zips.length && man.retired_zips.length === 0,
  '5c documents = registry; nothing retired', { documents: man.documents, registry: man.canonical_registry });
ok(JSON.stringify(man.coverage_zips) === JSON.stringify({ 48391: 'specialized_zip', 75245: 'verification_pending', 78769: 'specialized_zip', 98205: 'verification_pending' }),
  '5d the manifest records which mode each got', man.coverage_zips);
const page = (z) => readFileSync(join(site, 'community', z, 'index.html'), 'utf8');
const sm = readFileSync(join(site, 'sitemap.xml'), 'utf8');
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
for (const z of MOD) {
  const h = page(z), mode = Z[z].page_mode, c = doc.copy[mode];
  const title = c.page_title.replace('{zip}', z), desc = c.meta_description.replace('{zip}', z);
  ok(h.includes(`<title>${title}</title>`), `5e ${z} title: ${title}`);
  ok(h.includes(`<meta name="description" content="${desc}">`), `5f ${z} meta description is the approved one`);
  ok(h.includes(`<link rel="canonical" href="https://homesignal.net/community/${z}/">`), `5g ${z} keeps its own canonical URL`);
  ok(h.includes(`data-zip-coverage="${mode}"`) && text(h).includes(c.title.replace('{zip}', z)), `5h ${z} shows the ${mode} panel`);
  if (mode === 'specialized_zip') ok(new RegExp(`<h2>HomeSignal coverage for ZIP ${z}</h2>`).test(h) && !/active in HomeSignal/i.test(h), `5h2 ${z} heading is "HomeSignal coverage for ZIP ${z}", never "active in HomeSignal"`);
  ok(!/USPS|Postal Service|confirmed|verified active|is active|active ZIP/i.test(text(/<section class="zcov"[\s\S]*?<\/section>/.exec(h)[0]).replace(/is being verified|verifying its current postal/gi, '')),
    `5h3 ${z} panel makes no claim that the Postal Service confirmed or activated anything`);
  ok(c.body.every((p) => text(h).includes(p.replace('{zip}', z))), `5i ${z} shows the whole approved body`);
  ok(h.includes('id="zcovAddress"') && h.includes(c.primary_cta) && h.includes('id="zcovNearby"') && h.includes(c.secondary_cta) && h.includes('id="zip-nearby"'),
    `5j ${z} has both CTAs and the nearby-ZIPs anchor they point to`);
  ok(!/homesignalmap\.html\?zip=|zipMapFrame|<iframe|application\/ld\+json|\bschema\.org/i.test(h), `5k ${z} links to no ZIP map, embeds none, carries no map-based structured data`);
  ok(!/\b\d+\s+(development )?(projects?|records?)\b|0 projects|no projects|No permit or planning/i.test(text(h)),
    `5l ${z} states no ZIP-wide project/record count and no empty-search sentence`, text(h).match(/.{30}(projects?|records?).{30}/i));
  const robots = /name="robots" content="([^"]+)"/.exec(h)[1];
  ok((robots === 'index, follow') === man.indexable_zips.includes(z), `5m ${z} robots is the usual Rule F decision, not "noindex because no ZCTA"`, robots);
  ok(!/decommission|retired|inactive|invalid|undeliverable|no longer in use/i.test(text(h) + title + desc), `5n ${z} never calls the ZIP retired, inactive, invalid or decommissioned`);
}
ok(/name="robots" content="index, follow"/.test(page('78769')) && sm.includes('/community/78769/'),
  '5o 78769 has Rule F evidence: it is indexable and is in the sitemap by the usual rule');
ok(man.indexable_zips.includes('78769') && !man.indexable_zips.includes('48391'), '5p the others without evidence stay noindex exactly as any ZIP would', man.indexable_zips);
// Control: a standard ZIP is untouched.
{
  const h = page('01001');
  ok(!h.includes('zcov') && h.includes('/homesignalmap.html?zip=01001') && !h.includes('zip-nearby'), '5q control: a standard ZIP page has no panel and still links its map');
  ok(/<title>Agawam, MA/.test(h) || /<title>[^<]*01001|<title>[^<]*Agawam/.test(h), '5r control: its title is the usual one');
}
// the SSR panel and the shell's panel say the same words
{
  const m = /HS\.zipCoveragePanelHTML = function \(hit\) \{[\s\S]*?\n  \};/.exec(shell);
  ok(!!m, '5s shell.js defines HS.zipCoveragePanelHTML');
  const sandbox = { zipCoveragePanelHTML: null };
  const escHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  new Function('HS', 'escHtml', m[0])(sandbox, escHtml);
  for (const z of MOD) {
    const hit = { zip: z, entry: PUB[z], mode: PUB[z].page_mode, copy: doc.copy[PUB[z].page_mode] };
    const js = text(sandbox.zipCoveragePanelHTML(hit));
    const ssr = text(/<section class="zcov"[\s\S]*?<\/section>/.exec(page(z))[0]);
    ok(js === ssr, `5t ${z}: the generated document and the shell panel say exactly the same thing`, { js, ssr });
  }
}
// determinism: the same input builds the same bytes
{
  const before = MOD.map((z) => createHash('md5').update(page(z)).digest('hex')).join();
  rmSync(site, { recursive: true, force: true });
  gen();
  ok(before === MOD.map((z) => createHash('md5').update(page(z)).digest('hex')).join(), '5u the build is byte-identical on a second run');
}

// ── §6 a USPS-verified retired ZIP (fixture only) ──────────────────────────────────────
console.log('§6 a confirmed-retired ZIP, using a test-only record; none of the 47 is retired');
{
  // Build the PUBLIC fixture the only legitimate way: patch the INTERNAL record, validate it, derive the public file.
  const derive = (patch) => {
    const code = 'import sys,json; sys.path.insert(0,"scripts"); import build_zip_coverage as z\n'
      + 'd=json.load(open(sys.argv[1])); d["zips"]["75245"].update(json.loads(sys.argv[2]))\n'
      + 'try:\n z.validate(d); print(json.dumps(z.public_from_internal(d)))\nexcept ValueError as x: print("REFUSED:",x)';
    return py(['-c', code, join(root, INTERNAL), JSON.stringify(patch)]).stdout.trim();
  };
  const fmText = derive({ postal_status: 'retired', postal_status_source: 'usps_verified', postal_status_verified_at: '2026-10-03', page_mode: 'retired' });
  ok(!/^REFUSED/.test(fmText), '6a the internal record accepts a USPS-verified, dated retirement and derives a public model from it', fmText.slice(0, 200));
  const fm = JSON.parse(fmText);
  ok(JSON.stringify(Object.keys(fm.zips['75245'])) === JSON.stringify(['zip_code', 'zip_type', 'map_coverage', 'page_mode']) && fm.zips['75245'].page_mode === 'retired',
    '6a2 the derived public entry for it is the four public fields, page_mode retired, with no trace of the evidence');
  const fmPath = join(out, 'fixture-model.json');
  writeFileSync(fmPath, JSON.stringify(fm));
  rmSync(site, { recursive: true, force: true });
  const r = gen(['--zip-coverage', fmPath]);
  ok(r.status === 0, '6b the build accepts it', (r.stderr || r.stdout).slice(-300));
  const m2 = JSON.parse(readFileSync(join(site, 'zip-pages-manifest.json'), 'utf8'));
  ok(!existsSync(join(site, 'community', '75245')) && JSON.stringify(m2.retired_zips) === '["75245"]', '6c it gets no document and the manifest names it');
  ok(!readFileSync(join(site, 'sitemap.xml'), 'utf8').includes('75245'), '6d it is not in the sitemap');
  ok(m2.documents + 1 === m2.canonical_registry, '6e documents + retired = registry');
  ok(existsSync(join(site, 'community', '78769', 'index.html')), '6f the other modelled ZIPs are untouched');
  ok(/^REFUSED/.test(derive({ postal_status: 'retired', postal_status_source: 'third_party_flag', postal_status_verified_at: '2026-10-03', page_mode: 'retired' })),
    '6g a retirement resting on a third-party flag cannot produce a public model at all');
  ok(!ZIPS.some((z) => Z[z].page_mode === 'retired' || PUB[z].page_mode === 'retired'), '6h none of the real 47 is retired');
}

// ── §7 nothing left of the withhold ─────────────────────────────────────────────────────
console.log('§7 the withhold mechanism is gone, and no visitor-facing text says retired/decommissioned');
ok(!existsSync(join(root, 'lib', 'withheld-zip-pages.json')), '7a lib/withheld-zip-pages.json is deleted');
const sources = ['shell.js', 'lib/community-page.js', 'scripts/gen_zip_pages.py', 'scripts/gen_sitemap.py', 'scripts/verify-communities.mjs', 'scripts/verify-development.mjs',
  'scripts/verify-coverage-state.mjs', '.github/workflows/pages.yml'];
ok(sources.every((f) => !/withheld-zip-pages|hs-withheld|withheldZipFor|renderWithheldZip|load_withheld|withheld_zips/.test(read(f))), '7b no reader of the old list or its notice is left');
ok(!existsSync(join(root, 'scripts/lib/withheld-zips-live.mjs')), '7c the old live-verifier helper is replaced');
const panelRegion = (shell.match(/HS\.zipCoveragePanelHTML = function[\s\S]*?\n  \};/) || [''])[0] + (shell.match(/function renderZipCoverage[\s\S]*?\n  \}/) || [''])[0];
ok(panelRegion.length > 200 && !/decommission|retired|inactive|undeliverable/i.test(panelRegion.replace(/'retired'/g, '')), '7d the shell panel code carries no such word (the mode name \'retired\' is code, not text)');
ok(!/decommission|inactive|undeliverable|invalid/i.test(JSON.stringify(doc.copy)), '7e the approved copy carries no such word');
ok(/usps_verified/.test(read('scripts/build_zip_coverage.py')) && /retired requires postal_status_source=usps_verified/.test(read('scripts/build_zip_coverage.py')),
  '7f "retired" can only be reached through a USPS-verified source (enforced where the public model is derived)');
// the sitemap generator reads the same model
{
  const r = py(['-c', 'import sys; sys.path.insert(0,"scripts"); import gen_sitemap as g; r,l=g.zip_coverage(); print(len(r), len(l))']);
  ok(r.stdout.trim() === '2 49', '7g gen_sitemap.py: 2 no-page ZIPs (84684, 84685), 49 coverage-limited (their map development URL is not advertised)', r.stdout + r.stderr);
}
// shipped in the artifact, and workflows watch it
{
  const staged = execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, "scripts"); import stage_site; print("\\n".join(stage_site.staged_paths(".")))'],
    { cwd: root, encoding: 'utf8' }).split('\n');
  ok(staged.includes('lib/zip-coverage.json'), '7h the Pages artifact ships the public model (shell.js fetches it)');
  ok(!staged.some((p) => p === INTERNAL || p.startsWith('docs/')), '7h2 the internal record is NOT in the Pages artifact');
  ok(/lib\/zip-coverage\.json/.test(read('.github/workflows/pages.yml')) && /build_zip_coverage\.py --check/.test(read('.github/workflows/pages.yml')),
    '7i the Pages workflow watches the model and re-derives it');
}
// the homepage search the primary CTA points to
{
  const idx = read('index.html');
  ok(/id="homeNearHint"/.test(idx) && /get\('near'\)/.test(idx) && /\$\('homeQuery'\)\.focus\(\)/.test(idx), '7j index.html: ?near=<zip> puts the cursor in the address box with a hint');
  ok(!/near/.test((idx.match(/function searchAddress[\s\S]*?\n  \}/) || [''])[0]), '7k the address search itself is unchanged by it (still geocodes the typed address)');
}

// ── §8 the internal diagnostic ──────────────────────────────────────────────────────────
console.log('§8 the developer-only report');
{
  const r = spawnSync('node', ['scripts/zip-coverage-report.mjs', '--json', '98205', '75245', '01001'], { cwd: root, encoding: 'utf8' });
  const j = r.status === 0 ? JSON.parse(r.stdout) : [];
  ok(j.length === 3 && j[0].postal_status === 'unverified' && j[0].postal_status_source === 'third_party_flag' && j[0].zcta_2010 === 'present' && j[0].zcta_2020 === 'absent'
    && j[0].last_verified === 'never' && /lost its area/.test(j[0].reason), '8a it reports status, source, type, ZCTA years, map coverage, mode, last verification and the reason');
  ok(j[2].page_mode === 'standard' && /standard page/.test(j[2].note), '8b a ZIP not in the model is reported as a standard page');
  const pages = ['shell.js', 'lib/community-page.js', 'scripts/gen_zip_pages.py'].map(read).join('\n');
  ok(!/zip-coverage-report|reasonUnavailable|last_verified/.test(pages), '8c nothing in a shipped page or the build refers to the report: it is not part of the visitor experience');
}

// ── §9 the public model carries page behavior only ──────────────────────────────────────
console.log('§9 the browser-delivered model has no provenance, no notes and no vendor detail');
{
  const pubRaw = read('lib/zip-coverage.json');
  const FORBID = ['third_party_flag', 'decommissioned', 'verification_notes', 'postal_status_source', 'postal_status_verified_at', 'postal_status', 'source_md5', 'source_class', 'zcta_2010_status', 'zcta_2020_status', 'unitedstateszipcodes', 'usps_verified', 'manual_review'];
  ok(FORBID.every((f) => !pubRaw.toLowerCase().includes(f)), '9a lib/zip-coverage.json contains none of the forbidden strings', FORBID.filter((f) => pubRaw.toLowerCase().includes(f)));
  ok(!/decommission|vendor|zipcodes\s*3|third[ _-]?party/i.test(pubRaw), '9b ...nor any text that says or implies "decommissioned", a vendor, or a third party');
  ok(JSON.stringify(Object.keys(doc)) === JSON.stringify(['_doc', 'copy', 'zips']), '9c the public file has exactly three top-level keys: _doc, copy, zips', Object.keys(doc));
  ok(ALL.every((z) => JSON.stringify(Object.keys(PUB[z])) === JSON.stringify(['zip_code', 'zip_type', 'map_coverage', 'page_mode'])),
    '9d every public entry is exactly zip_code, zip_type, map_coverage, page_mode');
  ok(JSON.stringify(Object.keys(PUB).sort()) === JSON.stringify(ALL), '9e the public file covers the same 49 ZIPs as the internal record');
  ok(ZIPS.every((z) => ['postal_status', 'postal_status_source', 'postal_status_verified_at', 'verification_notes', 'zcta_2010_status', 'zcta_2020_status'].every((k) => k in Z[z])
    && Z[z].postal_status_source === 'third_party_flag' && /NOT confirmed with USPS/.test(Z[z].verification_notes)) && UNV.every((z) => /USPS lookup could not be performed/.test(Z[z].verification_notes)),
    '9f the full provenance is still auditable in the internal record');
  ok(!existsSync(join(root, 'lib', 'zip-coverage-internal.json')) && !/lib\/|\.\.\//.test(INTERNAL), '9g the internal record lives under docs/, not lib/');
  // CI refuses a reintroduction: validate_public must reject each shape
  const pub = (mutate) => {
    const code = 'import sys,json; sys.path.insert(0,"scripts"); import build_zip_coverage as z\n'
      + 'd=json.load(open("lib/zip-coverage.json")); exec(sys.argv[1])\n'
      + 'try:\n z.validate_public(d); print("VALID")\nexcept ValueError as x: print("REFUSED:",x)';
    return py(['-c', code, mutate]).stdout.trim();
  };
  ok(pub('pass') === 'VALID', '9h the real public model passes validate_public');
  ok(/REFUSED/.test(pub('d["zips"]["75245"]["verification_notes"]="x"')), '9i an added verification_notes field is refused');
  ok(/REFUSED/.test(pub('d["zips"]["75245"]["postal_status_source"]="third_party_flag"')), '9j an added postal_status_source field is refused');
  ok(/REFUSED/.test(pub('d["zips"]["75245"]["postal_status_verified_at"]=None')), '9k an added postal_status_verified_at field is refused');
  ok(/REFUSED/.test(pub('d["_doc"]="flagged decommissioned"')), '9l the word decommissioned anywhere in the file is refused');
  ok(/REFUSED/.test(pub('d["copy"]["verification_pending"]["body"][0]="from a third_party_flag"')), '9m provenance text inside the copy is refused');
  ok(/REFUSED/.test(pub('d["source"]="docs/x.csv"')) && /REFUSED/.test(pub('d["source_md5"]="x"')), '9n an extra top-level key (source, source_md5) is refused');
  ok(/REFUSED/.test(pub('d["zips"]["75245"]["city"]="Dallas"')), '9o a city/state/county field is refused too: the browser gets page behavior only');
  // and no code that reaches the browser reads a provenance field
  const browserCode = ['shell.js', 'lib/community-page.js', 'index.html'].map(read).join('\n');
  ok(!/postal_status|verification_notes|third_party|zcta_20(10|20)_status|source_md5/.test(browserCode), '9p no browser-delivered code refers to a provenance field');
  // only the copy a visitor can reach ships, and the word "retired" ships only while a ZIP is retired
  ok(JSON.stringify(Object.keys(doc.copy).sort()) === JSON.stringify(['specialized_zip', 'unverified', 'verification_pending']), '9q the public copy holds only the modes in use (no dormant retired text)', Object.keys(doc.copy));
  ok(!/retired/i.test(pubRaw), '9r the word "retired" is nowhere in the browser file while no ZIP is retired');
  ok(/REFUSED/.test(pub('d["copy"]["retired"]={"title":"x","body":["x"],"primary_cta":"x"}')), '9s a dormant copy block for a mode nobody uses is refused');
  ok(/REFUSED/.test(pub('del d["copy"]["unverified"]')), '9t a mode in use with no copy is refused');
  ok(/REFUSED/.test(pub('d["_doc"]="this ZIP is retired"')), '9u the word retired anywhere in the file is refused while no ZIP is retired');
  // and the generated documents carry none of it
  rmSync(site, { recursive: true, force: true }); gen();   // §6 left the retired-fixture build in place
  const gh = MOD.map((z) => readFileSync(join(site, 'community', z, 'index.html'), 'utf8')).join('\n');
  ok(existsSync(join(site, 'community', '78769', 'index.html')) && !/third_party|decommission|verification_notes|postal_status/i.test(gh), '9q the generated ZIP documents carry none of it either');
}

// ── §10 84684 and 84685: existence unverified, so NO page (founder, 2026-10-03) ───────────
console.log('§10 the two ZIPs whose existence is unverified have no page, through the same mechanism');
{
  const WANT_NOTES = {
    84684: "USPS lookup could not be performed on 2026-10-03. ZIP is absent from zipcodes 3.0.0 and Census 2010/2020 ZCTA datasets. Registry label 'West Mountain' is unsourced and must not be treated as a confirmed ZIP locality. No geographic, civic, electoral, demographic, or map data may be derived. Re-audit only after USPS or USPS City State Product verification.",
    84685: "USPS lookup could not be performed on 2026-10-03. ZIP is absent from zipcodes 3.0.0 and Census 2010/2020 ZCTA datasets. Registry label 'Woodland Hills (84685)' is unsourced and must not be treated as a confirmed ZIP locality. No geographic, civic, electoral, demographic, or map data may be derived. Re-audit only after USPS or USPS City State Product verification.",
  };
  ok(JSON.stringify(UNV) === '["84684","84685"]', '10a exactly 84684 and 84685 are unverified', UNV);
  ok(UNV.every((z) => Z[z].postal_status === 'unverified' && Z[z].postal_status_source === 'manual_review' && Z[z].map_coverage === 'none' && Z[z].verification_notes.startsWith(WANT_NOTES[z])),
    '10b the internal record carries the founder-approved audit notes word for word, and claims no status');
  ok(!UNV.some((z) => ZIPS.includes(z)), '10c neither is one of the 47 decommissioned-in-dataset ZIPs');
  ok(!ALL.includes('84651') && !ALL.includes('84653'), '10d the neighbouring real ZIPs 84651 and 84653 are not in the model');
  ok(UNV.every((z) => PUB[z].page_mode === 'unverified' && Object.keys(PUB[z]).length === 4), '10e the public entry is the four public fields, page_mode unverified');
  const U = doc.copy.unverified;
  ok(U.title === 'ZIP {zip} is not available' && JSON.stringify(U.body) === JSON.stringify(["We couldn't confirm that ZIP code {zip} is an active U.S. Postal Service ZIP code, so we don't have a page for it. Check the number, or search by city or address to find your community."])
    && U.primary_cta === 'Look up another ZIP code or address →' && !('secondary_cta' in U) && U.page_title === 'ZIP {zip} is not available — HomeSignal',
    '10f the notice is the founder-approved one: it says only that the ZIP could not be confirmed, offers one link and no nearby-ZIP link');
  ok(!/retired|invalid|decommission|inactive|no longer in use/i.test(JSON.stringify(U)), '10g it never calls either ZIP retired, invalid, decommissioned or inactive');
  const committedSitemap = read('sitemap.xml');
  ok(UNV.every((z) => !committedSitemap.includes(`zip=${z}`) && !committedSitemap.includes(`/community/${z}/`)), '10h the committed sitemap lists neither');
  // the build: no document, no sitemap entry, no sibling link, and every other page byte-identical
  const f2 = JSON.parse(read('test/fixtures/zip-pages.json'));
  const base = { ...f2, zips: [...f2.zips] };
  const withU = JSON.parse(JSON.stringify(f2));
  for (const z of UNV) { withU.zips.push(z); withU.meta.push({ zip: z, name: `Utah County ${z}`, county: 'Utah', state: 'UT', data_quality: 'pass', indexable: true }); }
  withU.zips = [...new Set(withU.zips)].sort();
  const build = (fx2, tag) => {
    const d = join(out, tag); rmSync(d, { recursive: true, force: true });
    writeFileSync(join(out, tag + '.json'), JSON.stringify(fx2));
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
    const r = py(['scripts/gen_zip_pages.py', '--fixture', join(out, tag + '.json'), '--out', join(d, 'site'), '--now', '2026-09-04T00:00:00', '--dev-plane', 'test/fixtures/development_seo_plane.json']);
    return { r, site: join(d, 'site') };
  };
  const A = build(base, 'u-without'), B = build(withU, 'u-with');
  ok(A.r.status === 0 && B.r.status === 0, '10i the build succeeds with and without the two ZIPs in the registry', (B.r.stderr || B.r.stdout).slice(-300));
  const mB = JSON.parse(readFileSync(join(B.site, 'zip-pages-manifest.json'), 'utf8'));
  ok(UNV.every((z) => !existsSync(join(B.site, 'community', z))) && JSON.stringify(mB.unverified_zips) === JSON.stringify(UNV) && mB.retired_zips.length === 0,
    '10j no document is written for either, and the manifest names them', mB.unverified_zips);
  ok(mB.documents + UNV.length === mB.canonical_registry, '10k documents + unverified = registry');
  const smB = readFileSync(join(B.site, 'sitemap.xml'), 'utf8');
  ok(UNV.every((z) => !smB.includes(z)), '10l neither is in the generated sitemap');
  const same = f2.zips.every((z) => readFileSync(join(A.site, 'community', z, 'index.html'), 'utf8') === readFileSync(join(B.site, 'community', z, 'index.html'), 'utf8'));
  ok(same, '10m every other ZIP document is byte-identical with and without them (no sibling, city or project link to either)');
  ok(f2.zips.every((z) => !readFileSync(join(B.site, 'community', z, 'index.html'), 'utf8').includes('8468')), '10n no generated document mentions 8468x');
}

rmSync(out, { recursive: true, force: true });
console.log('FAILS: ' + fails);
process.exit(fails ? 1 : 0);
