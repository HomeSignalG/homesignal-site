// SOURCE FRESHNESS (founder, 2026-11-01). Offline: no network, no database.
// Pins the wording rules and the wiring:
//   * the newest record date and the last successful source check are two separate lines;
//   * a successful read elsewhere never stands for this ZIP (the ZIP line reads only this ZIP's state);
//   * nothing is ever called current / up to date / stale;
//   * coverage limitations (Portland: residential only) are shown, and only for real registry ids;
//   * both pages mount the block; the SQL keeps its locks, grants and rollback.
// Run: node test/source-freshness.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let fails = 0;
const ok = (c, name, detail) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name + (!c && detail ? '\n     ' + detail : '')); if (!c) fails++; };

const win = {};
vm.runInNewContext(read('lib/templates.js'), { window: win, document: undefined, console });
const HS = win.HS;
ok(typeof HS.sourceFreshnessEntries === 'function' && typeof HS.sourceFreshnessHTML === 'function'
  && typeof HS.mountSourceFreshness === 'function', 'templates.js exports the source freshness helpers');

// The production values measured 2026-11-01 (read-only): Portland newest 2026-10-01, last completed read
// 2026-11-01 05:32Z; ODOT STIP records carry only planned dates, so newest is null.
const ROWS = [
  { registry_id: 'portland-building-permits', newest_record_date: '2026-10-01', last_success_at: '2026-11-01T05:32:00+00:00',
    zip_read_state: 'complete', zip_last_read_at: '2026-11-01T05:32:00+00:00', zip_failing_since: null },
  { registry_id: 'oregon-dot-stip-projects', newest_record_date: null, ledger_records: 113, last_success_at: '2026-10-31T20:10:00+00:00',
    zip_read_state: 'failing', zip_last_read_at: '2026-10-31T17:08:00+00:00', zip_failing_since: '2026-10-31T17:08:00+00:00' },
  { registry_id: 'oregon-dot-stip-projects-lines', newest_record_date: null, last_success_at: null,
    zip_read_state: 'not_read', zip_last_read_at: null, zip_failing_since: null }
];
const LABELS = { 'portland-building-permits': 'City of Portland',
  'oregon-dot-stip-projects': 'Oregon Department of Transportation (ODOT)',
  'oregon-dot-stip-projects-lines': 'Oregon Department of Transportation (ODOT)' };

const E = HS.sourceFreshnessEntries(ROWS, LABELS);
const byId = Object.fromEntries(E.map((e) => [e.id, e]));
const pdx = byId['portland-building-permits'];

// 1. Requirement 1: Portland's exact line, and the two dates kept apart.
const pdxLines = HS.sourceFreshnessLines(pdx, true);
ok(pdxLines[0] === 'Latest available Portland permit record: October 1, 2026', 'Portland: newest record line, founder wording',
  pdxLines[0]);
ok(pdxLines[1] === 'Last successful source check: November 1, 2026 (any ZIP)', 'Portland: last successful check is its own line', pdxLines[1]);
ok(pdxLines[2] === 'This ZIP: last read of this source completed November 1, 2026', 'Portland: this ZIP has its own line', pdxLines[2]);
ok(pdx.scope === 'Residential building permits only', 'Portland: residential-only limitation is carried');

// 2. Requirement 2: a successful read elsewhere never stands for this ZIP.
const odot = byId['oregon-dot-stip-projects'];
const odotLines = HS.sourceFreshnessLines(odot, true);
ok(/^Last successful source check: October 31, 2026 \(any ZIP\)$/.test(odotLines[1]), 'ODOT: source-wide success is labelled any ZIP');
ok(/^This ZIP: the latest read of this source did not complete \(since October 31, 2026\)\. Records shown here are from an earlier read\.$/.test(odotLines[2]),
  'ODOT: this ZIP says its own read did not complete, despite a success elsewhere', odotLines[2]);
