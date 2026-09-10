// Dashboard navigation — pageHref helpers + dashboard.html link contracts.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {
  pageHref,
  itemNavHref,
  meetingNavHref
} = require('../lib/view-zip.js');

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

ok(pageHref('development.html', { zip: '78617', sort: 'distance' }) === 'development.html?zip=78617&sort=distance',
  'pageHref carries zip + sort');
ok(pageHref('alerts.html', { zip: '78617', band: 'open' }) === 'alerts.html?zip=78617&band=open',
  'pageHref carries band=open for action windows');
ok(pageHref('community.html', { zip: '78617', focus: 'score' }) === 'community.html?zip=78617&focus=score',
  'pageHref carries focus=score for ZIP Score');
ok(pageHref('maps.html', { zip: '78617', place: 'prop-1' }) === 'maps.html?zip=78617&place=prop-1',
  'pageHref carries saved place id');

const proj = { id: 'proj-datacenter', type: 'Data center' };
ok(itemNavHref(proj, '78617') === 'development.html?zip=78617&id=proj-datacenter',
  'itemNavHref routes projects to development detail');

const alert = { id: 'chg-water', window_closes_at: '2099-01-01T00:00:00Z' };
ok(itemNavHref(alert, '78617').indexOf('band=open') > 0,
  'itemNavHref routes open-window alerts with band=open');

const mtg = { id: 'mtg-commissioners', related_project_id: 'proj-datacenter' };
ok(meetingNavHref(mtg, '78617', new Set(['proj-datacenter'])) === 'development.html?zip=78617&id=proj-datacenter',
  'meetingNavHref routes linked project meetings to development detail');

const mtgChg = { id: 'mtg-dvisd', related_project_id: 'chg-dvisd' };
ok(meetingNavHref(mtgChg, '78617').indexOf('alerts.html?zip=78617&id=chg-dvisd') === 0,
  'meetingNavHref routes change-linked meetings to alerts id');

const mtgBare = { id: 'mtg-x' };
ok(meetingNavHref(mtgBare, '78617') === 'alerts.html?zip=78617&category=Government+%26+civic',
  'meetingNavHref without related id uses civic category only');

const dashRaw = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
// ASSERT ON A COMMENT-STRIPPED COPY. These two checks name the very strings they forbid,
// so a `//` line that mentions "ZIP Score" in order to explain its removal would satisfy
// them from prose alone — which is exactly what happened when A-001 first landed: the
// tile was gone and the assertion still went green off a code comment. Same technique the
// generator gates already use.
const dash = dashRaw.replace(/^\s*\/\/.*$/gm, '');

// ---- A-001: the Portfolio Strip is EXACTLY the four locked portfolio metrics ----------
// ZIP-health is excluded by name: the score ring, component bars, value outlook and growth
// pressure live on authenticated /community/<zip>/ under A-022, and on today.html until
// A-020. Nothing may reintroduce them to this strip.
for (const label of ['Places Monitored', 'New Changes', 'Need Attention', 'Coming Up']) {
  ok(dash.includes("'" + label + "'"), 'A-001 Portfolio Strip carries ' + label);
}
ok(!/ZIP Score/.test(dash) && !/'Growth pressure'/.test(dash),
  'A-001 ZIP Score and Growth pressure are OUT of the Dashboard strip');
ok(!/scoreRing|scoreBars/.test(dash),
  'A-001 no ZIP-health visualization anywhere on Dashboard (A-022 owns it)');

// ---- A-002 (Dashboard half): one unified "Your Places" summary, two distinct TYPES -----
ok(/>Your Places</.test(dash), 'A-002 Dashboard shows one "Your Places" summary');
ok(!/Your Saved Places/.test(dash) && !/>Your ZIP Codes</.test(dash),
  'A-002 the separate Saved Places and ZIP Codes headings are merged away');
ok(/>Addresses</.test(dash) && />ZIP Codes</.test(dash),
  'A-002 Address and ZIP Code remain distinct types inside Your Places');
ok(/href="properties\.html"/.test(dash) && /id="dashZipOpen"/.test(dash),
  'A-002 both drill-downs survive: Manage -> properties.html, ZIP -> community.html');

// ---- A-003 .. A-009: the module names the frozen actions lock -------------------------
for (const [name, action] of [['Needs Your Attention', 'A-004'], ['Your Briefing', 'A-005'],
                              ['Recent Changes', 'A-006'], ['Worth Watching', 'A-007'],
                              ['Development Overview', 'A-008'], ['Intelligence Reports', 'A-009'],
                              ['Coming Up', 'A-003']]) {
  ok(dash.includes('>' + name + '<'), action + ' Dashboard module named exactly "' + name + '"');
}
ok(!/What's changing around you|Recent activity near you|Worth watching nearby|>Upcoming meetings</.test(dash),
  'A-006/A-007/A-008/A-003 the superseded module names are gone');
// A-007 boundary: discovery chips are links, never monitoring controls.
ok(!/dashWatch[\s\S]{0,400}?(toggleFollow|Notify me|Watch this)/.test(dash),
  'A-007 Worth Watching chips carry no follow/watch/notify control');
// A-009 boundary: surface the existing capability, invent no new one.
ok(!/text\/csv|\.pdf|localStorage\.setItem\('hs:reports/.test(dash),
  'A-009 no CSV, PDF or report persistence was invented');
// ⚠️ RETARGETED IN PHASE 8. This asserted `reports.html is still reachable, not retired`,
// which was true when A-009 shipped and is false BY DESIGN now: A-019 retired reports.html
// to a redirect stub once this module was proven to carry the capability. The real risk it
// guarded — the Reports capability silently disappearing — is now guarded better, by
// asserting the module is here AND that no designed CTA hops through the retired stub
// (which would be a redirect loop waiting to happen).
ok(/id="dashReports"/.test(dash) && /Intelligence Reports/.test(dash),
  'A-009 the Intelligence Reports module is still the Reports capability');
ok(!/reports\.html/.test(dash),
  'A-019 ...and Dashboard no longer routes anyone through the retired reports.html stub',
  (dash.match(/.{0,40}reports\.html.{0,40}/) || [])[0]);
ok(/Add a ZIP Code/.test(dash) || /zipLabels:\s*true/.test(dash),
  'dashboard ZIP add flow uses ZIP Code terminology');
ok(/statTileLink/.test(dash), 'dashboard stat tiles use statTileLink');
ok(/miniCardLink/.test(dash), 'dashboard recent cards use miniCardLink');
ok(/meetingRowLink/.test(dash), 'dashboard meetings use meetingRowLink');
ok(/itemClick:\s*onMarkerClick/.test(dash), 'dashboard map markers are clickable');
ok(!/onclick="HS\.addHome\(\)"/.test(dash), 'dashboard add-place uses listener not inline onclick');

const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/HS\.pageHref/.test(shell), 'shell.js exposes pageHref');
ok(!/setTimeout\s*\(\s*applyFocus/.test(fs.readFileSync(new URL('../alerts.html', import.meta.url), 'utf8')),
  'alerts applyFocus runs synchronously after render');
ok(!/setTimeout\s*\(\s*function\s*\(\)\s*\{[^}]*zip-score-strip/s.test(fs.readFileSync(new URL('../community.html', import.meta.url), 'utf8')),
  'community focus=score scroll is immediate');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll dashboard-nav assertions passed.');
