// HS.realHome() is the SINGLE source for "real home in the current ZIP".
// Run: node test/realhome.test.mjs
import { createRequire } from 'node:module';
const fs = createRequire(import.meta.url)('node:fs');
let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const base = new URL('../', import.meta.url);
// the map-anchor inline that used to be copy-pasted across dashboard + maps
const INLINE = /\.zip\s*===\s*S\.zip/;
for (const f of ['dashboard.html', 'maps.html', 'community.html', 'today.html', 'reports.html', 'alerts.html', 'properties.html']) {
  ok(!INLINE.test(fs.readFileSync(new URL(f, base), 'utf8')), `${f}: no inline real-home check (uses HS.realHome())`);
}
const shell = fs.readFileSync(new URL('shell.js', base), 'utf8');
const defs = (shell.match(/HS\.realHome\s*=\s*function/g) || []).length;
ok(defs === 1, `HS.realHome defined exactly once in shell.js (found ${defs})`);
ok(/!p\.demo/.test(shell), 'isRealHome excludes demo:true seed properties');
ok(/HS\.isRealHome\(p\)/.test(shell), 'realHome delegates to isRealHome');

if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nAll realHome single-source assertions passed.');
