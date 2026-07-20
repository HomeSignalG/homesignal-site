// Alerts category filter tabs + sort control — static wiring guards.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const alerts = readFileSync(join(root, 'alerts.html'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

ok(/id="alFilter"/.test(alerts), 'alerts has category filter seg');
ok(/data-tab="gov"/.test(alerts) && /data-tab="meetings"/.test(alerts) && /data-tab="news"/.test(alerts),
  'alerts filter tabs cover gov, meetings, news');
ok(/Government Notices/.test(alerts) && /Upcoming Meetings/.test(alerts) && /Local News/.test(alerts),
  'alerts filter tab labels present');
ok(!/data-sort="impact"/.test(alerts) && !/By life impact/.test(alerts),
  'alerts removed legacy sort seg buttons');
ok(/id="alSortSelect"/.test(alerts) && /By urgency/.test(alerts) && /By date/.test(alerts) && /By distance/.test(alerts),
  'alerts has compact sort select');
ok(/resolveTab/.test(alerts) && /applyFocus/.test(alerts),
  'alerts preserves category deep-link helpers');
ok(/HS\.data\.meetings/.test(alerts), 'alerts loads meetings for meetings tab');
ok(/buildMeetingsPool|dedupeMeetings/.test(alerts), 'alerts merges meeting mirrors into meetings pool');
ok(/TAB_EMPTY/.test(alerts), 'alerts has per-tab empty state copy');

process.exit(fails ? 1 : 0);
