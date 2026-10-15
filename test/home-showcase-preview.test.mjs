// The homepage's example-report preview is a REAL report rendered by the real view, not a drawing and not a generic fixture.
// Pins: the committed report body is byte-identical to the production snapshot (md5), the verified counts, that the receipt's text is what the view
// itself prints (the Quality-of-Life sentences are lib/da-report-view.js's own), that no test-account identity reaches the page or the receipt, and that
// `scripts/build-home-showcase-preview.mjs --check` reproduces the committed receipt and asset sizes. Run: node test/home-showcase-preview.test.mjs
// --check needs playwright and Python Pillow (the build tool's dependencies). Importing playwright also makes scripts/run-unit-tests.mjs run this in the browser job.
await import('playwright');
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(root, f));
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + String(d).slice(0, 400)); } };

const bodyBuf = rd('data/home-showcase/point-fosdick-98335-report-body.json');
ok(createHash('md5').update(bodyBuf).digest('hex') === 'f04579a6f3adfc15f4f7ab3300e884c3', '1 the report body is byte-identical to the production snapshot (md5 of the stored report body, report f7c2c616)');
const rep = JSON.parse(bodyBuf.toString('utf8'));
const by = (k) => rep.projects.filter((p) => p.type.key === k).length;
ok(rep.projects.length === 2 && rep.radius_mi === 0.5 && rep.zip === '98335' && rep.as_of === '2026-10-15', '2 two official records, 0.5-mile radius, ZIP 98335, as of 2026-10-15');
ok(by('residential') === 2, '3 types: both records Residential');
ok(rep.sections.by_stage.permitted.length === 1 && rep.sections.by_stage.proposed.length === 1, '4 stages: 1 permitted / under construction, 1 proposed / under review');
ok(rep.projects.every((p) => p.source_family === 'pierce-county-pals-permits' && /^https:\/\/pals\.piercecountywa\.gov\//.test(p.source.url)), '5 both records are Pierce County PALS permits with an official record link');
ok(['Construction Residential Long Acres, Lot 15', 'Construction Residential Long Acres, Lot 20'].every((n) => rep.projects.some((p) => p.name === n)), '6 the two records are Long Acres, Lot 15 and Lot 20');

const receipt = JSON.parse(rd('data/home-showcase/preview-receipt.json').toString('utf8'));
const view = readFileSync(join(root, 'lib/da-report-view.js'), 'utf8');
const qol = [...view.matchAll(/(?:infrastructure|commercial|residential|civic): '([^']+)'/g)].map((m) => m[1]);
for (const name of ['desktop', 'mobile']) {
  const t = receipt.frames[name].text;
  ok(t.includes(view.match(/residential: '([^']+)'/)[1]), '8 ' + name + ': the Quality-of-Life sentence in the image is the view\'s own, word for word');
  ok(/2 official records within 0\.5 miles[^.]*1 permitted \/ under construction · 1 proposed \/ under review/.test(t) && /Both of the report’s 2 official records are shown/.test(t) && !/Frisco|Touraine|75034/.test(t), '9 ' + name + ': counts and the "both of 2" disclosure are in the image; no Frisco content');
  ok(!/Founder Test|\bct\b|@|Test Workspace/i.test(t), '10 ' + name + ': no test-account identity or email in the image text');
  ok(/Proposed \/ Under Review/.test(t) && /Permitted \/ Under Construction/.test(t), '11 ' + name + ': both stages shown with the report\'s own labels');
}
const idx = rd('index.html').toString('utf8');
ok(!/Founder Test Workspace|test workspace/i.test(idx + JSON.stringify(receipt)), '12 no internal test-account label on the homepage or in the receipt');
ok(/href="development-activity\.html">Explore Agent Reports →<\/a>/.test(idx), '13 the CTA and its destination are unchanged');
ok(!/verified (traffic|noise|air|water|soil)/i.test(idx), '14 the marketing copy claims no verified traffic, noise, air, water or soil effect');

const r = spawnSync('node', [join(root, 'scripts/build-home-showcase-preview.mjs'), '--check'], { encoding: 'utf8', cwd: root, timeout: 180000 });
ok(r.status === 0 && /PASS/.test(r.stdout), '15 --check re-renders the real view and reproduces the committed receipt text, kept rows and asset sizes', r.stdout + r.stderr);

// 16-18 STALE OR MISMATCHED ASSETS CANNOT PASS. Each case damages one committed file, runs --check, and restores it in a finally block.
const checkRun = (...extra) => spawnSync('node', [join(root, 'scripts/build-home-showcase-preview.mjs'), '--check', ...extra], { encoding: 'utf8', cwd: root, timeout: 180000 });
const withDamage = (files, damage, fn) => {
  const keep = files.map((f) => [f, readFileSync(join(root, f))]);
  try { damage(); return fn(); } finally { for (const [f, b] of keep) writeFileSync(join(root, f), b); }
};
const DESK = 'assets/home-report-example-desktop.webp', REC = 'data/home-showcase/preview-receipt.json', IDX = 'index.html';
let r2 = withDamage([DESK], () => writeFileSync(join(root, DESK), Buffer.concat([rd(DESK), Buffer.from([0])])), checkRun);
ok(r2.status !== 0 && /sha256/.test(r2.stdout), '16 an image that is not the one the receipt describes (sha256) fails --check', r2.stdout);
r2 = withDamage([DESK, REC], () => {
  // an image of the right size that does not look like the current rendering, with a receipt that was "regenerated" to match its bytes
  spawnSync('python3', ['-c', 'import sys\nfrom PIL import Image,ImageDraw\nim=Image.open(sys.argv[1]).convert("RGB");d=ImageDraw.Draw(im);d.rectangle((0,im.height//3,im.width,im.height*2//3),fill="black");im.save(sys.argv[1],"WEBP",quality=90)', join(root, DESK)]);
  const rc = JSON.parse(rd(REC).toString('utf8')); const im = readFileSync(join(root, DESK));
  rc.frames.desktop.asset_sha256 = createHash('sha256').update(im).digest('hex'); writeFileSync(join(root, REC), JSON.stringify(rc, null, 1) + '\n');
}, () => checkRun('--strict-pixels'));
ok(r2.status !== 0 && /committed image differs from a fresh render/.test(r2.stdout), '17 with --strict-pixels (same fonts), a same-size image that does not match a fresh render fails even when the receipt is made consistent with it', r2.stdout);
r2 = withDamage([REC], () => { const rc = JSON.parse(rd(REC).toString('utf8')); rc.view_sha256 = '0'.repeat(64); writeFileSync(join(root, REC), JSON.stringify(rc, null, 1) + '\n'); }, checkRun);
ok(r2.status !== 0 && /da-report-view\.js changed since the images were built/.test(r2.stdout), '17b images built from an older report view fail --check on any machine, whatever fonts it has', r2.stdout);
r2 = withDamage([IDX], () => writeFileSync(join(root, IDX), rd(IDX).toString('utf8').replace('width="1600" height="1464"', 'width="1400" height="1900"')), checkRun);
ok(r2.status !== 0 && /index\.html does not reference/.test(r2.stdout), '18 the homepage referencing the preview at a stale size fails --check', r2.stdout);
const post = checkRun();
ok(post.status === 0, '19 after the damage tests the committed files are restored and --check passes again', post.stdout);
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
