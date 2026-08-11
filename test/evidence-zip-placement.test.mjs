// PHASE 6 — authoritative ZIP placement contract guards.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'docs/evidence-phase1-migration.sql'), 'utf8');
const p6 = sql.slice(sql.indexOf('PHASE 6 ADDITIONS'));
const community = readFileSync(join(root, 'community.html'), 'utf8');
let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + n); if (!c) fails++; };

ok(p6.length > 1200, 'Phase 6 section of the SQL of record loaded');

// ---- the audit finding, recorded ----
ok(/HomeSignal has NO ZIP\/ZCTA polygon table/.test(p6), 'the missing-boundary-table audit is recorded');
ok(/ZCTA IS NOT A USPS ZIP/.test(p6), 'the ZCTA vs USPS ZIP distinction is explicit');
ok(/never labelled "USPS verified"/.test(p6), 'the doc explicitly forbids the USPS-verified label');

// ---- placement is evidence with provenance ----
ok(/located_in_zip/.test(p6) && /has_reported_zip/.test(p6),
  'spatial containment and source-reported ZIP are separate predicates (§9)');
ok(/ST_PointOnSurface/i.test(p6), 'the representative-point rule is documented');
ok(/vintage/i.test(p6), 'boundary vintage is stored (§25)');
ok(/computed ONCE per parcel and stored, never per page/i.test(p6), 'assignment is precomputed (§27)');

// ---- nearest-centroid is gone ----
ok(/nearest-modeled-centroid is GONE as a placement rule/.test(p6), 'the workaround was removed');
ok(/No nearest-neighbour tier at any level/.test(p6), 'no nearest-neighbour tier survives');
ok(!/order by st_setsrid\(st_point\(d\.home_lng/i.test(p6), 'no nearest-centroid ordering remains in the rule');

// ---- fallback hierarchy documented ----
ok(/1\. located_in_zip/.test(p6) && /2\. has_reported_zip/.test(p6) && /3\. otherwise unresolved/.test(p6),
  'the placement hierarchy is documented and terminates in unresolved');

// ---- evidence-only ZIP ----
ok(/routable as PURE DATA — one communities row/.test(p6), '80249 is routable as pure data');
ok(/NO development_reports row is fabricated/.test(p6), 'no fake development record was created');
ok(/GENERIC routability/.test(p6) && /No ZIP is named in code/.test(p6), 'routability is generic');

// ---- coverage language (§13) ----
ok(/UNKNOWN development coverage/.test(p6) || /not_yet_available/.test(p6),
  'unmodeled coverage is a distinct state');
ok(/not yet available for this ZIP/.test(community), 'the page says coverage is unavailable');
ok(/different from having checked development sources and found nothing/.test(community),
  'coverage-unavailable is explicitly distinguished from a verified negative');
ok(!/No development records found/.test(community), 'never asserts a verified negative for an unmodeled ZIP');

// ---- no ZIP-specific frontend code (§14/§15) ----
// scope to the evidence integration block: the legacy page has a pre-existing 78617
// comment about the fictional demo home, which is not evidence-placement code.
const evBlock = community.slice(community.indexOf('/* PHASE 5'), community.indexOf('<script src="evidence-card.js">'));
ok(evBlock.length > 500, 'evidence integration block located');
ok(!/80249|80239|78617/.test(evBlock), 'the evidence integration code names no ZIP');
ok(!/18581|Caldwell|Green Valley|River Bottoms|Neuralink/.test(community),
  'community.html names no address or company');

// ---- §16 batching preserved ----
ok((community.match(/ev_evidence_available/g) || []).length === 1, 'one availability call site');
ok((community.match(/ev_zip_is_routable/g) || []).length === 1, 'one routability call site');
ok((community.match(/rpc\('ev_property_card'/g) || []).length === 1, 'one lazy full-card call site');
ok(/if \(!info\.has_evidence\) return \[\];/.test(community),
  'a ZIP without evidence short-circuits before the availability call');

process.exit(fails ? 1 : 0);
