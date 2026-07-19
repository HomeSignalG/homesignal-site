#!/usr/bin/env node
// probe-candidate.mjs — dry-run a single candidate feed (read-only vendor probe).
//
// Usage:
//   node scripts/gov-feeds/probe-candidate.mjs --candidate path/to/candidate.json
//   node scripts/gov-feeds/probe-candidate.mjs --url <source> --type rss|html
//   node scripts/gov-feeds/probe-candidate.mjs --url <source> --vendor granicus|legistar|civicclerk

import { readFileSync } from 'node:fs';
import { VENDOR_ADAPTER } from './lib/production-contract.mjs';
import { normalizeFeedRecord, validateFeedRecord } from './lib/schema.mjs';
import {
  analyzeGranicusRss,
  analyzeLegistar,
  probeCivicClerk,
  probeUrl,
} from './lib/vendors.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const candidatePath = arg('--candidate');
const url = arg('--url');
const type = arg('--type');
const vendor = arg('--vendor');

/** @type {{ source?: string, source_type?: string, feed_id?: string }} */
let target;
if (candidatePath) {
  const raw = JSON.parse(readFileSync(candidatePath, 'utf8'));
  target = raw.candidate || raw.candidates?.[0] || raw;
  target = normalizeFeedRecord(target);
} else if (url && (type || vendor)) {
  const source_type = type || (vendor ? VENDOR_ADAPTER[vendor]?.source_type : undefined);
  if (!source_type) {
    console.error('unknown --vendor; use granicus, legistar, or civicclerk');
    process.exit(2);
  }
  target = normalizeFeedRecord({
    feed_id: 'dry-run',
    community_id: '00000000-0000-4000-8000-000000000001',
    source: url,
    source_type,
    category: 'County Commission & county business',
    pipeline_type: 'government_notice',
    agency_name: 'Dry Run',
    geographic_reference: 'Dry Run',
    active: false,
    sort_order: 0,
  });
} else {
  console.error('usage: probe-candidate.mjs --candidate file.json | --url URL --type rss|html | --url URL --vendor granicus|legistar|civicclerk');
  process.exit(2);
}

const errors = validateFeedRecord(target, { requireCandidateInactive: !candidatePath });
if (errors.length) {
  console.error('candidate validation errors:', errors.join('; '));
  process.exit(2);
}

let pass = false;
let detail = {};

if (target.source_type === 'rss' && /granicus\.com/i.test(target.source)) {
  const res = await probeUrl(target.source);
  detail = { status: res.status, ...analyzeGranicusRss(res.body) };
  pass = res.ok && detail.valid && detail.items >= 1;
} else if (target.source_type === 'html' && /\.legistar\.com/i.test(target.source)) {
  const res = await probeUrl(target.source);
  detail = { status: res.status, ...analyzeLegistar(res.body, res.status) };
  pass = detail.valid;
} else if (target.source_type === 'html' && /\.portal\.civicclerk\.com/i.test(target.source)) {
  detail = await probeCivicClerk(target.source);
  pass = detail.valid && detail.events >= 1;
} else {
  console.error(`unsupported source/source_type pair: ${target.source_type} ${target.source}`);
  process.exit(2);
}

console.log(JSON.stringify({ feed_id: target.feed_id, source: target.source, source_type: target.source_type, pass, detail }, null, 2));
process.exit(pass ? 0 : 1);
