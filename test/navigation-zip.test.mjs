// NAV-01 regression — viewed ZIP survives shell navigation (lib/view-zip.js + shell.js
// contracts). Run: node test/navigation-zip.test.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { parseZipParam, resolveViewedZip, navHref, ZIP_NAV_PAGES } = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

const DEF = '78617';

// --- pure resolution (lib/view-zip.js) ---
ok(parseZipParam('?zip=84101') === '84101', 'parseZipParam reads ?zip=84101');
ok(parseZipParam('?zip=abc') === null, 'parseZipParam rejects non-5-digit');
ok(resolveViewedZip({ urlZip: '84101', sessionViewZip: '60601', defaultZip: DEF }) === '84101',
  'community.html?zip=84101 → URL zip wins (Maps navigation preserves 84101)');
ok(resolveViewedZip({ sessionViewZip: '84101', defaultZip: DEF }) === '84101',
  'signed-out session viewZip 84101 does not fall back to 78617');
ok(resolveViewedZip({ myZip: '90210', sessionViewZip: '84101', defaultZip: DEF }) === '90210',
  'saved myZip wins over session viewZip when URL has no ?zip=');
ok(resolveViewedZip({ urlZip: '84101', myZip: '90210', defaultZip: DEF }) === '84101',
  'explicit ?zip=84101 wins for this page load even when myZip is saved');
ok(resolveViewedZip({ defaultZip: DEF }) === DEF,
  'default remains 78617 when no viewed or saved ZIP exists');
ok(navHref('maps.html', '84101') === 'maps.html?zip=84101',
  'navHref carries zip on Maps link');

// --- shell.js wiring contracts ---
const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/sessionStorage\.setItem\('hs:' \+ k/.test(shell) || /SS\.set\('viewZip'/.test(shell),
  'shell.js persists session viewZip');
ok(/resolveViewedZip/.test(shell), 'shell.js calls resolveViewedZip at boot');
ok(/Object\.defineProperty\(state,\s*'zip'/.test(shell),
  'shell.js zip is a setter (community deep link + repaint)');
ok(/function paintNavHrefs/.test(shell), 'shell.js defines paintNavHrefs');
ok(/paintNavHrefs\(\)/.test(shell), 'shell.js calls paintNavHrefs from topbar');
ok(ZIP_NAV_PAGES.indexOf('maps.html') >= 0 && ZIP_NAV_PAGES.indexOf('development.html') >= 0,
  'ZIP_NAV_PAGES includes Maps and Development');
ok(/LS\.set\('myZip',\s*zip\)/.test(shell),
  'followCommunity still writes myZip (saved area unchanged by view-only browse)');
ok(/SS\.set\('viewZip'/.test(shell), 'viewZip stored in sessionStorage (not myZip)');
ok(!/LS\.set\('myZip'/.test(shell.match(/function captureUrlViewZip[\s\S]*?return z;\s*}/)?.[0] || 'x'),
  'captureUrlViewZip does not write myZip');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll navigation-zip assertions passed.');
