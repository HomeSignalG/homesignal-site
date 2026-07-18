// Pins the unmaterialized-ZIP sampler: must keyset-page through ALL modeled ZIP
// communities (9k+ rows), not stop after the first PostgREST page. Run:
// node test/verify-communities-sampling.test.mjs
import {
  communitiesZipPagePath,
  sampleUnmaterializedZips,
} from '../scripts/verify-communities-sampling.mjs';

let fails = 0;
const ok = (c, name) => { console.log((c ? 'PASS' : 'FAIL') + ' — ' + name); if (!c) fails++; };

ok(
  communitiesZipPagePath('') === 'communities?select=zip_codes,id&level=eq.zip&order=id.asc&limit=1000',
  'first communities page has no id cursor'
);
ok(
  communitiesZipPagePath('abc-123') === 'communities?select=zip_codes,id&level=eq.zip&order=id.asc&limit=1000&id=gt.abc-123',
  'follow-up page carries id=gt cursor'
);

const materialized = new Set(['11111']);
let pageCalls = 0;
const rest = async (path) => {
  pageCalls++;
  if (!path.includes('id=gt')) {
    return [{ id: 'row-1', zip_codes: ['11111'] }];
  }
  if (path.includes('id=gt.row-1')) {
    return [{ id: 'row-2', zip_codes: ['44444'] }];
  }
  return [];
};
const found = await sampleUnmaterializedZips(materialized, rest, 4, 1);
ok(found.join(',') === '44444', 'collects unmaterialized ZIPs from later pages');
ok(pageCalls >= 2, 'walks past the first communities page when needed');

pageCalls = 0;
const restEarly = async () => {
  pageCalls++;
  return pageCalls === 1 ? [{ id: 'only', zip_codes: ['99999'] }] : [];
};
const early = await sampleUnmaterializedZips(new Set(), restEarly, 1, 1);
ok(early.length === 1 && early[0] === '99999', 'stops after first page when enough samples found');
ok(pageCalls === 1, 'does not over-fetch once sample quota is met');

pageCalls = 0;
const pages = [
  [{ id: 'a', zip_codes: ['11111'] }],
  [{ id: 'b', zip_codes: ['11111'] }],
  [{ id: 'c', zip_codes: ['11111'] }],
];
const restAll = async () => pages[pageCalls++] || [];
const none = await sampleUnmaterializedZips(new Set(['11111']), restAll, 4, 1);
ok(none.length === 0, 'returns empty when every modeled ZIP is materialized');
ok(pageCalls === 4, 'still walks every communities page when no samples exist');

if (fails) { console.error(`\n${fails} assertion(s) failed`); process.exit(1); }
console.log('\nAll verify-communities sampling assertions passed.');
