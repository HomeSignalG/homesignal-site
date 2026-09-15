// Local-News topic filtering (Phase B) — pure filter behavior + static wiring guards.
// Runs off-DOM: shims window.HS and loads lib/topic-prefs.js, exactly like
// topic-prefs-hydrate.test.mjs.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

global.window = { HS: {} };
require('../lib/topic-prefs.js');
const util = global.window.HS.topicPrefsUtil;

const dataJs = readFileSync(join(root, 'lib/data.js'), 'utf8');
const alerts = readFileSync(join(root, 'alerts.html'), 'utf8');
const migration = readFileSync(join(root, 'docs/local-news-subtopics-materialization.sql'), 'utf8');
const topics = readFileSync(join(root, 'topics.js'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// The 12 canonical labels (must be identical to topics.js::UNIVERSAL_TOPICS).
const TWELVE = [
  'Water Quality', 'Air Quality', 'Soil Quality', 'Animal & Human Viruses / Diseases',
  'Infrastructure', 'EMF', 'Noise Pollution', 'Light Pollution',
  'Livestock, Crops, Pets & Wildlife Health', 'Weather & Climate Hazards',
  'Radiation', 'Data Centers'
];

const story = (id, subs) => ({ id, category: 'Local News', title: id, subtopics: subs });

// ---- (item 1) each of the 12 canonical labels flows through the filter verbatim ----
(function () {
  let allFlow = true;
  TWELVE.forEach(function (label) {
    const items = [story('s', [label])];
    const got = util.filterNewsByTopics(items, [label]);
    if (got.length !== 1) allFlow = false;
    // and topics.js must contain the exact label (single vocabulary)
    if (topics.indexOf("'" + label + "'") === -1) allFlow = false;
  });
  ok(allFlow, 'all 12 canonical labels filter through verbatim and exist in topics.js');
})();

// ---- (item 4 / item 9) no saved selection -> ALL Local News (incl. untagged) ----
(function () {
  const items = [story('a', ['Water Quality']), story('b', []), story('c', null)];
  ok(util.filterNewsByTopics(items, []).length === 3, 'no selection ([]) shows all Local News');
  ok(util.filterNewsByTopics(items, null).length === 3, 'no selection (null) shows all Local News');
  ok(util.filterNewsByTopics(items, undefined).length === 3, 'no selection (undefined) shows all');
})();

// ---- (item 3) topic overlap filtering works ----
(function () {
  const items = [story('water', ['Water Quality']), story('air', ['Air Quality']), story('rad', ['Radiation'])];
  const got = util.filterNewsByTopics(items, ['Air Quality']);
  ok(got.length === 1 && got[0].id === 'air', 'overlap filter returns only the matching topic');
})();

// ---- (item 2) a multi-subtopic story appears when ANY selected topic matches ----
(function () {
  const items = [story('multi', ['Data Centers', 'Radiation', 'Water Quality'])];
  ok(util.filterNewsByTopics(items, ['Radiation']).length === 1, 'multi-topic story matches on one selected label');
  ok(util.filterNewsByTopics(items, ['Water Quality']).length === 1, 'multi-topic story matches on another selected label');
  ok(util.filterNewsByTopics(items, ['EMF']).length === 0, 'multi-topic story excluded when no selected label matches');
})();

// ---- (item 5) explicit selection HIDES nonmatching tagged stories ----
(function () {
  const items = [story('water', ['Water Quality']), story('air', ['Air Quality'])];
  const got = util.filterNewsByTopics(items, ['Water Quality']);
  ok(got.length === 1 && got[0].id === 'water', 'explicit selection hides nonmatching tagged stories');
})();

// ---- (item 6) untagged stories: shown with no filter, hidden once a filter is applied ----
(function () {
  const items = [story('tagged', ['Water Quality']), story('untagged', []), story('nullsub', null)];
  ok(util.filterNewsByTopics(items, []).length === 3, 'untagged shown when no filter applied');
  const got = util.filterNewsByTopics(items, ['Water Quality']);
  ok(got.length === 1 && got[0].id === 'tagged', 'untagged hidden once a topic filter is applied');
})();

// ---- newsFollows accessor ----
(function () {
  ok(util.newsFollows({ news: { topics: ['Radiation', 'EMF'] } }).length === 2, 'newsFollows reads the news tier');
  ok(util.newsFollows({}).length === 0, 'newsFollows empty prefs -> []');
  ok(util.newsFollows(null).length === 0, 'newsFollows null prefs -> []');
})();

// ---- static wiring guards ----
ok(/async news\(zip, home, follows\)/.test(dataJs), 'data.news() accepts a follows argument');
ok(/filterNewsByTopics/.test(dataJs), 'data.news() applies filterNewsByTopics');
ok(/HS\.data\.news\(S\.zip, home, newsFollows\)/.test(alerts), 'alerts.html passes the user\'s newsFollows into news()');
ok(/newsFollows\(S\.topicPrefs\)/.test(alerts), 'alerts.html derives follows from saved topicPrefs');

// ---- migration guards ----
ok(/add column if not exists subtopics text\[\]/.test(migration), 'migration adds app_changes.subtopics text[]');
ok(/lens, subtopics\)/.test(migration) && /'value', a\.subtopics/.test(migration),
  'migration materializer copies alerts.subtopics into the Local News insert');
ok((migration.match(/lens, subtopics\)/g) || []).length === 1,
  'ONLY the Local News insert gains subtopics (no other insert changed)');

process.exit(fails ? 1 : 0);
