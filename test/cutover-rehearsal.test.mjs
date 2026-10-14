// Jody Step 16 - REHEARSE the activation without activating anything.
//
// The cutover is ONE data change: docs/brand/brand-contract.v1.json becomes the v2 swap (Jody current, HomeSignal legacy). This test makes
// that change in a THROWAWAY COPY of the repo, runs the real build steps in the order pages.yml runs them (stage_site -> gen_zip_pages ->
// brand_stage with the identity brand_host.py reports), and proves the result is
//   (1) the same tree the already-proven overlay produces from the HomeSignal build (so the 26,701-page parity measured on a real snapshot
//       in jody-seo-parity run 37971696362 describes the activation, not only the overlay),
//   (2) SEO-equivalent to the HomeSignal tree (seo_parity.py: identical paths, robots, canonical paths, indexable set, sitemap paths),
//   (3) Jody-hosted everywhere the build decides a host (canonicals, sitemaps, robots, page-state, IndexNow host) and HomeSignal-free
//       in public copy, and
//   (4) still holding every safeguard that must survive launch day (IndexNow held, the DID and mailboxes untouched, no staging leakage).
// The committed contract is NOT changed by this test and a check below fails if it ever is.
// What it cannot show: Render, GitHub Pages' certificate/DNS behaviour, Search Console, or live data. Those are GO LIVE evidence.
// Run: node test/cutover-rehearsal.test.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` - ${why}`}`); if (!ok) failures++; };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (d) => (p) => p.slice(d.length + 1);
const FIXTURE = resolve('test/fixtures/zip-pages.json');
const NOW = '2026-09-04T00:00:00';

const committed = readFileSync('docs/brand/brand-contract.v1.json', 'utf8');
const base = mkdtempSync(join(tmpdir(), 'rehearsal-'));

// ---- tree A: HomeSignal (the live brand), tree B: HomeSignal build + overlay (the proven Jody launch tree) ----------------------------
const A = join(base, 'a');
execFileSync('python3', ['scripts/stage_site.py', '--src', '.', '--out', A], { stdio: 'pipe' });
execFileSync('python3', ['scripts/gen_zip_pages.py', '--fixture', FIXTURE, '--out', A, '--now', NOW], { stdio: 'pipe' });
const B = join(base, 'b'); cpSync(A, B, { recursive: true });
check('0a overlay of the HomeSignal build into the Jody launch tree succeeds', spawnSync('python3', ['scripts/brand_stage.py', '--dir', B, '--identity', 'jody'], { encoding: 'utf8' }).status === 0, 'failed');

// ---- the throwaway repo copy, with the contract flipped to v2 -------------------------------------------------------------------------
const R = join(base, 'repo');
const SKIP = new Set(['.git', 'node_modules', 'test', '_site']);
cpSync('.', R, { recursive: true, filter: (src) => !SKIP.has(src.replace(/^\.\/?/, '').split('/')[0]) || src === '.' });
const v2 = JSON.parse(committed);
v2.contract_version = 2; v2.current_identity = 'jody'; v2.future_identity = 'homesignal';
v2.identities.jody.state = 'active'; v2.identities.homesignal.state = 'inactive';
writeFileSync(join(R, 'docs/brand/brand-contract.v1.json'), JSON.stringify(v2, null, 2) + '\n');

const inR = (args) => spawnSync('python3', args, { cwd: R, encoding: 'utf8' });
const ident = inR(['scripts/brand_host.py', '--identity']).stdout.trim();
check('1a in the rehearsal copy the build asks the contract and is told: jody', ident === 'jody', ident);
check('1b …and its origin is https://jodytracks.com', inR(['scripts/brand_host.py', '--origin']).stdout.trim() === 'https://jodytracks.com', 'origin');
const C = join(base, 'c');
const steps = [['scripts/stage_site.py', '--src', '.', '--out', C], ['scripts/gen_zip_pages.py', '--fixture', FIXTURE, '--out', C, '--now', NOW], ['scripts/brand_stage.py', '--dir', C, '--identity', ident]];
let built = true;
for (const s of steps) { const r = inR(s); if (r.status !== 0) { built = false; check(`1c step ${s[0]} succeeds under the v2 contract`, false, (r.stderr || r.stdout).slice(-600)); break; } }
if (built) check('1c all three pipeline steps (stage, generate, apply identity) succeed under the v2 contract', true);

