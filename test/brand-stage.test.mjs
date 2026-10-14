// Jody migration, Step 3: the brand overlay rewrites a STAGED tree and nothing else.
// Run: node test/brand-stage.test.mjs   (needs python3; stages the real artifact with scripts/stage_site.py)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, cpSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

let failures = 0;
const check = (n, ok, why) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` — ${why}`}`); if (!ok) failures++; };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const brand = (dir, ...a) => spawnSync('python3', ['scripts/brand_stage.py', '--dir', dir, '--contract', 'test/fixtures/brand-contract.v1.frozen.json', ...a], { encoding: 'utf8' });

const base = mkdtempSync(join(tmpdir(), 'brand-stage-'));
const st = join(base, 'st');
execFileSync('python3', ['scripts/stage_site.py', '--src', '.', '--out', st], { stdio: 'pipe' });
const baseFiles = walk(st).map((p) => relative(st, p)).sort();
check('0 the real staged artifact is non-empty (denominator)', baseFiles.length > 50, String(baseFiles.length));

// 1. identity = current brand is a verified no-op
const h = join(base, 'h'); cpSync(st, h, { recursive: true });
const rh = brand(h, '--identity', 'homesignal');
let same = rh.status === 0;
for (const f of baseFiles) if (readFileSync(join(st, f)).compare(readFileSync(join(h, f))) !== 0) same = false;
check('1a --identity homesignal leaves every byte unchanged', same, rh.stderr);
const bad = brand(h, '--identity', 'homesignal', '--staging');
check('1b --staging on the current identity is refused', bad.status !== 0, 'accepted');
check('1c an unknown identity is refused', brand(h, '--identity', 'nope').status !== 0, 'accepted');

// 2. jody staging build
const j = join(base, 'j'); cpSync(st, j, { recursive: true });
const rj = brand(j, '--identity', 'jody', '--staging');
check('2a overlay exits 0 with no unclassified leftovers', rj.status === 0, rj.stderr + rj.stdout.slice(-400));
const rep = JSON.parse(rj.stdout);
check('2b every rule fired on the real tree', ['esc', 'origin', 'host', 'name', 'wordmark', 'tagline', 'noindex'].every((k) => rep.counts[k] > 0), JSON.stringify(rep.counts));
const jfiles = walk(j).map((p) => relative(j, p)).sort();
const removed = baseFiles.filter((f) => !jfiles.includes(f));
check('2c no file was added or renamed (identical paths)', jfiles.every((f) => baseFiles.includes(f)), 'added');
check('2d only the launch-signal files were removed', removed.every((f) => f === 'CNAME' || f === 'sitemap.xml' || f.startsWith('sitemaps/') || f === 'indexnow.txt' || /^google[0-9a-f]+\.html$/.test(f)), removed.join());
const html = jfiles.filter((f) => f.endsWith('.html') && /<head[\s>]/i.test(readFileSync(join(j, f), 'utf8')));
check('2e0 the pages with a <head> are a real, non-trivial set', html.length > 15, String(html.length));
check('2e every HTML page carries noindex', html.every((f) => /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(readFileSync(join(j, f), 'utf8'))), 'a page lacks it');
check('2e1 the shared shell partial (no <head>) gets no injected meta, only its tagline', !/name="robots"/.test(readFileSync(join(j, 'partials/shell.html'), 'utf8')), 'meta in shell');
check('2e2 the old domain\'s Google verification file is not carried over', !jfiles.some((f) => /^google[0-9a-f]+\.html$/.test(f)) && baseFiles.some((f) => /^google[0-9a-f]+\.html$/.test(f)), 'present');
check('2f robots.txt disallows everything and lists no sitemap', readFileSync(join(j, 'robots.txt'), 'utf8').trim() === 'User-agent: *\nDisallow: /', 'robots');
check('2g no CNAME, so the repo domain is never claimed', !existsSync(join(j, 'CNAME')), 'present');
const idx = readFileSync(join(j, 'index.html'), 'utf8');
check('2h home title carries the tagline', /<title>Jody — Know what’s coming\.<\/title>/.test(idx), (idx.match(/<title>[^<]*/) || [''])[0]);
check('2i canonical is the Jody origin', /<link rel="canonical" href="https:\/\/jodytracks\.com\/">/.test(idx), 'canonical');
const shell = readFileSync(join(j, 'partials/shell.html'), 'utf8');
check('2j footer shows the tagline once', (shell.match(/Know what’s coming\./g) || []).length === 1, 'tagline');

// 3. nothing resident-visible still says the old brand; identifiers survive
const all = jfiles.map((f) => [f, readFileSync(join(j, f), 'utf8')]);
const oldOrigin = all.filter(([, t]) => /https:\/\/(?:www\.)?homesignal\.net/.test(t));
check('3a no old-origin URL remains', oldOrigin.length === 0, oldOrigin.map(([f]) => f).join());
const visible = all.filter(([f, t]) => f.endsWith('.html') && /HomeSignal(?![\w-])/.test(t.replace(/<script[\s\S]*?<\/script>/g, '')));
check('3b no visible "HomeSignal" word remains in any page body', visible.length === 0, visible.map(([f]) => f).join());
const jsAll = all.filter(([f]) => f.endsWith('.js')).map(([, t]) => t).join('\n');
check('3b2 no split wordmark (Home<span>Signal</span>) remains', !all.some(([, t]) => /Home<span[^>]*>Signal<\/span>/.test(t)), 'split');
check('3c the share-link validators accept BOTH origins', /homesignal\\\.net\|jodytracks\\\.com/.test(all.map(([, t]) => t).join('\n')), 'validator');
const re = /^https:\/\/(?:homesignal\.net|jodytracks\.com)\/shared-report\.html#share=[A-Za-z0-9_-]{43}$/;
const tok = 'A'.repeat(43);
check('3d …and reject a lookalike host', re.test(`https://homesignal.net/shared-report.html#share=${tok}`) && re.test(`https://jodytracks.com/shared-report.html#share=${tok}`) && !re.test(`https://jodytracks.com.evil.io/shared-report.html#share=${tok}`), 'regex');
check('3e shipped host allowlists name the Jody host AND keep the legacy one (an e-mail sent before the move carries u=https://homesignal.net/...)',
  /ALLOWED_HOSTS = \['jodytracks\.com', 'www\.jodytracks\.com', 'homesignal\.net', 'www\.homesignal\.net'\]/.test(readFileSync(join(j, 'lib/share-text.js'), 'utf8')), 'share-text');
{
  // run the REAL overlaid validator, not a regex about it
  const { createRequire } = await import('node:module');
  const st = createRequire(import.meta.url)(join(j, 'lib/share-text.js'));
  const ok = (u) => st.model('?u=' + encodeURIComponent(u)).ok;
  check('3e2 the Jody share-text page accepts a link from an old e-mail (homesignal.net) and from the new host', ok('https://homesignal.net/homesignalmap.html?zip=84302') && ok('https://jodytracks.com/community/84302/'), 'refused');
  check('3e3 …and still refuses lookalikes, other schemes, userinfo and ports (not an open relay)', !ok('https://jodytracks.com.evil.io/') && !ok('https://evil.io/?x=homesignal.net') && !ok('http://jodytracks.com/') && !ok('https://u:p@jodytracks.com/') && !ok('https://jodytracks.com:444/') && !ok('https://notjodytracks.com/') && !ok('https://homesignal.net.evil.io/'), 'accepted');
}
check('3f the file names stay (homesignalmap.html is still linked)', all.some(([, t]) => t.includes('homesignalmap.html')) && jfiles.includes('homesignalmap.html'), 'renamed');
// F2 (Step 16 audit): the ONLY @jodytracks.com mailbox in the Jody tree is the customer-support one (info@), and only on the
// contact + legal pages; every other address stays on the existing domain until Step 6.
const jMail = all.flatMap(([f, t]) => (t.match(/[A-Za-z0-9._%+\-]+@jodytracks\.com/g) || []).map((m) => [f, m]));
check('3g e-mail addresses stay on the existing domain until Step 6, except the support mailbox on its pages', all.some(([, t]) => /@homesignal\.net/.test(t)) && jMail.every(([f, m]) => m === 'info@jodytracks.com' && ['contact.html', 'privacy.html', 'terms.html', 'refund-policy.html'].includes(f)), JSON.stringify(jMail.slice(0, 5)));
check('3h the immutable DID is untouched wherever it appears', !all.some(([, t]) => /did:web:jodytracks/.test(t)), 'did');
check('3i the Supabase project reference is untouched', all.some(([, t]) => t.includes('qwnnmljucajnexpxdgxr')), 'supabase');