const notRead = HS.sourceFreshnessLines(byId['oregon-dot-stip-projects-lines'], true);
ok(notRead[2] === 'This ZIP: not read from this source.', 'not read here says so');
ok(notRead[1] === 'Last successful source check: not recorded yet (any ZIP)', 'no completed read anywhere: not recorded yet');
for (const st of ['not_reported', 'retired']) {
  const l = HS.sourceFreshnessLines(Object.assign({}, pdx, { zipState: st }), true)[2];
  ok(/^This ZIP: /.test(l) && !/completed/.test(l), st + ': never reads as completed', l);
}
// Without a ZIP (Map 1 address mode) no ZIP line and no "any ZIP" qualifier is written.
const addr = HS.sourceFreshnessLines(pdx, false);
ok(addr.length === 2 && !addr.some((l) => /ZIP/.test(l)), 'no ZIP given: no ZIP claim at all');

// 3. Requirement 3: never "current", "up to date", "fresh" or "stale".
const html = HS.sourceFreshnessHTML(E, { zip: '97202' });
const visible = html.replace(/<[^>]*>/g, ' ');
ok(!/\b(current|currently|up to date|up-to-date|fresh|stale|latest data|live)\b/i.test(visible),
  'the block never calls data current, fresh, live or stale', (visible.match(/\b(current|up to date|fresh|stale|live)\b/i) || [])[0]);
ok(/A recent check does not mean the source has newer records\./.test(visible), 'the block says a recent check is not newer data');
ok(!/no filing or issue date|not measured/.test(HS.sourceFreshnessLines(pdx, true).join(' ')), 'a dated source is never described as undated');
ok(odotLines[0] === "Latest available record: not shown, because this source's records do not state a filing or issue date",
  'a source whose records carry only planned dates shows no record date, and says why', odotLines[0]);
ok(notRead[0] === 'Latest available record: not measured yet', 'a source not yet measured says so, never that it publishes no dates', notRead[0]);

// 4. Requirement 4 + #2487: duplicate labels are told apart; unknown labels never print "undefined".
ok(byId['oregon-dot-stip-projects'].name !== byId['oregon-dot-stip-projects-lines'].name, 'two sources with one label get different names');
const nolabel = HS.sourceFreshnessEntries([{ registry_id: 'portland-neighborhood-contact-applications' }], {});
ok(nolabel[0].name === 'Portland neighborhood contact applications' && !/undefined|null/.test(HS.sourceFreshnessHTML(nolabel, {})),
  'a source with no label is named by its id, never "undefined"');
const two = HS.sourceFreshnessEntries([{ registry_id: 'portland-building-permits' }, { registry_id: 'portland-neighborhood-contact-applications' }],
  { 'portland-building-permits': 'City of Portland', 'portland-neighborhood-contact-applications': 'City of Portland' });
ok(two.map((e) => e.name).join(' | ') === 'City of Portland (building permits) | City of Portland (neighborhood contact applications)',
  'the two City of Portland sources from #2487 are told apart by the words not already in the label', two.map((e) => e.name).join(' | '));
const tig = HS.sourceFreshnessEntries([{ registry_id: 'tigard-or-active-building-permits' }, { registry_id: 'tigard-or-active-planning-cases' }],
  { 'tigard-or-active-building-permits': 'City of Tigard, Oregon', 'tigard-or-active-planning-cases': 'City of Tigard, Oregon' });
ok(tig.map((e) => e.name).join(' | ') === 'City of Tigard, Oregon (active building permits) | City of Tigard, Oregon (active planning cases)',
  'Tigard (#2487): two-letter state codes are dropped from the distinguishing words', tig.map((e) => e.name).join(' | '));
ok(odot.name === 'ODOT Statewide Transportation Improvement Program (project points)' && odot.scope === 'State transportation projects only',
  'ODOT carries its reviewed name and scope');
ok(HS.sourceFreshnessHTML([], {}) === '', 'nothing to show renders nothing');
ok(!/<img|<script/i.test(HS.sourceFreshnessHTML(HS.sourceFreshnessEntries(
  [{ registry_id: 'x-y' }], { 'x-y': '<img src=x onerror=alert(1)>' }), {})), 'labels are escaped');

