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
//     [--exclude-pattern "\\bCommittee\\b"] \
//     [--min-match 0.8] \
//     [--legacy-host-scope]

import { pathToFileURL } from 'node:url';
import { buildMeetingsScopeFilter, meetingMatchesScope } from './lib/feed-scope.mjs';

export const DEFAULT_BOARD_PATTERN = 'Commission|Council|Court|Board of Commissioners|County Council';

export const GRANICUS_DEFAULT_PATTERN = [
  'Regular Meeting',
  'Work Session',
  'Special Called',
  'Budget Work Session',
  'Budget Vote',
  'Board of County Commissioners',
  'Board of Commissioners',
  'Commission',
  'Council',
  'Court',
  'County Council',
].join('|');

export const GRANICUS_DEFAULT_EXCLUDE_PATTERN = '\\bCommittee\\b';

/**
 * @param {string} [source]
 */
export function inferFeedVendor(source) {
  if (!source) return '';
  if (source.includes('granicus.com')) return 'granicus';
  if (source.includes('legistar.com')) return 'legistar';
  if (source.includes('civicclerk.com')) return 'civicclerk';
  return '';
}

/**
 * @param {{ patternArg?: string, excludePatternArg?: string, feedVendor?: string }} opts
 */
export function resolveVerificationPatterns({ patternArg, excludePatternArg, feedVendor }) {
  const patternProvided = patternArg !== undefined;
  const excludeProvided = excludePatternArg !== undefined;

  let patternUsed;
  if (feedVendor === 'granicus' && !patternProvided) {
    patternUsed = GRANICUS_DEFAULT_PATTERN;
  } else {
    patternUsed = patternArg ?? DEFAULT_BOARD_PATTERN;
  }

  /** @type {string | null} */
  let excludePatternUsed = null;
  if (excludeProvided) {
    excludePatternUsed = excludePatternArg || null;
  } else if (feedVendor === 'granicus') {
    excludePatternUsed = GRANICUS_DEFAULT_EXCLUDE_PATTERN;
  }

  return { patternUsed, excludePatternUsed };
}

/**
 * @param {Array<{ title?: string }>} meetings
 * @param {{ pattern: string, excludePattern?: string | null, minMatch?: number }} opts
 */
export function scoreMeetingTitles(meetings, { pattern, excludePattern = null, minMatch = 0.8 }) {
  const excludeRe = excludePattern ? new RegExp(excludePattern, 'i') : null;
  const scoredMeetings = excludeRe
    ? meetings.filter((m) => !excludeRe.test(m.title || ''))
    : meetings.slice();

  const matchRe = new RegExp(pattern, 'i');
  const matchedMeetings = scoredMeetings.filter((m) => matchRe.test(m.title || ''));

  const total = meetings.length;
  const excluded = total - scoredMeetings.length;
  const scored = scoredMeetings.length;
  const matched = matchedMeetings.length;
  const ratio = scored > 0 ? matched / scored : 0;

  return {
    total,
    excluded,
    scored,
    matched,
    ratio,
    min_match: minMatch,
    pass: scored > 0 && ratio >= minMatch,
    pattern_used: pattern,
    exclude_pattern_used: excludePattern,
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const communityId = arg('--community-id');
  const feedId = arg('--feed-id');
  const sourceHint = arg('--source');
  const patternArg = arg('--pattern');
  const excludePatternArg = arg('--exclude-pattern');
  const minMatch = arg('--min-match') ? parseFloat(arg('--min-match')) : 0.8;
  const legacyHostScope = process.argv.includes('--legacy-host-scope');

  if (!communityId) {
    console.error('usage: verify-candidate-titles.mjs --community-id UUID [--feed-id ID | --source URL] [--pattern REGEX] [--exclude-pattern REGEX] [--min-match 0.8] [--legacy-host-scope]');
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

  let feedSource = sourceHint || '';
  let feedCategory = '';
  let feedVendor = inferFeedVendor(feedSource);

  if (feedId) {
    const feedRes = await fetch(
      `${base}/rest/v1/feeds?feed_id=eq.${encodeURIComponent(feedId)}&select=source,category,community_id,source_type&limit=1`,
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
    feedVendor = inferFeedVendor(feedSource);
  }

  const params = new URLSearchParams({
    community_id: `eq.${communityId}`,
    select: 'title,meeting_date,source_url,category',
    order: 'meeting_date.desc',
    limit: '100',
  });

  if (!feedSource && feedCategory) {
    params.set('category', `eq.${feedCategory}`);
  }

  const q = `${base}/rest/v1/meetings?${params.toString()}`;
  const res = await fetch(q, { headers });
  if (!res.ok) {
    console.error(`meetings read failed: ${res.status} ${await res.text()}`);
    process.exit(2);
  }

  let meetings = await res.json();
  if (!meetings.length) {
    console.error('no meetings found for scoped query — run golive ingest first');
    process.exit(1);
  }

  /** @type {{ type: string, pattern: string, scope: object } | null} */
  let scopeFilter = null;
  if (feedSource) {
    scopeFilter = buildMeetingsScopeFilter(feedSource, feedVendor, { legacyHostScope });
    meetings = meetings.filter((m) => meetingMatchesScope(m.source_url, scopeFilter));
  }

  if (!meetings.length) {
    console.error('no meetings matched feed scope — check feed source or use --legacy-host-scope');
    process.exit(1);
  }

  const { patternUsed, excludePatternUsed } = resolveVerificationPatterns({
    patternArg,
    excludePatternArg,
    feedVendor,
  });

  const scored = scoreMeetingTitles(meetings, {
    pattern: patternUsed,
    excludePattern: excludePatternUsed,
    minMatch,
  });

  const report = {
    community_id: communityId,
    feed_id: feedId || null,
    source_scope: feedSource || null,
    scope_mode: scopeFilter?.type || (feedCategory ? 'category' : 'community_only'),
    legacy_host_scope: legacyHostScope,
    total: scored.total,
    excluded: scored.excluded,
    scored: scored.scored,
    matched: scored.matched,
    ratio: scored.ratio,
    min_match: scored.min_match,
    pass: scored.pass,
    pattern_used: scored.pattern_used,
    exclude_pattern_used: scored.exclude_pattern_used,
    sample_titles: meetings.slice(0, 8).map((m) => m.title),
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}
