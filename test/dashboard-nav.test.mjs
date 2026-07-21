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

const dash = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
ok(/ZIP Score/.test(dash) && !/Community score/.test(dash),
  'dashboard uses ZIP Score label, not Community score');
ok(/Your ZIP Codes/.test(dash) && !/Your communities/.test(dash),
  'dashboard uses Your ZIP Codes heading');
ok(/Add a ZIP Code/.test(dash) || /zipLabels:\s*true/.test(dash),
  'dashboard ZIP add flow uses ZIP Code terminology');
ok(/statTileLink/.test(dash), 'dashboard stat tiles use statTileLink');
ok(/miniCardLink/.test(dash), 'dashboard recent cards use miniCardLink');
ok(/meetingRowLink/.test(dash), 'dashboard meetings use meetingRowLink');
ok(/itemClick:\s*onMarkerClick/.test(dash), 'dashboard map markers are clickable');
ok(/dashSidebar\.select/.test(dash), 'dashboard marker click opens sidebar');
ok(!/onclick="HS\.addHome\(\)"/.test(dash), 'dashboard add-place uses listener not inline onclick');

const shell = fs.readFileSync(new URL('../shell.js', import.meta.url), 'utf8');
ok(/HS\.pageHref/.test(shell), 'shell.js exposes pageHref');
ok(!/setTimeout\s*\(\s*applyFocus/.test(fs.readFileSync(new URL('../alerts.html', import.meta.url), 'utf8')),
  'alerts applyFocus runs synchronously after render');
ok(!/setTimeout\s*\(\s*function\s*\(\)\s*\{[^}]*zip-score-strip/s.test(fs.readFileSync(new URL('../community.html', import.meta.url), 'utf8')),
  'community focus=score scroll is immediate');

if (fails) { console.error('\n' + fails + ' assertion(s) failed'); process.exit(1); }
console.log('\nAll dashboard-nav assertions passed.');
