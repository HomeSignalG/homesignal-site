// Upcoming Meetings — canonical-topic grouping + tier-union fan-out (Box Elder pilot).
//
// Contract: homesignal-ingest docs/0001UpcomingMeetings.IngestFeed.Workbook.xlsx,
// Instructions §3/§4. Meetings render as their own card type on the Alerts page, grouped
// by the SAME 6 canonical topics as Government Notices, from a LIVE read of `meetings`
// (no materializer).
//
// The regression this pins: normMeeting() dropped `category`, so
// alerts.html::meetingAsChange fell through to its `|| 'Upcoming Meetings'` default and
// EVERY meeting collapsed into one generic group — the 6 topic headings never appeared,
// no matter how correct the ingest-side categories were.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = readFileSync(join(root, 'lib/data.js'), 'utf8');
const alerts = readFileSync(join(root, 'alerts.html'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// --- normMeeting keeps the fields the topic grouping and the venue/mode chips need ---
const norm = /function normMeeting\(m\)\s*\{[\s\S]*?\n  \}/.exec(data);
ok(!!norm, 'lib/data.js defines normMeeting');
const body = norm ? norm[0] : '';
ok(/category:\s*m\.category/.test(body),
  'normMeeting passes category through (alerts.html groups the Meetings tab on it)');
ok(/location:\s*m\.location/.test(body), 'normMeeting passes location through');
ok(/attendance_mode:\s*m\.attendance_mode/.test(body),
  'normMeeting passes attendance_mode through (in_person | video | hybrid | null)');
ok(/starts_at:\s*m\.meeting_date/.test(body), 'normMeeting maps meeting_date -> starts_at');

// --- the meetings() read: tier union + upcoming-only + date order ---
const fn = /async meetings\(zip, home\)\s*\{[\s\S]*?\n    \},/.exec(data);
ok(!!fn, 'lib/data.js defines HS.data.meetings');
const q = fn ? fn[0] : '';
ok(/const ids = \[c\.id\]/.test(q), 'the union starts with the ZIP\'s OWN community');
ok(/while \(up && up\.parent_id/.test(q) && /ids\.push\(up\.parent_id\)/.test(q),
  'the union walks the FULL parent_id chain up to the county root, not one hop');
ok(/hops\+\+ < 6/.test(q), 'the chain walk is cycle-capped');
ok(/from\('meetings'\)[\s\S]*\.in\('community_id', ids\)/.test(q),
  'the query filters on the whole ancestor id set');
ok(/\.gte\('meeting_date', new Date\(\)\.toISOString\(\)\)/.test(q),
  'only UPCOMING meetings (meeting_date >= now())');
ok(/\.order\('meeting_date', \{ ascending: true \}\)/.test(q),
  'ordered by meeting_date ascending (soonest first)');

// --- the Alerts page groups meeting cards by that category ---
ok(/category: m\.category \|\| 'Upcoming Meetings'/.test(alerts),
  'alerts.html::meetingAsChange keys the group heading on the meeting category');
ok(/groups\[ch\.category\]/.test(alerts),
  'alerts.html groups rendered cards by category');

// --- the 6 canonical topics, verbatim (never paraphrase — see wiring rule 3) ---
const CANONICAL = [
  'County Commission & county business',
  'Planning, zoning & development',
  'Property taxes & assessments',
  'Public safety & emergencies',
  'Water districts & utilities',
  'Elections & voting'
];
const topics = readFileSync(join(root, 'topics.js'), 'utf8');
const seedish = topics + data;
CANONICAL.forEach((t) => {
  // The site must not have drifted the strings the ingest engine writes.
  const bad = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, 'and'));
  ok(!bad.test(seedish), 'no "and"-paraphrase of the canonical topic: ' + t);
});

process.exit(fails ? 1 : 0);
