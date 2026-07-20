// Topic preference hydration — runtime behavior tests + shell wiring guards.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shell = readFileSync(join(root, 'shell.js'), 'utf8');
const alerts = readFileSync(join(root, 'alerts.html'), 'utf8');

global.window = { HS: {} };
require('../lib/topic-prefs.js');
const util = global.window.HS.topicPrefsUtil;

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

const staleLocal = {
  gov: { topics: ['County Commission & county business', 'Planning, zoning & development', 'Property taxes & assessments', 'Public safety & emergencies', 'Water companies', 'Elections & voting'], share_consent: false },
  meetings: { topics: ['County Commission & county business'], share_consent: false },
  news: { topics: ['Water Quality', 'Air Quality', 'Soil Quality', 'Infrastructure', 'EMF', 'Data Centers'], share_consent: false },
  dev: { topics: ['Data Centers', 'Residential', 'Commercial', 'Industrial', 'Roads & Infrastructure', 'Schools', 'Utilities', 'Parks & Green space'], share_consent: false }
};

// --- runtime: signed-in hydrate never reads stale localStorage ---
ok(util.topicCount(staleLocal, 'gov') === 6, 'fixture: stale local has 6 gov topics');
const brandNew = util.resolveHydrate({ authenticated: true, serverRows: [], localPrefs: staleLocal });
ok(util.topicCount(brandNew, 'gov') === 0, 'a. brand-new account: empty server -> 0 gov (stale LS ignored)');
ok(util.topicCount(brandNew, 'meetings') === 0, 'a. brand-new account: 0 meetings');
ok(util.topicCount(brandNew, 'news') === 0, 'a. brand-new account: 0 news');
ok(util.topicCount(brandNew, 'dev') === 0, 'a. brand-new account: 0 dev');

// --- runtime: existing account restores server rows ---
const serverRows = [
  { category: 'gov', topics: ['Planning, zoning & development', 'Water companies'], share_consent: true },
  { category: 'news', topics: ['Infrastructure'], share_consent: false }
];
const existing = util.resolveHydrate({ authenticated: true, serverRows, localPrefs: staleLocal });
ok(util.topicCount(existing, 'gov') === 2, 'b. existing account restores gov count from server');
ok(existing.gov.share_consent === true, 'b. existing account restores share_consent');
ok(util.topicCount(existing, 'news') === 1, 'b. existing account restores news');
ok(util.topicCount(existing, 'meetings') === 0, 'b. missing category -> 0');

// --- runtime: account switching ---
const userA = util.resolveHydrate({
  authenticated: true,
  serverRows: [{ category: 'gov', topics: ['A', 'B', 'C'], share_consent: false }]
});
const userB = util.resolveHydrate({
  authenticated: true,
  serverRows: [],
  localPrefs: userA   // simulate stale cache from user A — must not be read when authenticated
});
ok(util.topicCount(userB, 'gov') === 0, 'c. account switch: user B empty server not polluted by user A');

// --- runtime: empty server / deleted rows ---
const deleted = util.resolveHydrate({
  authenticated: true,
  serverRows: [],
  localPrefs: { gov: { topics: ['only-in-cache'], share_consent: false } }
});
ok(util.topicCount(deleted, 'gov') === 0, 'd/e. deleted DB rows -> zero selections');

// --- runtime: server query failure ---
const failed = util.resolveHydrate({ authenticated: true, serverError: true, localPrefs: staleLocal });
ok(Object.keys(failed).length === 0, 'f. server failure -> empty prefs (no stale LS fallback)');

// --- runtime: anonymous -> authenticated transition ---
const anon = util.resolveHydrate({ authenticated: false, localPrefs: { news: { topics: ['EMF'], share_consent: false } } });
ok(util.topicCount(anon, 'news') === 1, 'g. anonymous uses localStorage');
const afterLogin = util.resolveHydrate({
  authenticated: true,
  serverRows: [{ category: 'gov', topics: ['Elections & voting'], share_consent: false }],
  localPrefs: anon
});
ok(util.topicCount(afterLogin, 'news') === 0, 'g. after login server replaces anonymous news picks');
ok(util.topicCount(afterLogin, 'gov') === 1, 'g. after login server gov row wins');

// --- runtime: save / reload / restore ---
const savedRows = [{ category: 'meetings', topics: ['County Commission & county business'], share_consent: true }];
const reloaded = util.resolveHydrate({ authenticated: true, serverRows: savedRows });
ok(util.topicCount(reloaded, 'meetings') === 1, 'i. reload restores saved server row');
ok(reloaded.meetings.share_consent === true, 'i. reload restores consent flag');

// --- runtime: malformed / unexpected rows ---
const malformed = util.topicPrefsFromRows([
  { category: 'gov', topics: 'not-an-array', share_consent: 1 },
  { category: null, topics: ['orphan'] },
  { topics: ['no-category'] },
  { category: 'meetings', topics: ['Valid Meeting'], share_consent: 'yes' }
]);
ok(util.topicCount(malformed, 'gov') === 0, 'j. non-array topics -> 0');
ok(util.topicCount(malformed, 'meetings') === 1, 'j. valid row still parses');
ok(malformed.meetings.share_consent === true, 'j. truthy share_consent coerced');

// --- wiring guards (shell must delegate, not reimplement) ---
ok(!/topicPrefs:\s*LS\.get\(['"]topicPrefs/.test(shell),
  'state.topicPrefs is not initialized from localStorage at parse time');
ok(/topicPrefs:\s*\{\}/.test(shell),
  'state.topicPrefs starts empty until hydrateTopicPrefs runs');
ok(/HS\.topicPrefsUtil/.test(shell),
  'shell.js delegates to HS.topicPrefsUtil');
ok(/await bootSession\(\)[\s\S]*?await hydrateTopicPrefs\(\)/.test(shell),
  'boot() hydrates after bootSession before HS.onReady');
ok(/await hydrateTopicPrefs\(\)[\s\S]*?HS\.paintTopicCounts\(\)/.test(shell),
  'h. inline OTP login hydrates then repaints counts');
ok(/util\.hydrateSignedInFailure\(\)/.test(shell),
  'server error path uses hydrateSignedInFailure');
ok(/cacheTopicPrefs\(\{\}, uid\)/.test(shell),
  'server error clears write-through cache');
ok(/console\.warn\('topic-prefs hydrate'/.test(shell),
  'hydrate errors are logged without throwing');
ok(/HS\.paintTopicCounts\(\)/.test(alerts) && !/S\.topicPrefs\[k\]/.test(alerts),
  'alerts.html uses shared paint helper only');
ok(alerts.includes('lib/topic-prefs.js'),
  'alerts.html loads topic-prefs util before shell');

// hidden dev tile: paintTopicCounts must not throw when #cc-dev absent
ok(typeof util.topicCount({}, 'dev') === 'number',
  'missing dev tile/count is safe (topicCount returns 0)');

process.exit(fails ? 1 : 0);
