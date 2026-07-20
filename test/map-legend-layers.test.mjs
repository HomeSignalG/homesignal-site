// Regression: the redundant "Projects" show-on-map toggle must stay removed.
// maps.html is the ONE shared template for every ZIP's app map (?zip=), so this
// pins the legend for all current and future ZIP pages.
// Run: node test/map-legend-layers.test.mjs
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const html = readFileSync(new URL('../maps.html', import.meta.url), 'utf8');

const layers = html.match(/<div class="layers">[\s\S]*?<\/div>\s*<\/div>/);
ok(!!layers, '"Show on Map" layers block exists in maps.html');

const block = layers ? layers[0] : '';
ok(/Show on Map/i.test(block), '"Show on Map" heading is present');
ok(!/id="lyrProjects"/.test(html), 'no lyrProjects toggle element');
ok(!/showProjects/.test(html), 'no showProjects state or wiring');
ok(!/<div class="lyr"[^>]*>\s*<span>Projects<\/span>/.test(block),
  'no Projects row under "Show on Map"');
ok(/id="lyrRadius"/.test(html) && /Radius ring/.test(html),
  'Radius ring toggle remains under "Show on Map"');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll map-legend-layers assertions passed.');