// 4. the leftover scanner can fail (negative control) and a no-op run cannot pass
const n = join(base, 'n'); cpSync(st, n, { recursive: true });
writeFileSync(join(n, 'about.html'), readFileSync(join(n, 'about.html'), 'utf8') + '\n<p>see HomeSignalFoo</p>');
check('4a an unclassified HomeSignal string fails the run', brand(n, '--identity', 'jody', '--staging').status !== 0, 'passed');
const e = join(base, 'e'); cpSync(st, e, { recursive: true });
for (const f of walk(e)) if (/\.(html|js|json|xml|txt)$/.test(f)) writeFileSync(f, readFileSync(f, 'utf8').replace(/homesignal\.net/gi, 'example.test').replace(/HomeSignal/g, 'Brand'));
check('4b a tree with nothing to rewrite fails (the overlay must prove it ran)', brand(e, '--identity', 'jody', '--staging').status !== 0, 'passed');

// 5. the source tree and the live build are untouched by this feature
const srcIdx = readFileSync('index.html', 'utf8');
check('5a source index.html still says HomeSignal on the live origin', srcIdx.includes('https://homesignal.net/') && !srcIdx.includes('jodytracks'), 'source changed');
const pages = readFileSync('.github/workflows/pages.yml', 'utf8');
// Step 16 superseded the old pin ("the live deploy does not call the overlay"): it now calls it, exactly once, with the identity the
// CONTRACT reports - a verified no-op while that is homesignal (A1-A3 in cutover-activation.test.mjs) - and never with a literal or --staging.
const calls = pages.split('\n').filter((l) => !/^\s*#/.test(l) && /brand_stage\.py/.test(l));
check('5b pages.yml calls the overlay exactly once, with the contract-reported identity, never a literal and never --staging',
  calls.length === 1 && /--identity "\$\(python3 scripts\/brand_host\.py --identity\)"/.test(calls[0]) && !/--staging|--identity (jody|homesignal)\b/.test(calls[0]), JSON.stringify(calls));
rmSync(base, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
