// "Last updated" at phone width (390x844). The three browser tests read HS_VIEWPORT; this runs each of them at the
// phone size, so the date on static ZIP and city cards, dynamic ZIP cards, and Map 1 pop-ups and list rows is checked
// there too, not only on the desktop.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
let bad = 0;
for (const f of ['last-updated-static', 'community-card-links', 'map1-project-page-link']) {
  const r = spawnSync(process.execPath, [join(here, f + '.browser.test.mjs')], { env: { ...process.env, HS_VIEWPORT: '390x844' }, encoding: 'utf8', timeout: 240000 });
  const tail = (r.stdout || '').trim().split('\n').slice(-1)[0];
  console.log(`${r.status === 0 ? 'PASS' : 'FAIL'} ${f} at 390x844 — ${tail}`);
  if (r.status !== 0) { bad += 1; console.log((r.stdout || '').slice(-1500), (r.stderr || '').slice(-500)); }
}
console.log(bad ? `\n${bad} FAILED` : '\nALL PASS');
process.exit(bad ? 1 : 0);
