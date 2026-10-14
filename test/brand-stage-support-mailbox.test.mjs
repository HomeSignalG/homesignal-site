// Step 16 audit F2: the Jody tree's customer-support mailbox is info@jodytracks.com on the contact + legal pages,
// not HomeSignal's hello@. Drives the shipped overlay over copies of the REAL pages.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const check = (n, c, d = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${c ? '' : '  ' + d}`); };
const PAGES = ['contact.html', 'privacy.html', 'terms.html', 'refund-policy.html'];
const tree = () => { const d = mkdtempSync(join(tmpdir(), 'bs-')); for (const p of PAGES) copyFileSync(join(root, p), join(d, p));
  writeFileSync(join(d, 'other.html'), '<p>noreply@homesignal.net and hello@homesignal.net</p>'); return d; };
const run = (d, id) => { const r = spawnSync('python3', ['-I', join(root, 'scripts/brand_stage.py'), '--dir', d, '--identity', id], { encoding: 'utf8' });
  return { status: r.status, rep: r.status === 0 ? JSON.parse(r.stdout.slice(0, r.stdout.lastIndexOf('}') + 1)) : null, err: r.stderr }; };

const d = tree(); const r = run(d, 'jody');
check('S0 overlay ran', r.status === 0, r.err);
for (const p of PAGES) {
  const t = readFileSync(join(d, p), 'utf8');
  check(`S1 ${p}: no hello@homesignal.net`, !t.includes('hello@homesignal.net'));
  check(`S2 ${p}: info@jodytracks.com present`, t.includes('info@jodytracks.com'));
}
const expect = PAGES.reduce((n, p) => n + (readFileSync(join(root, p), 'utf8').match(/hello@homesignal\.net/g) || []).length, 0);
check(`S3 count recorded (= ${expect} occurrences in the source pages)`, r.rep && r.rep.counts.support === expect && expect > 0, JSON.stringify(r.rep && r.rep.counts));
check('S4 other pages keep their mailboxes (rule is scoped)', readFileSync(join(d, 'other.html'), 'utf8').includes('hello@homesignal.net'));
check('S5 source pages are untouched by the overlay', readFileSync(join(root, 'contact.html'), 'utf8').includes('hello@homesignal.net'));
const d2 = tree(); const r2 = run(d2, 'homesignal');
check('S6 homesignal identity is a no-op', r2.status === 0 && readFileSync(join(d2, 'contact.html'), 'utf8').includes('hello@homesignal.net'));
const gen = readFileSync(join(root, 'scripts/gen-brand-origins.mjs'), 'utf8');
check('S7 mailbox equals gen-brand-origins REPLY_TO_BY_IDENTITY.jody', /jody:\s*'info@jodytracks\.com'/.test(gen));
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
