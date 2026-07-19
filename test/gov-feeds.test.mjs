// Offline unit tests — production public.feeds contract (verified 2026-07-19).
// Run: node test/gov-feeds.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FEEDS_CSV_COLUMNS,
  FEEDS_TABLE_COLUMNS,
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
  validateSourceForType,
} from '../scripts/gov-feeds/lib/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => readFileSync(join(root, 'fixtures/gov-feeds', name), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// production contract columns (R1)
ok(FEEDS_TABLE_COLUMNS.length === 15, 'FEEDS_TABLE_COLUMNS models all 15 writable production columns');
ok(FEEDS_CSV_COLUMNS.includes('target_table'), 'CSV header includes target_table');
ok(FEEDS_CSV_COLUMNS.includes('filter_expr'), 'CSV header includes filter_expr');
ok(FEEDS_CSV_COLUMNS.includes('dedupe_on'), 'CSV header includes dedupe_on');
ok(FEEDS_CSV_COLUMNS.includes('status_notes'), 'CSV header includes status_notes');
ok(FEEDS_CSV_COLUMNS.includes('source') && !FEEDS_CSV_COLUMNS.includes('source_url'),
  'CSV uses production column source (not source_url)');
ok(!FEEDS_CSV_COLUMNS.includes('destination') && !FEEDS_CSV_COLUMNS.includes('notes'),
  'CSV excludes non-production columns destination/notes');
ok(!FEEDS_CSV_COLUMNS.includes('updated_at'), 'updated_at is DB-only, not in CSV');

// ingest contract header matches production writable columns
const ingestHeader = fx('feeds-ingest-contract.csv').trim().split('\n')[0].split(',');
ok(ingestHeader.join(',') === FEEDS_CSV_COLUMNS.join(','),
  'feeds-ingest-contract.csv header matches production CSV contract');

// type-aware source validation (R3)
ok(validateSourceForType('rss', 'https://example.com/feed').length === 0, 'rss accepts https URL');
ok(validateSourceForType('rss', 'ftp://x').length > 0, 'rss rejects non-http source');
ok(validateSourceForType('keyword', 'Box Elder data center').length === 0, 'keyword accepts phrase');
ok(validateSourceForType('email', 'alerts@boxeldercounty.gov').length === 0, 'email accepts mailbox address');
ok(validateSourceForType('email', 'not-an-email').length > 0, 'email rejects invalid mailbox');

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
ok(coerced.target_table === 'meetings', 'normalize applies target_table default');

ok(validateFeedRecord(coerced, { requireCandidateInactive: true }).length === 0,
  'coerced granicus candidate passes production validation');

ok(validateFeedRecord({
  feed_id: 'bad',
  community_id: 'nope',
  source: 'ftp://x',
  source_type: 'rss',
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
ok(candidate.target_table === 'meetings', 'candidate defaults target_table=meetings');

const sql = candidateToInsertSql(candidate);
ok(sql.includes('on conflict (feed_id) do nothing'), 'insert SQL never upserts');
ok(!sql.includes('do update'), 'insert SQL has no DO UPDATE');
ok(sql.includes('active') && sql.includes('false'), 'insert SQL forces active=false');
for (const col of FEEDS_TABLE_COLUMNS) {
  ok(sql.includes(col), `insert SQL includes production column ${col}`);
}

// quarantine-by-row (R3)
const quarantineResult = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-quarantine-fixture.csv'));
ok(quarantineResult.rows.length === 1, 'quarantine fixture keeps one valid row');
ok(quarantineResult.quarantined.length === 3, 'quarantine fixture isolates three invalid rows');
ok(quarantineResult.quarantined[0].feed_id !== 'good-rss', 'quarantined rows are not the good row');

// ingest contract CSV — representative feed types (R2)
const ingest = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-ingest-contract.csv'));
ok(ingest.rows.length === 6, 'ingest contract fixture parses all six representative rows');
const byType = Object.fromEntries(ingest.rows.map((r) => [r.source_type, r]));
ok(byType.rss && byType.html && byType.keyword && byType.email,
  'ingest contract includes rss, html, keyword, and email rows');
ok(byType.html.target_table === 'alerts' || ingest.rows.some((r) => r.target_table === 'alerts'),
  'html row carries target_table=alerts');
ok(ingest.rows.some((r) => r.filter_expr), 'optional filter_expr carried through');
ok(ingest.rows.some((r) => r.dedupe_on), 'optional dedupe_on carried through');

// sync — DB-only production feeds are NOT drift
const csvRows = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-authoring-fixture.csv')).rows;
const dbFixture = JSON.parse(fx('db-feeds-fixture.json'));
const driftDbOnly = diffFeedsConfig([], dbFixture);
ok(driftDbOnly.db_only_production.length === 1, 'reports DB-only feeds');
ok(!driftDbOnly.summary.has_drift, 'DB-only production feed alone does not cause drift');

const driftMissing = diffFeedsConfig(csvRows, []);
ok(driftMissing.summary.has_drift, 'CSV row missing from DB is drift');
ok(driftMissing.missing_from_db.includes('wake-county-nc-candidate'), 'flags missing feed_id');

// active ownership reconcile
const activeCsv = {
  ...normalizeFeedRecord({
    feed_id: dbFixture[0].feed_id,
    community_id: dbFixture[0].community_id,
    source: dbFixture[0].source,
    source_type: dbFixture[0].source_type,
    category: dbFixture[0].category,
    pipeline_type: dbFixture[0].pipeline_type,
    agency_name: dbFixture[0].agency_name,
    geographic_reference: dbFixture[0].geographic_reference,
    active: true,
  }),
  presentColumns: ['active'],
};
const activeDb = { ...dbFixture[0], active: false };
const activeDiff = diffFeedsConfig([activeCsv], [activeDb]);
ok(activeDiff.active_reconcile.length === 1, 'active reconcile flags CSV/DB active mismatch');

// optional columns omitted from CSV do not force drift
const sparseCsv = normalizeFeedRecord({
  feed_id: 'clark-county-nv-granicus-meetings',
  community_id: dbFixture[0].community_id,
  source: dbFixture[0].source,
  source_type: dbFixture[0].source_type,
  category: dbFixture[0].category,
  pipeline_type: dbFixture[0].pipeline_type,
  agency_name: dbFixture[0].agency_name,
  geographic_reference: dbFixture[0].geographic_reference,
  active: dbFixture[0].active,
  presentColumns: ['feed_id', 'community_id', 'source', 'source_type', 'category', 'pipeline_type', 'agency_name', 'geographic_reference', 'active'],
});
const sparseDiff = diffFeedsConfig([sparseCsv], dbFixture);
ok(!sparseDiff.summary.has_drift, 'sparse CSV row without optional cols does not drift against DB extras');

// legacy filter column alias
const filterAlias = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-filter-alias-fixture.csv'));
ok(filterAlias.rows[0]?.filter_expr === 'publicbody/2637', 'filter CSV column maps to filter_expr');

process.exit(fails ? 1 : 0);