// Reviewed coverage notes name real registry ids only.
const REG = JSON.parse(read('supabase/functions/get-address-report/jurisdiction-registry.json'));
const regIds = new Set(Object.entries(REG).filter(([k]) => !k.startsWith('_')).flatMap(([, l]) => l.map((e) => e.registry_id)));
for (const id of Object.keys(HS.SOURCE_RECORD_SCOPE)) {
  ok(regIds.has(id), 'coverage note key is a registry id: ' + id);
  ok(!!HS.SOURCE_RECORD_SCOPE[id].evidence, 'coverage note carries its evidence: ' + id);
}

// ids helper
ok(JSON.stringify(HS.sourceFreshnessIds([{ source_registry_id: 'b-x' }, { registry_id: 'a-x' }, { zip_authoritative: true, src: 'c-x' },
  { src: 'EPA FRS · registry 1' }, { registry_id: 'Bad Id' }])) === JSON.stringify(['a-x', 'b-x', 'c-x']),
  'ids come from development records only; EPA labels and malformed ids are ignored');

// 5. Wiring.
const map1 = read('homesignalmap.html');
ok(/<div id="srcFresh"><\/div>\s*<div class="foot" id="foot">/.test(map1), 'Map 1 has the block above its footer');
ok(/HS\.mountSourceFreshness\(\$\("srcFresh"\), \{ zip: ZIP_MODE \? ZIP_CODE : null, ids: HS\.sourceFreshnessIds\(sites\) \}\)/.test(map1),
  'Map 1 mounts from the rendered sites, with a ZIP only in ZIP mode');
const cp = read('lib/community-page.js');
ok(/<div id="dev-source-freshness"><\/div>/.test(cp) && /HS\.mountSourceFreshness\(document\.getElementById\('dev-source-freshness'\),\s*\{ zip: zip, ids: HS\.sourceFreshnessIds\(projects\)/.test(cp),
  'the ZIP page mounts for its ZIP and its development records');
const data = read('lib/data.js');
ok(/rpc\('source_freshness_for_zip', \{ p_zip: z, p_ids: ids \}\)/.test(data), 'data.js reads the one reader function');
ok(/if \(rpc\.error \|\| !Array\.isArray\(rpc\.data\)\) return null;/.test(data), 'a failed read returns null (nothing shown)');
ok(!/dev_source_freshness'/.test(data), 'the page never reads the table directly');

// 6. SQL shape (the behaviour is proven in test/source_freshness_pg).
const sql = read('docs/source-freshness.sql');
ok(/pg_try_advisory_xact_lock\(hashtext\('public\.dev_source_freshness_refresh'\)\)/.test(sql), 'refresh takes a try-lock (no overlapping runs)');
ok(/set statement_timeout = '120s'/.test(sql), 'refresh has a time limit');
ok(/revoke all on function public\.dev_source_freshness_refresh\(\) from public, anon, authenticated;/.test(sql), 'refresh revoked from anon and authenticated by name');
ok(/revoke all on public\.dev_source_freshness from public, anon, authenticated;/.test(sql) && !/grant select on public\.dev_source_freshness/.test(sql),
  'the table has no visitor grant');
ok(/perform cron\.unschedule\(jobid\) from cron\.job where jobname = 'dev-source-freshness';/.test(sql), 'cron schedule is replay-safe');
ok(/'filed', 'issued', 'decided', 'awarded', 'completed'/.test(sql) && !/'scheduled'|'estimated'/.test(sql.replace(/--.*$/gm, '')),
  'only dates that record an event count as a record date');
ok(!/portland|oregon|97\d{3}/i.test(sql.replace(/--.*$/gm, '')), 'the SQL names no source or ZIP');
const rb = read('docs/source-freshness.rollback.sql');
ok(/drop function if exists public\.source_freshness_for_zip\(text, text\[\]\)/.test(rb) && /drop function if exists public\.dev_source_freshness_refresh\(\)/.test(rb)
  && /drop table if exists public\.dev_source_freshness/.test(rb) && /cron\.unschedule/.test(rb), 'rollback removes all four objects');

console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
