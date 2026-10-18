// SEVERAL GOVERNMENTS ON ONE ZIP — how the topic picker files each pick (option 3, 2026-10-18).
// Run: node test/zip-government-picks.test.mjs
//
// The decision of WHICH governments cover a ZIP is public.zip_government_bodies (tested on a
// disposable Postgres in test/zip_government_bodies_pg). This file pins the page half: a
// county pick stays a plain label on the chain root, a city pick is filed on THAT city's
// community (delivery matches per community), news never moves off the root, and a ZIP with
// one government renders exactly as before.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
global.window = {};
require('../lib/topic-prefs.js');
const u = window.HS.topicPrefsUtil;

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = '00000000-0000-0000-0000-0000000000c1';
const TAC = '00000000-0000-0000-0000-0000000000a1';
const gov = {
  rootId: ROOT, measured: true,
  bodies: [
    { communityId: ROOT, kind: 'county', name: 'Pierce County', share: 0, measured: true, isRoot: true,
      notices: ['County Commission & county business'], meetings: ['County Commission & county business', 'Elections & voting'] },
    { communityId: null, kind: 'city', name: 'University Place', share: 0.6312, measured: true, isRoot: false, notices: [], meetings: [] },
    { communityId: TAC, kind: 'city', name: 'Tacoma', share: 0.1142, measured: true, isRoot: false,
      notices: ['City government (Tacoma)'], meetings: ['County Commission & county business', 'Elections & voting'] }
  ]
};

// 1 — keys
ok(u.pickKey(ROOT, 'Elections & voting', ROOT) === 'Elections & voting', '1a a root pick is the plain label (existing selections unchanged)');
ok(u.pickKey(TAC, 'Elections & voting', ROOT) === TAC + '|Elections & voting', '1b a city pick names its community');
ok(eq(u.splitPickKey(TAC + '|Elections & voting', ROOT), { communityId: TAC, topic: 'Elections & voting' }), '1c a city key splits back');
ok(eq(u.splitPickKey('Planning, zoning & development', ROOT), { communityId: ROOT, topic: 'Planning, zoning & development' }), '1d a plain label is the root\'s');
ok(eq(u.splitPickKey('Water | sewer', ROOT), { communityId: ROOT, topic: 'Water | sewer' }), '1e a "|" inside a plain label is not a community');

// 2 — filing
const prefs = {
  gov: { topics: ['County Commission & county business', TAC + '|City government (Tacoma)'] },
  meetings: { topics: [TAC + '|Elections & voting'] },
  news: { topics: ['Air Quality'] }
};
const split = u.splitPicksByCommunity(prefs, ROOT);
ok(eq(split[ROOT], { notices: ['County Commission & county business'], meetings: [], news: ['Air Quality'] }), '2a county picks and news stay on the root');
ok(eq(split[TAC], { notices: ['City government (Tacoma)'], meetings: ['Elections & voting'], news: [] }), '2b Tacoma\'s picks are filed on Tacoma');
ok(u.pickCount(split[TAC]) === 2 && u.pickCount(undefined) === 0, '2c pickCount');
const newsKeyed = u.splitPicksByCommunity({ news: { topics: [TAC + '|x'] } }, ROOT);
ok(eq(newsKeyed[ROOT].news, [TAC + '|x']) && !newsKeyed[TAC], '2d news is never filed on a city, whatever its key says');

// 3 — reading back
const rows = [
  { community_id: ROOT, stream: 'notices', topic: 'County Commission & county business', origin: 'explicit', sort_order: 1 },
  { community_id: TAC, stream: 'meetings', topic: 'Elections & voting', origin: 'explicit', sort_order: 1 },
  { community_id: TAC, stream: 'news', topic: 'Air Quality', origin: 'explicit', sort_order: 1 },
  { community_id: 'other', stream: 'meetings', topic: 'Elections & voting', origin: 'explicit', sort_order: 1 }
];
const q = u.qualifyBodyRows(rows, [TAC]);
ok(q.length === 1 && q[0].topic === TAC + '|Elections & voting', '3a only this ZIP\'s other governments, only notices/meetings, come back keyed');
ok(eq(u.topicPrefsFromCanonicalRows([rows[0]].concat(q)).meetings.topics, [TAC + '|Elections & voting']), '3b they round-trip into the picker\'s shape');
ok(eq(u.communitiesWithSelection(rows.concat([{ community_id: 'f', origin: 'follow_floor' }])), [ROOT, TAC, 'other']), '3c a follow is never counted as a selection');
ok(u.hadSelection([TAC], TAC) && !u.hadSelection(null, TAC), '3d hadSelection');

// 4 — picker groups
ok(u.topicGroupsFor(null, 'notices') === null, '4a no government read: the picker renders as before');
ok(u.topicGroupsFor({ rootId: ROOT, bodies: [gov.bodies[0]] }, 'notices') === null, '4b one government: the picker renders as before');
const gm = u.topicGroupsFor(gov, 'meetings');
ok(eq(gm.map((g) => g.name), ['Pierce County', 'University Place', 'Tacoma']), '4c one heading per government, county first, then cities as ordered');
ok(gm[2].items[0].key === TAC + '|County Commission & county business', '4d a city chip carries its community');
ok(gm[0].items[0].key === 'County Commission & county business', '4e a county chip is the plain label');
ok(/63% of this ZIP's land/.test(gm[1].note) && /not reading this city's meetings yet/.test(gm[1].note) && gm[1].items.length === 0,
  '4f a city with no source is shown, with its land share and an honest "not reading yet", and offers nothing to pick');
ok(/11% of this ZIP's land/.test(gm[2].note) && !/not reading/.test(gm[2].note), '4g a city with a source states its land share');
ok(!/resident|people|population/i.test(gm.map((g) => g.note).join(' ')), '4h shares are never called residents or population');
ok(/County government for all of this ZIP/.test(gm[0].note), '4i the county note says it governs the whole ZIP');
const noMeasure = u.topicGroupsFor({ rootId: ROOT, bodies: [Object.assign({}, gov.bodies[0], { share: null, measured: false }),
  Object.assign({}, gov.bodies[2], { share: null, measured: false })] }, 'notices');
ok(/not measured/.test(noMeasure[1].note) && !/%/.test(noMeasure[1].note), '4j a ZIP with no Census area says "not measured", never a percentage');

// 5 — the shell uses these, and reads the canonical functions (one truth path)
const shell = readFileSync(join(root, 'shell.js'), 'utf8');
const data = readFileSync(join(root, 'lib/data.js'), 'utf8');
ok(/util\.splitPicksByCommunity\(state\.topicPrefs, ct\.rootId\)/.test(shell), '5a persistSignup files picks by community');
ok(/p_community_id: id, p_topics:/.test(shell), '5b a city\'s picks are written on that city\'s community');
ok(/rpc\('clear_alert_selection'/.test(shell), '5c unticking every topic of one government clears only that government');
ok(/rpc\('zip_government_bodies'/.test(data) && /rpc\('zip_government_topics'/.test(data), '5d the page reads the two canonical functions');
ok(!/zcta_place_overlap/.test(data + shell), '5e the page never reads the overlap table itself');

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
