// The Development section's designed empty state (lib/coverage-copy.js developmentNone).
// Run: node test/development-none-state.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cc = require('../lib/coverage-copy.js');
const map = JSON.parse(readFileSync(new URL('../lib/generated/county-sources.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };
const text = (r) => r.lines.map((l) => l.label + ': ' + l.text).join('\n');

// Yakima County WA has no county-level feed; statewide feeds are the only ones named.
const yk = cc.developmentNone({ county: 'Yakima', state: 'WA', refreshedAt: '2026-11-26T05:00:00Z', map });
const t = text(yk);
ok(/Last refreshed: November 26, 2026/.test(t), 'date comes from the refreshedAt it is given');
ok(/Washington State Department of Ecology/.test(t) && /Washington State Department of Transportation/.test(t), 'names the statewide sources from the map');
ok((t.match(/Department of Transportation/g) || []).length === 1, 'three WSDOT layers are one body to the reader');
ok(/Yakima County's own permit and planning records aren't among our sources yet|have not identified a source/.test(t), 'states the gap as ours');
ok(!/checked .* found nothing|found no|nothing is happening|coming soon|refuses/i.test(t), 'makes none of the banned claims');

// A county WITH a local feed names it as local and still dedupes.
const th = text(cc.developmentNone({ county: 'Thurston', state: 'WA', refreshedAt: '2026-11-26T05:00:00Z', map }));
ok(/Thurston County, Washington/.test(th) && /plus .*statewide/.test(th), 'local feed named, statewide listed after it');

// Page data drives everything: another date and another county change the output.
const th2 = text(cc.developmentNone({ county: 'Thurston', state: 'WA', refreshedAt: '2026-01-02T12:00:00Z', map }));
ok(/January 2, 2026/.test(th2) && !/November 26/.test(th2), 'a different refresh date gives a different line');

// Fails closed: no map names no source; no/invalid date prints no date line.
const nomap = cc.developmentNone({ county: 'Yakima', state: 'WA', refreshedAt: 'not a date', map: null });
ok(!/Department of|Ecology|WSDOT/.test(text(nomap)) && !/Last refreshed/.test(text(nomap)), 'no map and a bad date: names no source and no date');
ok(/have not identified a source/.test(text(nomap)), 'still states the gap');

// No place or ZIP is typed into the module or the section.
const src = readFileSync(new URL('../lib/coverage-copy.js', import.meta.url), 'utf8');
ok(!/98904|98511|98013|Yakima|Tumwater/.test(src), 'no ZIP or place is hardcoded in the copy module');
const cp = readFileSync(new URL('../lib/community-page.js', import.meta.url), 'utf8');
ok(/developmentNone/.test(cp) && /devNoneBlock\(meta && meta\.county, meta && meta\.state, cov && cov\.refreshed_at/.test(cp), 'the community page passes the stored refresh date');
ok(/community\.html/.test('community.html') && /coverage-copy\.js/.test(readFileSync(new URL('../community.html', import.meta.url), 'utf8')), 'community.html loads the module');
ok(/covDevNone/.test(cp) && /coverage-limited/.test(cp) && /HS\.zipCoveragePanelHTML\(covHit\) \+ covDevNone/.test(cp), 'the coverage-limited panel prints the same lines right under the panel');
ok(/refreshed_at/.test(cp.slice(cp.indexOf('covDevNone = await'), cp.indexOf('covDevNone = await') + 260)), 'and takes the date from coverageState, never typed');
console.log(fails ? fails + ' FAILURE(S)' : 'ALL PASS');
process.exit(fails ? 1 : 0);
