// Feed-scoped L2 verification scope tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildMeetingsScopeFilter,
  extractFeedScope,
  meetingMatchesScope,
} from '../scripts/gov-feeds/lib/feed-scope.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(readFileSync(join(root, 'fixtures/gov-feeds/feed-scope-fixtures.json'), 'utf8'));

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

for (const fx of fixtures) {
  const scope = extractFeedScope(fx.source, fx.vendor);
  ok(scope.vendor === fx.vendor, `extract vendor: ${fx.vendor}`);
  const filter = buildMeetingsScopeFilter(fx.source, fx.vendor);
  const matches = meetingMatchesScope(fx.meeting_url, filter);
  ok(matches === fx.matches, `${fx.vendor} scope match=${fx.matches} for ${fx.meeting_url.slice(0, 60)}`);
}

// Granicus view_id scoping beats hostname-only
const granicusSource = 'https://wake.granicus.com/ViewPublisherRSS.php?view_id=18&mode=agendas';
const scoped = buildMeetingsScopeFilter(granicusSource, 'granicus');
const legacy = buildMeetingsScopeFilter(granicusSource, 'granicus', { legacyHostScope: true });
ok(scoped.type === 'granicus_view_id', 'default uses granicus_view_id scope');
ok(legacy.type === 'host', 'legacyHostScope uses host scope');
ok(
  meetingMatchesScope('https://wake.granicus.com/MediaPlayer.php?view_id=99', scoped) === false,
  'wrong view_id rejected under feed scope',
);
ok(
  meetingMatchesScope('https://wake.granicus.com/MediaPlayer.php?view_id=99', legacy) === true,
  'wrong view_id accepted under legacy host scope',
);

process.exit(fails ? 1 : 0);
