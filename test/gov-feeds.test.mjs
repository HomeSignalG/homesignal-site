// Offline unit tests — production public.feeds contract (verified 2026-07-19).
// Run: node test/gov-feeds.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FEEDS_CSV_COLUMNS,
  FEEDS_INGEST_CSV_HEADER,
  FEEDS_TABLE_COLUMNS,
  VENDOR_ADAPTER,
  canonicalCsvColumn,
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

// production contract columns
ok(FEEDS_TABLE_COLUMNS.length === 16, 'FEEDS_TABLE_COLUMNS models all 16 writable production columns');
ok(FEEDS_TABLE_COLUMNS.includes('county'), 'production contract includes county');
ok(FEEDS_CSV_COLUMNS.includes('target_table'), 'canonical columns include target_table');
ok(FEEDS_CSV_COLUMNS.includes('filter_expr'), 'canonical columns include filter_expr');
ok(FEEDS_CSV_COLUMNS.includes('status_notes'), 'canonical columns include status_notes');
ok(FEEDS_CSV_COLUMNS.includes('source') && !FEEDS_CSV_COLUMNS.includes('source_url'),
  'uses production column source (not source_url)');
ok(!FEEDS_CSV_COLUMNS.includes('updated_at'), 'updated_at is DB-only, not in CSV');

// verbatim ingest header (review #3)
const ingestHeaderLine = fx('feeds-ingest-contract.csv').trim().split('\n')[0];
ok(ingestHeaderLine === FEEDS_INGEST_CSV_HEADER,
  'feeds-ingest-contract.csv header matches verbatim ingest header constant');
ok(canonicalCsvColumn('status / notes') === 'status_notes', 'status / notes alias maps to status_notes');
ok(canonicalCsvColumn('filter') === 'filter_expr', 'filter alias maps to filter_expr');

// type-aware source validation
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

// vendor adapter → production source_type
ok(VENDOR_ADAPTER.granicus.source_type === 'rss', 'Granicus adapter uses rss');

const granicusBody = fx('granicus-wake-rss.xml');
const granicusUrl = 'https://wake.granicus.com/ViewPublisherRSS.php?view_id=18&mode=agendas';
const discoverFetch = async (url) => ({
  ok: true, status: 200,
  text: async () => (String(url) === granicusUrl ? granicusBody : '<html></html>'),
});
const disc = await discoverCountyVendor(
  { county_name: 'Wake County', state: 'NC', hints: { granicus_entity: 'wake' } },
  { fetchFn: discoverFetch, maxProbes: 5 },
);
const candidate = buildCandidateFeedRow({
  community_id: '00000000-0000-4000-8000-000000000099',
  county_name: 'Wake County',
  state: 'NC',
  agency_name: disc.agency,
  geographic_reference: disc.geo,
  hit: disc.hits[0],
});
ok(candidate.county === 'Wake County', 'candidate carries county from discovery');

const sql = candidateToInsertSql(candidate);
ok(sql.includes('on conflict (feed_id) do nothing'), 'insert SQL never upserts');
for (const col of FEEDS_TABLE_COLUMNS) {
  ok(sql.includes(col), `insert SQL includes production column ${col}`);
}

// quarantine-by-row preserved
const quarantineResult = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-quarantine-fixture.csv'));
ok(quarantineResult.rows.length === 1, 'quarantine fixture keeps one valid row');
ok(quarantineResult.quarantined.length === 3, 'quarantine fixture isolates three invalid rows');

// unknown CSV columns warn, do not fatal
const unknownCol = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-unknown-column-fixture.csv'));
ok(unknownCol.warnings.length === 1, 'unknown column produces one warning');
ok(unknownCol.warnings[0].includes('wire_status'), 'warning names ignored column');
ok(unknownCol.rows.length === 1, 'unknown column does not block valid row parse');

// authoritative ingest CSV parses representative feed types
const ingest = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-ingest-contract.csv'));
ok(ingest.warnings.length === 0, 'ingest contract has no CSV warnings');
ok(ingest.quarantined.length === 0, 'ingest contract has no quarantined rows');
ok(ingest.rows.length === 6, 'ingest contract parses all six representative rows');
ok(ingest.rows.some((r) => r.source_type === 'rss'), 'ingest includes rss row');
ok(ingest.rows.some((r) => r.source_type === 'html'), 'ingest includes html row');
ok(ingest.rows.some((r) => r.source_type === 'keyword'), 'ingest includes keyword row');
ok(ingest.rows.some((r) => r.source_type === 'email'), 'ingest includes email row');
ok(ingest.rows.every((r) => r.county), 'ingest rows carry county when present in CSV');
ok(ingest.rows.some((r) => r.status_notes.includes('PMN')), 'status / notes alias populates status_notes');
ok(ingest.rows.some((r) => r.filter_expr === 'publicbody/2637'), 'filter alias populates filter_expr');

// sync succeeds against authoritative ingest CSV + matching DB fixture
const ingestDb = JSON.parse(fx('db-feeds-ingest-fixture.json'));
const ingestSync = diffFeedsConfig(ingest.rows, ingestDb);
ok(!ingestSync.summary.has_drift, 'sync: ingest CSV matches ingest DB fixture with zero drift');

// sync — DB-only production feeds are NOT drift
const csvRows = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-authoring-fixture.csv')).rows;
const dbFixture = JSON.parse(fx('db-feeds-fixture.json'));
const driftDbOnly = diffFeedsConfig([], dbFixture);
ok(!driftDbOnly.summary.has_drift, 'DB-only production feed alone does not cause drift');

const driftMissing = diffFeedsConfig(csvRows, []);
ok(driftMissing.summary.has_drift, 'CSV row missing from DB is drift');

// legacy filter column alias on ingest-shaped header
const filterAlias = readFeedsCsv(join(root, 'fixtures/gov-feeds/feeds-filter-alias-fixture.csv'));
ok(filterAlias.rows[0]?.filter_expr === 'publicbody/2637', 'filter CSV column maps to filter_expr on ingest header');

process.exit(fails ? 1 : 0);
