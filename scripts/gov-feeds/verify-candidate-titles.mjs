#!/usr/bin/env node
// verify-candidate-titles.mjs — post-ingest title verification for a county feed.
//
// After golive-feed runs, confirm meetings in public.meetings belong to the expected
// board (not a sub-committee). READ-ONLY against Supabase REST.
//
// Usage:
//   node scripts/gov-feeds/verify-candidate-titles.mjs \
//     --community-id <uuid> \
//     --feed-id <feed_id> \
//     --pattern "Commission|Council|Court" \
//     [--min-match 0.8]

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const communityId = arg('--community-id');
const feedId = arg('--feed-id');
const sourceHint = arg('--source');
const pattern = arg('--pattern') || 'Commission|Council|Court|Board of Commissioners|County Council';
const minMatch = arg('--min-match') ? parseFloat(arg('--min-match')) : 0.8;

if (!communityId) {
  console.error('usage: verify-candidate-titles.mjs --community-id UUID [--feed-id ID | --source URL] [--pattern REGEX] [--min-match 0.8]');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or anon) required');
  process.exit(2);
}

const base = url.replace(/\/$/, '');
const headers = { apikey: key, Authorization: `Bearer ${key}` };

/** @param {string} feedSource */
function sourceHostPattern(feedSource) {
  try {
    const u = new URL(feedSource);
    return u.hostname.replace(/\./g, '\\.');
  } catch {
    return feedSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

let feedSource = sourceHint || '';
let feedCategory = '';

if (feedId) {
  const feedRes = await fetch(
    `${base}/rest/v1/feeds?feed_id=eq.${encodeURIComponent(feedId)}&select=source,category,community_id&limit=1`,
    { headers },
  );
  if (!feedRes.ok) {
    console.error(`feeds read failed: ${feedRes.status} ${await feedRes.text()}`);
    process.exit(2);
  }
  const feeds = await feedRes.json();
  if (!feeds.length) {
    console.error(`feed_id not found: ${feedId}`);
    process.exit(2);
  }
  if (feeds[0].community_id !== communityId) {
    console.error(`feed ${feedId} belongs to community ${feeds[0].community_id}, not ${communityId}`);
    process.exit(2);
  }
  feedSource = feeds[0].source;
  feedCategory = feeds[0].category || '';
}

const params = new URLSearchParams({
  community_id: `eq.${communityId}`,
  select: 'title,meeting_date,source_url,category',
  order: 'meeting_date.desc',
  limit: '50',
});

if (feedSource) {
  const hostPat = sourceHostPattern(feedSource);
  params.set('source_url', `ilike.*${hostPat}*`);
} else if (feedCategory) {
  params.set('category', `eq.${feedCategory}`);
}

const q = `${base}/rest/v1/meetings?${params.toString()}`;
const res = await fetch(q, { headers });
if (!res.ok) {
  console.error(`meetings read failed: ${res.status} ${await res.text()}`);
  process.exit(2);
}

const meetings = await res.json();
if (!meetings.length) {
  console.error('no meetings found for scoped query — run golive ingest first');
  process.exit(1);
}

const re = new RegExp(pattern, 'i');
const matched = meetings.filter((m) => re.test(m.title || ''));
const ratio = matched.length / meetings.length;

const report = {
  community_id: communityId,
  feed_id: feedId || null,
  source_scope: feedSource || null,
  total: meetings.length,
  matched: matched.length,
  ratio,
  min_match: minMatch,
  pass: ratio >= minMatch,
  sample_titles: meetings.slice(0, 8).map((m) => m.title),
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
