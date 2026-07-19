#!/usr/bin/env node
// verify-candidate-titles.mjs — post-ingest title verification for a county feed.
//
// After golive-feed runs, confirm meetings in public.meetings belong to the expected
// board (not a sub-committee). READ-ONLY against Supabase REST.
//
// Usage:
//   node scripts/gov-feeds/verify-candidate-titles.mjs \
//     --community-id <uuid> \
//     --pattern "Commission|Council|Court" \
//     [--min-match 0.8]

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const communityId = arg('--community-id');
const pattern = arg('--pattern') || 'Commission|Council|Court|Board of Commissioners|County Council';
const minMatch = arg('--min-match') ? parseFloat(arg('--min-match')) : 0.8;

if (!communityId) {
  console.error('usage: verify-candidate-titles.mjs --community-id UUID [--pattern REGEX] [--min-match 0.8]');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or anon) required');
  process.exit(2);
}

const base = url.replace(/\/$/, '');
const q = `${base}/rest/v1/meetings?community_id=eq.${communityId}&select=title,meeting_date,source_url&order=meeting_date.desc&limit=50`;
const res = await fetch(q, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`meetings read failed: ${res.status} ${await res.text()}`);
  process.exit(2);
}

const meetings = await res.json();
if (!meetings.length) {
  console.error('no meetings found for community — run golive ingest first');
  process.exit(1);
}

const re = new RegExp(pattern, 'i');
const matched = meetings.filter((m) => re.test(m.title || ''));
const ratio = matched.length / meetings.length;

const report = {
  community_id: communityId,
  total: meetings.length,
  matched: matched.length,
  ratio,
  min_match: minMatch,
  pass: ratio >= minMatch,
  sample_titles: meetings.slice(0, 8).map((m) => m.title),
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
