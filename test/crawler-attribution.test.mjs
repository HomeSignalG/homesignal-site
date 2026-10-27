// Crawlers are not visitors: the browser test (HS.CRAWLER_UA_RE in lib/data.js) and the database test
// (public.record_first_touch in docs/acquisition-attribution.sql) must be the SAME pattern, and must classify real
// user-agent strings correctly in both directions.
//
// WHY (2026-10-27 audit): 1,186 of 1,255 external first touches in acquisition_touch were single-hit, no-referrer
// landings on 828 different generated ZIP pages, and 0 became users. Rendering crawlers run our JavaScript but do not
// set navigator.webdriver, so the old guard let them through and every "visitors" number was mostly crawlers.
//
// Run: node test/crawler-attribution.test.mjs   (discovered by scripts/run-unit-tests.mjs)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, name, detail) => {
  console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail !== undefined ? '\n     ' + String(detail).slice(0, 800) : ''));
  if (!c) fails++;
};

const js = readFileSync(join(ROOT, 'lib/data.js'), 'utf8');
const sql = readFileSync(join(ROOT, 'docs/acquisition-attribution.sql'), 'utf8');

const jm = /HS\.CRAWLER_UA_RE = \/(.+)\/i;/.exec(js);
ok(!!jm, 'lib/data.js declares HS.CRAWLER_UA_RE');
const sm = /if v_ua ~\* '([^']+)' then return; end if;/.exec(sql);
ok(!!sm, 'record_first_touch refuses a crawler User-Agent');
if (!jm || !sm) { process.exit(1); }

// Postgres ARE \y is the word boundary JavaScript writes \b; JavaScript escapes / inside a regex literal.
const jsPattern = jm[1].replace(/\\\//g, '/');
const sqlPattern = sm[1].replace(/\\y/g, '\\b');
ok(jsPattern === sqlPattern, 'the browser and database patterns are the same', jsPattern + '\n     ' + sqlPattern);

// The database copy is checked by translating \y -> \b; this asserts the translation is the only difference.
const re = new RegExp(sqlPattern, 'i');
const CRAWLERS = [
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130.0.6723.69 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.69 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)',
  'AdsBot-Google (+http://www.google.com/adsbot.html)',
  'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  'Mozilla/5.0 (compatible; DuckDuckBot-Https/1.1; https://duckduckgo.com/duckduckbot)',
  'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'python-requests/2.32.3',
  'curl/8.5.0',
];
const PEOPLE = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Bluesky]',
];
for (const u of CRAWLERS) ok(re.test(u), 'crawler excluded: ' + u.slice(0, 90));
for (const u of PEOPLE) ok(!re.test(u), 'person kept: ' + u.slice(0, 90));

// Both capture paths ask the one helper.
ok(/function active\(\)[\s\S]{0,300}HS\.isCrawler\(\)/.test(js), 'the first-touch capture skips crawlers (HS.attr.active)');
ok(/HS\.logEvent = function[\s\S]{0,200}HS\.isCrawler\(\)/.test(js), 'the event logger skips crawlers (HS.logEvent)');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
