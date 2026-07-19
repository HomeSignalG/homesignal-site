#!/usr/bin/env node
// probe-candidate.mjs — dry-run a single candidate feed (read-only vendor probe).
//
// Usage:
//   node scripts/gov-feeds/probe-candidate.mjs --candidate path/to/candidate.json
//   node scripts/gov-feeds/probe-candidate.mjs --url <source_url> --type granicus_rss|legistar|civicclerk
//
// Exits 0 when the probe passes minimum thresholds; 1 otherwise.

import { readFileSync } from 'node:fs';
import { validateFeedRecord } from './lib/schema.mjs';
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

/** @type {{ source_url: string, source_type: string, feed_id?: string }} */
let target;
if (candidatePath) {
  const raw = JSON.parse(readFileSync(candidatePath, 'utf8'));
  target = raw.candidate || raw.candidates?.[0] || raw;
} else if (url && type) {
  target = { source_url: url, source_type: type };
} else {
  console.error('usage: probe-candidate.mjs --candidate file.json | --url URL --type granicus_rss|legistar|civicclerk');
  process.exit(2);
}

const errors = validateFeedRecord({ ...target, active: false, feed_id: target.feed_id || 'dry-run', community_id: target.community_id || '00000000-0000-4000-8000-000000000001', category: target.category || 'County Commission & county business', pipeline_type: target.pipeline_type || 'government_notice', destination: target.destination || 'meetings', agency_name: target.agency_name || 'Dry Run', geographic_reference: target.geographic_reference || 'Dry Run' });
if (errors.length && candidatePath) {
  console.error('candidate validation errors:', errors.join('; '));
  process.exit(2);
}

let pass = false;
let detail = {};

if (target.source_type === 'granicus_rss') {
  const res = await probeUrl(target.source_url);
  detail = { status: res.status, ...analyzeGranicusRss(res.body) };
  pass = res.ok && detail.valid && detail.items >= 1;
} else if (target.source_type === 'legistar') {
  const res = await probeUrl(target.source_url);
  detail = { status: res.status, ...analyzeLegistar(res.body, res.status) };
  pass = detail.valid;
} else if (target.source_type === 'civicclerk') {
  detail = await probeCivicClerk(target.source_url);
  pass = detail.valid && detail.events >= 1;
} else {
  console.error(`unsupported source_type: ${target.source_type}`);
  process.exit(2);
}

console.log(JSON.stringify({ feed_id: target.feed_id, source_url: target.source_url, source_type: target.source_type, pass, detail }, null, 2));
process.exit(pass ? 0 : 1);
