// Canonical feed_id identity tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCanonicalFeedId,
  legacySlugFromCounty,
  parseCanonicalFeedId,
  resolveFeedIdInput,
} from '../scripts/gov-feeds/lib/canonical-identity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(readFileSync(join(root, 'fixtures/gov-feeds/canonical-identity-fixtures.json'), 'utf8'));

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

for (const fx of fixtures) {
  if (fx.feed_id) {
    const built = buildCanonicalFeedId({
      community_slug: fx.community_slug,
      vendor: fx.vendor,
      target_table: fx.target_table,
    });
    ok(built === fx.feed_id, `buildCanonicalFeedId: ${fx.feed_id}`);
    const parsed = parseCanonicalFeedId(built);
    ok(parsed?.community_slug === fx.community_slug, `parse round-trip slug: ${fx.community_slug}`);
    ok(parsed?.vendor === fx.vendor, `parse round-trip vendor: ${fx.vendor}`);
  }
  if (fx.legacy_slug) {
    const slug = legacySlugFromCounty({ county_name: fx.county_name, state: fx.state });
    ok(slug === fx.legacy_slug, `legacy slug: ${fx.county_name}`);
    const resolved = resolveFeedIdInput({
      county_name: fx.county_name,
      state: fx.state,
      vendor: fx.vendor,
    });
    ok(resolved.legacy === true, 'county_name path marks legacy');
    ok(resolved.feed_id.includes(fx.vendor), 'legacy path builds feed_id');
  }
}

ok(parseCanonicalFeedId('not-a-feed') === null, 'invalid feed_id returns null');

process.exit(fails ? 1 : 0);