if (built) {
  // (1) equivalence with the proven overlay tree
  const fa = walk(B).map(rel(B)).sort(), fc = walk(C).map(rel(C)).sort();
  const onlyB = fa.filter((f) => !fc.includes(f)), onlyC = fc.filter((f) => !fa.includes(f));
  check('2a the activated build ships exactly the same files as the proven Jody launch tree', onlyB.length === 0 && onlyC.length === 0, JSON.stringify({ onlyB: onlyB.slice(0, 5), onlyC: onlyC.slice(0, 5) }));
  // The ONLY files allowed to differ are the two that carry page FINGERPRINTS. A fingerprint hashes the page text, which contains its
  // canonical URL, so the same page generated under another host hashes differently. That is not drift: the first Jody build has no
  // baseline on the Jody host (404 = seed), so it announces nothing and every later build compares like with like.
  const FINGERPRINTED = ['sitemaps/page-state.json', 'zip-pages-manifest.json'];
  const differing = fa.filter((f) => fc.includes(f) && readFileSync(join(B, f)).compare(readFileSync(join(C, f))) !== 0);
  check('2b …byte for byte, except the two files that hold page fingerprints (generating with the Jody host directly == generating with the HomeSignal host and rewriting)',
    JSON.stringify(differing.sort()) === JSON.stringify([...FINGERPRINTED].sort()), differing.slice(0, 8).join(', '));
  const jb = JSON.parse(readFileSync(join(B, 'sitemaps/page-state.json'), 'utf8')), jc = JSON.parse(readFileSync(join(C, 'sitemaps/page-state.json'), 'utf8'));
  const noHash = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([x]) => x !== 'h'))]));
  check('2b2 …and in page-state.json ONLY the hashes differ: same pages, same indexable flag, same lastmod',
    JSON.stringify(Object.keys(jb.pages).sort()) === JSON.stringify(Object.keys(jc.pages).sort()) && JSON.stringify(noHash(jb.pages)) === JSON.stringify(noHash(jc.pages))
    && Object.keys(jb.pages).every((k) => jb.pages[k].h !== jc.pages[k].h), 'structure differs');
  const man = (d) => { const m = JSON.parse(readFileSync(join(d, 'zip-pages-manifest.json'), 'utf8')); delete m.page_state_hash; return JSON.stringify(m); };
  check('2b3 …and in zip-pages-manifest.json only page_state_hash differs', man(B) === man(C), 'manifest differs');
  check('2c the denominator is real (generated ZIP documents, sitemaps and static pages are all in the compared set)',
    fc.filter((f) => /^community\/\d{5}\/index\.html$/.test(f)).length >= 5 && fc.filter((f) => f.startsWith('sitemaps/')).length >= 5 && fc.includes('index.html'), fc.length + ' files');

  // (2) SEO equivalence with the live-brand tree
  const parity = (x, y) => { const r = spawnSync('python3', ['scripts/seo_parity.py', '--a', x, '--b', y], { encoding: 'utf8' }); let j = {}; try { j = JSON.parse(r.stdout); } catch { /* reported */ } return { r, j }; };
  const pAB = parity(A, B);
  check('3a the proven overlay tree still has full SEO parity with the HomeSignal tree (control: the instrument can pass)', pAB.r.status === 0 && pAB.j.ok === true, JSON.stringify(pAB.j.problems));
  const pAC = parity(A, C);
  check('3b the ACTIVATED tree has full SEO parity with the HomeSignal tree INCLUDING the fingerprints: every stored fingerprint is PROVEN to differ only because the page names another host (a\'s page mapped to the Jody host and re-fingerprinted equals b\'s)',
    pAC.r.status === 0 && pAC.j.ok === true && JSON.stringify(pAC.j.problems) === '[]' && pAC.j.stats.page_state_hashes_host_derived === pAC.j.stats.page_state_pages && pAC.j.stats.page_state_pages >= 5, JSON.stringify(pAC.j));
  // The proof must be able to FAIL: change one generated page in the HomeSignal copy in a way a crawler would see, and the activated tree's fingerprint
  // no longer follows from it. Without these the "host-derived" claim is an assertion, not a check.
  const firstZip = Object.keys(jb.pages).find((k) => /^\/community\/\d{5}\/$/.test(k));
  const mutated = (name, edit) => {
    const D = join(base, 'mut-' + name); cpSync(A, D, { recursive: true });
    const f = join(D, firstZip.slice(1), 'index.html'); const t = readFileSync(f, 'utf8'); const u = edit(t);
    if (u === t) throw new Error('mutation ' + name + ' did not change the page');
    writeFileSync(f, u); return parity(D, C);
  };
  const mText = mutated('text', (t) => t.replace(/<h1([^>]*)>/, '<h1$1>CHANGED ').replace(/<title>/, '<title>CHANGED '));
  check('3b2 a page whose crawler-visible text changed is NOT excused as a host difference (the proof names it)', mText.j.problems.some((x) => x.includes('differ beyond the host') && x.includes(firstZip)), JSON.stringify(mText.j.problems).slice(0, 300));
  const mRobots = mutated('robots', (t) => t.replace(/(<meta[^>]+name="robots"[^>]+content=")[^"]*"/, '$1noindex, follow"'));
  check('3b3 a page whose robots directive changed is NOT excused as a host difference', mRobots.j.problems.length > 0 && mRobots.j.ok === false, JSON.stringify(mRobots.j.problems).slice(0, 300));
  const mCanon = mutated('canonical', (t) => t.replace(/(<link[^>]+rel="canonical"[^>]+href="[^"]*\/community\/)(\d{5})/, '$1$2'.replace('$2', '00000')));
  check('3b4 a page whose canonical PATH changed is NOT excused as a host difference', mCanon.j.problems.length > 0 && mCanon.j.ok === false, JSON.stringify(mCanon.j.problems).slice(0, 300));
  const D2 = join(base, 'mut-ctl'); cpSync(A, D2, { recursive: true });
  check('3b5 control: an UNCHANGED copy of the HomeSignal tree passes the same proof (so 3b2-3b4 fail because of the change, not the instrument)', parity(D2, C).j.ok === true, 'control failed');
  const rep = pAC.j;
  check('3c …on a real denominator (generated documents, indexable pages, sitemap URLs), with equal indexable sets', rep.stats && rep.stats.html_pages > 30 && rep.stats.indexable_a > 5 && rep.stats.indexable_a === rep.stats.indexable_b && rep.stats.sitemap_urls_a > 10, JSON.stringify(rep.stats));
  const jA = JSON.parse(readFileSync(join(A, 'sitemaps/page-state.json'), 'utf8'));
  check('3d indexability and lastmod of every page survive the activation (page-state, HomeSignal vs activated)', JSON.stringify(noHash(jA.pages)) === JSON.stringify(noHash(jc.pages)), 'differs');

  // (3) host and brand
  const text = (f) => readFileSync(join(C, f), 'utf8');
  const sm = text('sitemap.xml'), robots = text('robots.txt'), home = text('index.html');
  check('4a sitemap.xml and every sitemap child name only the Jody host', walk(join(C, 'sitemaps')).concat([join(C, 'sitemap.xml')]).every((p) => !/homesignal\.net/.test(readFileSync(p, 'utf8'))), 'old host in a sitemap');
  check('4b robots.txt points at the Jody sitemap and is NOT a staging file', /Sitemap: https:\/\/jodytracks\.com\/sitemap\.xml/.test(robots) && !/^Disallow: \/$/m.test(robots), robots);
  const zdoc = text(fc.find((f) => /^community\/\d{5}\/index\.html$/.test(f)));
  check('4c a generated ZIP document has a Jody self-canonical and the same robots directive as its HomeSignal twin',
    /rel="canonical" href="https:\/\/jodytracks\.com\/community\/\d{5}\/"/.test(zdoc) && /name="robots" content="(index|noindex), follow"/.test(zdoc), zdoc.slice(0, 400));
  check('4d the home page says Jody, carries the tagline and no visible HomeSignal', /Jody/.test(home) && /Know what/.test(home) && !/HomeSignal(?![\w-])/.test(home.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')), 'brand');
  const ps = JSON.parse(text('sitemaps/page-state.json'));
  check('4e the published page-state names the Jody host (the next build\'s baseline is read from the NEW host)', ps.host === 'https://jodytracks.com', ps.host);
  check('4f IndexNow derives its host and key location from the contract: jodytracks.com', /jodytracks\.com/.test(inR(['-c', 'import sys; sys.path.insert(0,"scripts"); import indexnow as i; print(i.HOST, i.KEY_LOCATION)']).stdout), 'host');

  // (4) safeguards that must survive
  const hold = inR(['-c', 'import sys; sys.path.insert(0,"scripts"); import indexnow as i; print(i.launch_hold() or "NONE")']).stdout.trim();
  check('5a under the activated contract IndexNow is HELD (nothing is announced to a search engine until a reviewed hold=false)', hold !== 'NONE' && /hold/.test(hold), hold);
  check('5b the immutable Bluesky DID document is shipped unchanged (did:web:homesignal.net)', existsSync(join(C, '.well-known/did.json')) && readFileSync(join(C, '.well-known/did.json')).compare(readFileSync(join(A, '.well-known/did.json'))) === 0, 'did');
  check('5c the old domain\'s Google verification file is not on the Jody host', !existsSync(join(C, 'google59e1ae3ef6b75e3a.html')), 'present');
  // F2: the one deliberate mailbox is the customer-support info@ on the contact + legal pages; nothing else is invented.
  const SUPPORT = /(^|\/)(contact|privacy|terms|refund-policy)\.html$/;
  check('5d e-mail addresses are untouched (no @jodytracks.com mailbox is invented, except info@ on the support/legal pages)', walk(C).every((p) => !/\.(html|js|txt|json|xml)$/.test(p) || (readFileSync(p, 'utf8').match(/[A-Za-z0-9._%+\-]+@jodytracks\.com/g) || []).every((m) => SUPPORT.test(p) && m === 'info@jodytracks.com')), '@jodytracks.com appears');
  check('5e a Jody LAUNCH tree carries no staging marks (no sitewide noindex, no Disallow-all, sitemaps present)', !/noindex, nofollow/.test(home) && existsSync(join(C, 'sitemap.xml')), 'staging');
}

// ---- the repo itself was not touched ----------------------------------------------------------------------------------------------------
check('6a the committed contract is unchanged by this rehearsal and still HomeSignal-current v1', readFileSync('docs/brand/brand-contract.v1.json', 'utf8') === committed && JSON.parse(committed).current_identity === 'homesignal' && JSON.parse(committed).contract_version === 1, 'changed');
check('6b the Jody IndexNow hold file is still hold=true', JSON.parse(readFileSync('docs/brand/indexnow-jody-hold.json', 'utf8')).hold === true, 'released');

rmSync(base, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
