// Tab 19 public claim checks: /fact-checks/<slug>/ and /fact-checks/, built by the REAL scripts/gen_zip_pages.py from a
// fixture of what claim_check_public_export() returns. Run: node test/fact-check-pages.test.mjs
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'scripts', 'gen_zip_pages.py');
const FIXDIR = join(root, 'test', 'fixtures', 'city-pages');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('PASS —', m); } else { fail++; console.error('FAIL —', m, d); } };
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://jodytracks.com/</loc></url>
</urlset>
`;

const claim = (over = {}) => Object.assign({
  slug: 'kevin-oleary-no-water', headline: 'O\'Leary said the campus uses no water. Its filing asks for water.',
  speaker_name: 'Kevin O\'Leary', speaker_org: 'O\'Leary Ventures', quote: 'It will use no water <b>at all</b>.',
  quote_source_url: 'https://example.com/transcript', timestamp_s: 95, context: 'Asked about cooling.',
  assertion: 'The campus uses no water.', verdict: 'false', verdict_explanation: 'The filing requests water for cooling.',
  evidence: { supporting: [], contradicting: [{ url: 'https://waterrights.utah.gov/x', title: 'Application', finding: 'Requests water.' },
    { url: 'javascript:alert(1)', title: 'bad', finding: 'never shown' }] },
  evidence_gaps: null, public_state: 'published', reviewed_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z',
  sources: [{ platform: 'youtube', publisher: 'Fox Business', url: 'https://www.youtube.com/watch?v=abcDEF12345',
    embed_url: 'https://www.youtube-nocookie.com/embed/abcDEF12345', title: 'Interview', published_at: '2026-07-20T00:00:00Z' }],
  corrections: []
}, over);

function build(fc) {
  const dir = mkdtempSync(join(tmpdir(), 'fcfix-'));
  writeFileSync(join(dir, 'zip-pages.json'), readFileSync(join(FIXDIR, 'zip-pages.json'), 'utf8'));
  writeFileSync(join(dir, 'development_seo_plane.json'), readFileSync(join(FIXDIR, 'development_seo_plane.json'), 'utf8'));
  if (fc !== undefined) writeFileSync(join(dir, 'fact_checks.json'), typeof fc === 'string' ? fc : JSON.stringify(fc));
  const out = mkdtempSync(join(tmpdir(), 'fc-'));
  writeFileSync(join(out, 'sitemap.xml'), SITEMAP);
  const r = spawnSync('python3', [GEN, '--fixture', join(dir, 'zip-pages.json'), '--out', out, '--now', '2026-10-30T00:00:00'], { encoding: 'utf8' });
  return { r, out };
}
const page = (out, p) => readFileSync(join(out, ...p.split('/').filter(Boolean), 'index.html'), 'utf8');

const retracted = claim({ slug: 'second-claim', public_state: 'retracted', verdict: 'misleading',
  corrections: [{ kind: 'retract', note: 'The clip was from a different project.', at: '2026-10-31T00:00:00Z' }] });
const { r, out } = build({ schema: 'claim-checks/1', claims: [claim(), retracted] });
ok(r.status === 0, '1a the build succeeds', (r.stderr || '').slice(-800));
const man = JSON.parse(readFileSync(join(out, 'zip-pages-manifest.json'), 'utf8'));
ok(JSON.stringify(man.fact_check_pages) === JSON.stringify(['/fact-checks/kevin-oleary-no-water/', '/fact-checks/second-claim/', '/fact-checks/']),
  '1b the manifest lists both pages and the archive', JSON.stringify(man.fact_check_pages));
const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
ok(sm.includes('<loc>https://jodytracks.com/fact-checks/kevin-oleary-no-water/</loc>') && sm.includes('<loc>https://jodytracks.com/fact-checks/</loc>'), '1c they are in the master sitemap');
const fam = readFileSync(join(out, 'sitemaps', 'fact-check.xml'), 'utf8');
ok((fam.match(/<loc>/g) || []).length === 3, '1d the fact-check family sitemap lists all three');
const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
ok(/Sitemap: https:\/\/homesignal\.net\/sitemaps\/fact-check\.xml/.test(robots) && !/Disallow: \/fact-checks/.test(robots), '1e robots declares the family and does not block it');

const a = page(out, '/fact-checks/kevin-oleary-no-water/');
ok(a.includes('<meta name="robots" content="index, follow">') && a.includes('<link rel="canonical" href="https://jodytracks.com/fact-checks/kevin-oleary-no-water/">'), '2a indexable and self-canonical');
ok(a.includes('Verdict: <b>False</b>') && a.includes('— Kevin O&#x27;Leary, O&#x27;Leary Ventures'), '2b verdict and attributed speaker');
ok(a.includes('&lt;b&gt;at all&lt;/b&gt;') && !a.includes('<b>at all</b>'), '2c the quote is escaped');
ok(a.includes('src="https://www.youtube-nocookie.com/embed/abcDEF12345?start=95"'), '2d the publisher player starts at the quote');
ok(a.includes("frame-src https://www.youtube-nocookie.com") && a.includes("script-src 'none'"), '2e the CSP allows only the nocookie player and still no script');
ok(a.includes('https://waterrights.utah.gov/x') && !a.includes('javascript:'), '2f evidence links are http(s) only');
ok(a.includes('"@type":"ClaimReview"') && a.includes('"alternateName":"False"') && a.includes('"ratingValue":1'), '2g ClaimReview structured data with the verdict');
ok(a.includes('A verdict is about the claim, not the person.'), '2h the page states what a verdict means');

const b = page(out, '/fact-checks/second-claim/');
ok(b.includes('<b>Retracted.</b> The clip was from a different project.') && b.includes('Retraction: The clip'), '3a a retraction stays on the page with its notice');
ok(!b.includes('"ClaimReview"'), '3b a retracted page carries no ClaimReview');
const noEmbed = build({ schema: 'claim-checks/1', claims: [claim({ sources: [Object.assign({}, claim().sources[0], { embed_url: null })] })] });
ok(noEmbed.r.status === 0 && !page(noEmbed.out, '/fact-checks/kevin-oleary-no-water/').includes('<iframe'), '3c no embed permission: no player, only the link');

const idx = page(out, '/fact-checks/');
ok(idx.includes('Data center fact-checks') && idx.includes('/fact-checks/kevin-oleary-no-water/') && idx.includes('retracted'), '4a the archive lists both, and marks the retraction');
const empty = build(undefined);
ok(empty.r.status === 0 && page(empty.out, '/fact-checks/').includes('No fact-checks are published yet.'), '4b with none published, the archive says so');

const bad = build({ schema: 'claim-checks/1', claims: [claim({ verdict: null })] });
ok(bad.r.status !== 0 && /missing its verdict/.test(bad.r.stderr + bad.r.stdout), '5a a claim check with no verdict stops the build');
const cand = build({ schema: 'claim-checks/1', claims: [claim({ public_state: 'none' })] });
ok(cand.r.status !== 0 && /is not public/.test(cand.r.stderr + cand.r.stdout), '5b a non-public claim check stops the build');
const dup = build({ schema: 'claim-checks/1', claims: [claim(), claim()] });
ok(dup.r.status !== 0 && /duplicate/.test(dup.r.stderr + dup.r.stdout), '5c a duplicate slug stops the build');
const shape = build('{"schema":"wrong"}');
ok(shape.r.status !== 0 && /wrong shape/.test(shape.r.stderr + shape.r.stdout), '5d a malformed file stops the build');
ok(existsSync(join(out, 'sitemaps', 'page-state.json')) && readFileSync(join(out, 'sitemaps', 'page-state.json'), 'utf8').includes('/fact-checks/kevin-oleary-no-water/'),
  '6a the pages are tracked by the one page-semantics authority (IndexNow)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
