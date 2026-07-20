// Topic preference hydration: signed-in users must load app_topic_prefs from
// Supabase on boot/login — never treat stale device-global localStorage as truth.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shell = readFileSync(join(root, 'shell.js'), 'utf8');
const alerts = readFileSync(join(root, 'alerts.html'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// State must not be seeded from localStorage at parse time.
ok(!/topicPrefs:\s*LS\.get\(['"]topicPrefs/.test(shell),
  'state.topicPrefs is not initialized from localStorage at parse time');
ok(/topicPrefs:\s*\{\}/.test(shell),
  'state.topicPrefs starts empty until hydrateTopicPrefs runs');

ok(/async function hydrateTopicPrefs/.test(shell),
  'hydrateTopicPrefs exists');
ok(/from\(['"]app_topic_prefs['"]\)/.test(shell) && /\.select\(['"]category, topics, share_consent['"]\)/.test(shell),
  'hydrateTopicPrefs selects app_topic_prefs rows');
ok(/await hydrateTopicPrefs\(\)/.test(shell),
  'boot or auth awaits hydrateTopicPrefs');
ok(/await bootSession\(\)[\s\S]*?await hydrateTopicPrefs\(\)/.test(shell),
  'boot() hydrates topic prefs immediately after bootSession()');

// Signed-in path must not read stale LS as primary source.
ok(/state\.topicPrefs = topicPrefsFromRows/.test(shell),
  'signed-in hydrate builds prefs from server rows');
ok(/state\.topicPrefs = \{\}[\s\S]*?cacheTopicPrefs\(\{\}, uid\)/.test(shell),
  'empty server response clears prefs and cache (no stale LS fallback)');

// Anonymous visitors may still use localStorage.
ok(/state\.topicPrefs = LS\.get\(['"]topicPrefs['"]/.test(shell),
  'anonymous visitors load topicPrefs from localStorage');

ok(/function cacheTopicPrefs/.test(shell) && /topicPrefsUid/.test(shell),
  'cache is stamped with topicPrefsUid for account isolation');

ok(/HS\.paintTopicCounts\s*=\s*function/.test(shell),
  'HS.paintTopicCounts is exported from shell');
ok(/HS\.paintTopicCounts\(\)/.test(alerts),
  'alerts.html renders counts via HS.paintTopicCounts');
ok(/await hydrateTopicPrefs\(\)[\s\S]*?HS\.paintTopicCounts\(\)/.test(shell),
  'inline login re-paints counts after server hydrate');

ok(/function topicPrefsFromRows/.test(shell),
  'topicPrefsFromRows helper converts DB rows to state shape');

process.exit(fails ? 1 : 0);
