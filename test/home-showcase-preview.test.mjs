// The homepage's example-report preview is a REAL report rendered by the real view, not a drawing and not a generic fixture.
// Pins: the committed report body is byte-identical to the production snapshot (md5), the verified counts, that the receipt's text is what the view
// itself prints (the Quality-of-Life sentences are lib/da-report-view.js's own), that no test-account identity reaches the page or the receipt, and that
// `scripts/build-home-showcase-preview.mjs --check` reproduces the committed receipt and asset sizes. Run: node test/home-showcase-preview.test.mjs
// --check needs playwright and Python Pillow (the build tool's dependencies). Importing playwright also makes scripts/run-unit-tests.mjs run this in the browser job.
await import('playwright');
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(root, f));
let fails = 0;
const ok = (c, n, d) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) { fails++; if (d !== undefined) console.log('   ' + String(d).slice(0, 400)); } };

const bodyBuf = rd('data/home-showcase/touraine-75034-report-body.json');
ok(createHash('md5').update(bodyBuf).digest('hex') === '0cf8f5d321b5fbf4849f380362bb9ba4', '1 the report body is byte-identical to the production snapshot (md5 of report_snapshot.body, report eaf8c17c)');
const rep = JSON.parse(bodyBuf.toString('utf8'));
const by = (k) => rep.projects.filter((p) => p.type.key === k).length;
ok(rep.projects.length === 9 && rep.radius_mi === 0.5 && rep.zip === '75034' && rep.as_of === '2026-10-12', '2 nine official records, 0.5-mile radius, ZIP 75034, as of 2026-10-12');
ok(by('residential') === 1 && by('commercial') === 6 && by('infrastructure') === 1 && by('civic') === 1, '3 types: Residential 1, Commercial 6, Roads & infrastructure 1, Civic & public 1');
ok(rep.sections.by_stage.permitted.length === 8 && rep.sections.by_stage.proposed.length === 1, '4 stages: 8 permitted / under construction, 1 proposed / under review');
ok(rep.projects.filter((p) => (p.homesignal_detected_changes || []).some((c) => c.event_type === 'first_detected' && c.detected_at.startsWith('2026-10-04'))).length === 2, '5 two records first detected by HomeSignal on 2026-10-04');
ok(rep.projects.filter((p) => p.address === '3501 WELLNESS WAY').length === 5, '6 five commercial permits share one Wellness Way address (not five sites)');
ok(rep.projects.filter((p) => p.record_date && p.record_date.older_than_a_year).length === 2, '7 two records carry official dates older than a year');

const receipt = JSON.parse(rd('data/home-showcase/preview-receipt.json').toString('utf8'));
const view = readFileSync(join(root, 'lib/da-report-view.js'), 'utf8');
const qol = [...view.matchAll(/(?:infrastructure|commercial|residential|civic): '([^']+)'/g)].map((m) => m[1]);
for (const name of ['desktop', 'mobile']) {
  const t = receipt.frames[name].text;
  ok(qol.length >= 4 && ['infrastructure', 'residential', 'commercial', 'civic'].every((k) => t.includes(view.match(new RegExp(k + ": '([^']+)'"))[1])), '8 ' + name + ': all four Quality-of-Life sentences in the image are the view\'s own, word for word');
  ok(/9 official records within 0\.5 miles[^.]*8 permitted \/ under construction · 1 proposed \/ under review/.test(t) && /Showing 4 of the report’s 9 official records/.test(t), '9 ' + name + ': counts and the "4 of 9" disclosure are in the image');
  ok(!/Founder Test|\bct\b|@|Test Workspace/i.test(t), '10 ' + name + ': no test-account identity or email in the image text');
  ok(/Proposed \/ Under Review/.test(t) && /Permitted \/ Under Construction/.test(t), '11 ' + name + ': both stages shown with the report\'s own labels');
}
const idx = rd('index.html').toString('utf8');
ok(!/Founder Test Workspace|test workspace/i.test(idx + JSON.stringify(receipt)), '12 no internal test-account label on the homepage or in the receipt');
ok(/href="development-activity\.html">Explore Agent Reports →<\/a>/.test(idx), '13 the CTA and its destination are unchanged');
ok(!/verified (traffic|noise|air|water|soil)/i.test(idx), '14 the marketing copy claims no verified traffic, noise, air, water or soil effect');

const r = spawnSync('node', [join(root, 'scripts/build-home-showcase-preview.mjs'), '--check'], { encoding: 'utf8', cwd: root, timeout: 180000 });
ok(r.status === 0 && /PASS/.test(r.stdout), '15 --check re-renders the real view and reproduces the committed receipt text, kept rows and asset sizes', r.stdout + r.stderr);
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
