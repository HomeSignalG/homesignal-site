// Offline unit tests — production public.feeds contract (verified 2026-07-19).
// Run: node test/gov-feeds.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FEEDS_CSV_COLUMNS,
  VENDOR_ADAPTER,
} from '../scripts/gov-feeds/lib/production-contract.mjs';
import {
  analyzeGranicusRss,
  analyzeLegistar,
  buildDiscoveryCandidates,
  discoverCountyVendor,
  probeCivicClerk,
  scoreProbe,
} from '../scripts/gov-feeds/lib/vendors.mjs';
import { buildCandidateFeedRow, candidateToInsertSql } from '../scripts/gov-feeds/lib/candidates.mjs';
import { readFeedsCsv } from '../scripts/gov-feeds/lib/csv-io.mjs';
import { diffFeedsConfig } from '../scripts/gov-feeds/lib/sync.mjs';
import {
  coerceFeedRow,
  COUNTY_COMMISSION_CATEGORY,
  normalizeFeedRecord,
  validateFeedRecord,
} from '../scripts/gov-feeds/lib/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => readFileSync(join(root, 'fixtures/gov-feeds', name), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// production contract columns
ok(FEEDS_CSV_COLUMNS.includes('source') && !FEEDS_CSV_COLUMNS.includes('source_url'),
  'CSV uses production column source (not source_url)');
ok(!FEEDS_CSV_COLUMNS.includes('destination') && !FEEDS_CSV_COLUMNS.includes('notes'),
  'CSV excludes non-production columns destination/notes');

// coerce legacy draft shapes
const coerced = normalizeFeedRecord(coerceFeedRow({
  feed_id: 'wake-county-nc-granicus-meetings',
  community_id: '00000000-0000-4000-8000-000000000001',
  source_url: 'https://wake.granicus.com/ViewPublisherRSS.php?view_id=18&mode=agendas',
  source_type: 'granicus_rss',
  category: COUNTY_COMMISSION_CATEGORY,
  pipeline_type: 'government_notice',
  agency_name: 'Wake',
  geographic_reference: 'Wake County, NC',
  active: false,
}));
ok(coerced.source_type === 'rss' && coerced.source.includes('granicus.com'),
  'coerce maps granicus_rss → rss and source_url → source');

ok(validateFeedRecord(coerced, { requireCandidateInactive: true }).length === 0,
  'coerced granicus candidate passes production validation');

ok(validateFeedRecord({
  feed_id: 'bad',
  community_id: 'nope',
  source: 'ftp://x',
  source_type: 'granicus_rss',
  category: '',
  pipeline_type: '',
  agency_name: '',
  geographic_reference: '',
  active: true,
}).length >= 4, 'invalid rows fail validation');

// vendor adapter → production source_type
ok(VENDOR_ADAPTER.granicus.source_type === 'rss', 'Granicus adapter uses rss');
ok(VENDOR_ADAPTER.legistar.source_type === 'html', 'Legistar adapter uses html');
ok(VENDOR_ADAPTER.civicclerk.source_type === 'html', 'CivicClerk adapter uses html');

// discovery
const built = buildDiscoveryCandidates({ county_name: 'Douglas County', state: 'NV', hints: { granicus_entity: 'douglascountynv' } });
ok(built.candidates.some((c) => c.vendor === 'granicus'), 'discovery emits granicus vendor id');

const granicusBody = fx('granicus-wake-rss.xml');
const ga = analyzeGranicusRss(granicusBody);
ok(ga.valid && ga.items === 2, 'granicus fixture parses');
ok(scoreProbe('granicus', ga) >= 70, 'granicus scores high');

const la = analyzeLegistar(fx('legistar-calendar.html'), 200);
ok(la.valid, 'legistar fixture validates');

const civicJson = fx('civicclerk-events.json');
const mockFetch = async (url) => ({
  ok: true, status: 200,
  text: async () => (String(url).includes('api.civicclerk.com') ? civicJson : ''),
});
const cc = await probeCivicClerk('https://traviscotx.portal.civicclerk.com/', { fetchFn: mockFetch });
ok(cc.valid && cc.events === 1, 'civicclerk mock API');

const granicusUrl = 'https://wake.granicus.com/ViewPublisherRSS.php?view_id=18&mode=agendas';
const discoverFetch = async (url) => ({
  ok: true, status: 200,
  text: async () => (String(url) === granicusUrl ? granicusBody : '<html></html>'),
});
const disc = await discoverCountyVendor(
  { county_name: 'Wake County', state: 'NC', hints: { granicus_entity: 'wake' } },
  { fetchFn: discoverFetch, maxProbes: 5 },
);
ok(disc.hits[0]?.vendor === 'granicus', 'discover ranks granicus');

const candidate = buildCandidateFeedRow({
  community_id: '00000000-0000-4000-8000-000000000099',
  county_name: 'Wake County',
  state: 'NC',
  agency_name: disc.agency,
  geographic_reference: disc.geo,
  hit: disc.hits[0],
});
ok(candidate.active === false && candidate.source_type === 'rss', 'candidate is inactive rss row');

const sql = candidateToInsertSql(candidate);
ok(sql.includes('on conflict (feed_id) do nothing'), 'insert SQL never upserts');
ok(!sql.includes('do update'), 'insert SQL has no DO UPDATE');
ok(sql.includes('active') && sql.includes('false'), 'insert SQL forces active=false');

// sync — DB-only production feeds are NOT drift
const csvRows = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-authoring-fixture.csv'));
const dbFixture = JSON.parse(fx('db-feeds-fixture.json'));
const driftDbOnly = diffFeedsConfig([], dbFixture);
ok(driftDbOnly.db_only_production.length === 1, 'reports DB-only feeds');
ok(!driftDbOnly.summary.has_drift, 'DB-only production feed alone does not cause drift');

const driftMissing = diffFeedsConfig(csvRows, []);
ok(driftMissing.summary.has_drift, 'CSV row missing from DB is drift');
ok(driftMissing.missing_from_db.includes('wake-county-nc-candidate'), 'flags missing feed_id');

process.exit(fails ? 1 : 0);
