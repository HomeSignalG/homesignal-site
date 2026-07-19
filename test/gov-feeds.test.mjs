// Offline unit tests for gov-feeds discovery + sync (Phase 1A).
// Run: node test/gov-feeds.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  analyzeGranicusRss,
  analyzeLegistar,
  buildDiscoveryCandidates,
  discoverCountyVendor,
  probeCivicClerk,
  scoreProbe,
  slugifyCounty,
} from '../scripts/gov-feeds/lib/vendors.mjs';
import { buildCandidateFeedRow, candidateToInsertSql } from '../scripts/gov-feeds/lib/candidates.mjs';
import { readFeedsCsv } from '../scripts/gov-feeds/lib/csv-io.mjs';
import { diffFeedsConfig } from '../scripts/gov-feeds/lib/sync.mjs';
import { validateFeedRecord, COUNTY_COMMISSION_CATEGORY } from '../scripts/gov-feeds/lib/schema.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => readFileSync(join(root, 'fixtures/gov-feeds', name), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

// schema
ok(validateFeedRecord({
  feed_id: 'wake-county-nc-granicus-rss-meetings',
  community_id: '00000000-0000-4000-8000-000000000001',
  source_url: 'https://wake.granicus.com/ViewPublisherRSS.php?view_id=18&mode=agendas',
  source_type: 'granicus_rss',
  category: COUNTY_COMMISSION_CATEGORY,
  pipeline_type: 'government_notice',
  destination: 'meetings',
  agency_name: 'Wake County Board of Commissioners',
  geographic_reference: 'Wake County, NC',
  active: false,
}).length === 0, 'valid granicus candidate passes schema');

ok(validateFeedRecord({
  feed_id: 'bad',
  community_id: 'nope',
  source_url: 'ftp://x',
  source_type: 'granicus_rss',
  category: '',
  pipeline_type: '',
  destination: 'nope',
  agency_name: '',
  geographic_reference: '',
  active: false,
}).length >= 5, 'invalid candidate accumulates schema errors');

// slugify
const sl = slugifyCounty('Wake County', 'NC');
ok(sl.base === 'wake', 'slugify strips County suffix');
ok(sl.withCounty === 'wakecounty', 'slugify builds withCounty variant');

// discovery candidate generation
const built = buildDiscoveryCandidates({ county_name: 'Douglas County', state: 'NV', hints: { granicus_entity: 'douglascountynv' } });
ok(built.candidates.some((c) => c.vendor === 'granicus_rss' && c.urls[0].includes('douglascountynv')), 'hints seed granicus entity');

// offline granicus analysis
const granicusBody = fx('granicus-wake-rss.xml');
const ga = analyzeGranicusRss(granicusBody);
ok(ga.valid && ga.items === 2, 'granicus fixture has 2 items');
ok(/Commissioners/.test(ga.sampleTitle), 'granicus sample title mentions Commissioners');
ok(scoreProbe('granicus_rss', ga) >= 70, 'granicus fixture scores high');

// legistar
const la = analyzeLegistar(fx('legistar-calendar.html'), 200);
ok(la.valid, 'legistar fixture validates');

// civicclerk with mock fetch
const civicJson = fx('civicclerk-events.json');
const mockFetch = async (url) => ({
  ok: true,
  status: 200,
  text: async () => (String(url).includes('api.civicclerk.com') ? civicJson : ''),
});
const cc = await probeCivicClerk('https://traviscotx.portal.civicclerk.com/', { fetchFn: mockFetch });
ok(cc.valid && cc.events === 1, 'civicclerk mock API returns events');
ok(/Commissioners Court/.test(cc.sampleTitle || ''), 'civicclerk sample title');

// full discover with mock fetch
const granicusUrl = 'https://wake.granicus.com/ViewPublisherRSS.php?view_id=18&mode=agendas';
const discoverFetch = async (url) => ({
  ok: true,
  status: 200,
  text: async () => (String(url) === granicusUrl ? granicusBody : '<html></html>'),
});
const disc = await discoverCountyVendor(
  { county_name: 'Wake County', state: 'NC', hints: { granicus_entity: 'wake' } },
  { fetchFn: discoverFetch, maxProbes: 5 },
);
ok(disc.hits.length >= 1 && disc.hits[0].vendor === 'granicus_rss', 'discover ranks granicus hit');

// candidate builder + SQL
const candidate = buildCandidateFeedRow({
  community_id: '00000000-0000-4000-8000-000000000099',
  county_name: 'Wake County',
  state: 'NC',
  agency_name: disc.agency,
  geographic_reference: disc.geo,
  hit: disc.hits[0],
});
ok(candidate.active === false, 'candidates default active=false');
ok(candidate.category === COUNTY_COMMISSION_CATEGORY, 'county meetings use canonical category');
const sql = candidateToInsertSql(candidate);
ok(sql.includes('insert into public.feeds') && sql.includes('on conflict (feed_id)'), 'insert SQL is idempotent');

// csv + sync
const csvRows = readFeedsCsv(join(root, 'data/gov-feeds/feeds.csv'));
ok(csvRows.length === 0, 'authoring feeds.csv is header-only (no production rows)');

const dbFixture = JSON.parse(fx('db-feeds-fixture.json'));
const syncDiff = diffFeedsConfig([], dbFixture);
ok(syncDiff.only_in_db.length === 1, 'empty CSV vs fixture DB shows only_in_db');

process.exit(fails ? 1 : 0);
