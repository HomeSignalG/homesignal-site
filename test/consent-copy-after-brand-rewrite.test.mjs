// The consent sentence shown beside Save and the one recorded stay IDENTICAL after the deploy's brand rewrite.
// Run: node test/consent-copy-after-brand-rewrite.test.mjs   (python3; stages the real artifact, then applies brand_stage.py exactly as pages.yml does: the identity the brand contract publishes)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const base = mkdtempSync(join(tmpdir(), 'consent-brand-'));
const st = join(base, 'st'), j = join(base, 'j');
execFileSync('python3', ['scripts/stage_site.py', '--src', '.', '--out', st], { stdio: 'pipe' });
cpSync(st, j, { recursive: true });
const identity = execFileSync('python3', ['scripts/brand_host.py', '--identity'], { encoding: 'utf8' }).trim();
const r = spawnSync('python3', ['scripts/brand_stage.py', '--dir', j, '--identity', identity], { encoding: 'utf8' });
ok(identity === 'jody', 'the published identity is jody, so the overlay really rewrites (' + identity + ')');
ok(r.status === 0, 'brand overlay exits 0 on the real staged tree ' + (r.status ? r.stderr : ''));
const pick = (dir, re) => (readFileSync(join(dir, 'shell.js'), 'utf8').match(re) || [])[1];
const CONSENT = /const CONSENT_COPY = '([^']+)'/, VER = /const CONSENT_VERSION = '([^']+)'/;
const AREA = /const AREA_CONSENT_COPY = '([^']+)'/, AVER = /const AREA_CONSENT_VERSION = '([^']+)'/;
const sentence = 'Email me JODY alerts for the topics I selected. Alerts start only where verified coverage exists. No spam · Unsubscribe anytime.';
for (const [label, dir] of [['staged (homesignal source)', st], ['deployed (jody rewrite)', j]]) {
  const js = readFileSync(join(dir, 'shell.js'), 'utf8');
  ok(pick(dir, CONSENT) === sentence, label + ': CONSENT_COPY is the approved sentence, "JODY" untouched');
  ok(pick(dir, VER) === '2026-11-27', label + ': CONSENT_VERSION 2026-11-27');
  ok(/p_marketing_consent_copy: CONSENT_COPY/.test(js), label + ': the save records CONSENT_COPY');
  ok(/n\.textContent = CONSENT_COPY/.test(js) && /id="finishConsent">' \+ HS\.esc\(CONSENT_COPY\)/.test(js), label + ': picker note and Finish box both show CONSENT_COPY');
  ok(/id="tmConsentCopy"/.test(readFileSync(join(dir, 'partials/shell.html'), 'utf8')), label + ': the picker has the slot that is filled with it');
  ok(!/HomeSignal|Jody alerts/.test(pick(dir, CONSENT)), label + ': no brand word in the sentence changed');
}
// Area opt-in: untouched by this PR, so the rewrite must treat it as before, and copy and version stay together.
const a0 = pick(st, AREA), a1 = pick(j, AREA);
ok(pick(st, AVER) === '2026-07-16' && pick(j, AVER) === '2026-07-16', 'area opt-in version is still 2026-07-16 in both trees');
ok(a0 === 'Email me new development & hearing alerts for this ZIP. No spam · unsubscribe anytime.', 'area opt-in copy is unchanged in the source');
ok(/topics, AREA_CONSENT_VERSION, AREA_CONSENT_COPY/.test(readFileSync(join(st, 'shell.js'), 'utf8')) && /topics, AREA_CONSENT_VERSION, AREA_CONSENT_COPY/.test(readFileSync(join(j, 'shell.js'), 'utf8')), 'area opt-in sends its own version with its own copy in both trees');
ok(a1 === a0, 'the rewrite leaves the area copy as it was');
process.exit(fails ? 1 : 0);
