// supabase-js is loaded from a CDN by every page. It is pinned to ONE exact version with an integrity hash
// (founder, 2026-10-08: "lock every page to one exact, checked version"). scripts/supabase-js-pin.json is the one record
// of that version and hash; this test fails when any shipped page disagrees with it, when a page loads the floating "@2",
// or when the pin is missing an attribute the browser needs to enforce it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let n = 0, bad = 0;
const ok = (c, m, d) => { n++; if (c) console.log('PASS — ' + m); else { bad++; console.log('FAIL — ' + m + (d !== undefined ? '  [' + JSON.stringify(d) + ']' : '')); } };

const pin = JSON.parse(read('scripts/supabase-js-pin.json'));
ok(/^\d+\.\d+\.\d+$/.test(pin.version) && pin.url === 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@' + pin.version && /^sha384-[A-Za-z0-9+/]{64}$/.test(pin.integrity),
  '1a the pin record is an exact x.y.z version, its own URL, and a sha384 value', pin);

const files = [];
(function walk(d) {
  for (const e of readdirSync(join(root, d))) {
    if (['node_modules', '.git', 'docs', 'test', 'dist', 'fixtures'].includes(e)) continue;
    const rel = d ? d + '/' + e : e, st = statSync(join(root, rel));
    if (st.isDirectory()) walk(rel);
    else if (/\.(html|py|js|mjs)$/.test(e)) files.push(rel);
  }
})('');
const TAG = /<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]*)"([^>]*)><\/script>/g;
const seen = [];
for (const f of files) for (const m of read(f).matchAll(TAG)) seen.push({ f, url: m[1], rest: m[2] });
ok(seen.length >= 19, '2a (control) the walk finds the supabase-js tags: pages and the ZIP-page generator (' + seen.length + ' found)', seen.length);
ok(seen.every((t) => t.url === pin.url), '2b every tag loads the pinned URL, none loads the floating "@2"', seen.filter((t) => t.url !== pin.url).map((t) => t.f));
ok(seen.every((t) => t.rest === ' integrity="' + pin.integrity + '" crossorigin="anonymous"'), '2c every tag carries the pinned integrity value and crossorigin="anonymous" (without it the browser ignores the hash)', seen.filter((t) => t.rest !== ' integrity="' + pin.integrity + '" crossorigin="anonymous"').map((t) => t.f));
ok(!files.some((f) => /supabase-js@2["'`)]/.test(read(f))), '2d no shipped file names the floating "supabase-js@2" anywhere', files.filter((f) => /supabase-js@2["'`)]/.test(read(f))));

// the browser suites' page reader strips the integrity from that one tag and nothing else
const { readFile } = await import('./lib/serve-page.mjs');
const page = (await readFile(join(root, 'about.html'))).toString('utf8');
ok(page.includes('<script src="' + pin.url + '"></script>') && !page.includes('integrity="' + pin.integrity + '"'), '3a the test page reader serves a page without the hash, so a stand-in file can be used', null);
const real = read('about.html');
ok(real.includes('integrity="' + pin.integrity + '"'), '3b the shipped page itself still carries the hash', null);
console.log('\n' + (n - bad) + ' passed, ' + bad + ' failed of ' + n);
process.exit(bad ? 1 : 0);
