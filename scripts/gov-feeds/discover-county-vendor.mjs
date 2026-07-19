#!/usr/bin/env node
// discover-county-vendor.mjs — probe Granicus RSS / Legistar / CivicClerk for a county.
//
// Usage:
//   node scripts/gov-feeds/discover-county-vendor.mjs --county "Wake" --state NC \
//     --community-id <uuid> [--hints scripts/gov-feeds/examples/wake-hints.json] \
//     [--out results/wake-discovery.json] [--max-probes 40]
//
// READ-ONLY against vendor hosts. Does not write to Supabase.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { discoverCountyVendor } from './lib/vendors.mjs';
import { buildCandidateFeedRow } from './lib/candidates.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const county = arg('--county');
const state = arg('--state');
const communityId = arg('--community-id');
const communitySlug = arg('--community-slug');
const hintsPath = arg('--hints');
const outPath = arg('--out') || 'results/gov-feed-discovery.json';
const maxProbes = arg('--max-probes') ? parseInt(arg('--max-probes'), 10) : 40;

if (!county || !state) {
  console.error('usage: discover-county-vendor.mjs --county NAME --state ST [--community-id UUID] [--hints path.json] [--out path]');
  process.exit(2);
}

/** @type {import('./lib/vendors.mjs').CountyInput} */
const input = { county_name: county, state, community_id: communityId };
if (hintsPath) {
  const hints = JSON.parse(readFileSync(hintsPath, 'utf8'));
  input.hints = hints;
}

const result = await discoverCountyVendor(input, { maxProbes });
const payload = {
  generated_at: new Date().toISOString(),
  input,
  discovery: result,
  candidates: [],
};

if (communityId && result.hits.length) {
  const best = result.hits[0];
  const rowArgs = {
    community_id: communityId,
    county_name: county,
    state,
    agency_name: result.agency,
    geographic_reference: result.geo,
    hit: best,
  };
  if (communitySlug) rowArgs.community_slug = communitySlug;
  payload.candidates.push(buildCandidateFeedRow(rowArgs));
}

mkdirSync('results', { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

console.log(`Discovery: ${result.hits.length} hit(s) from ${result.probed} probe(s)`);
for (const h of result.hits.slice(0, 5)) {
  console.log(`  [${h.confidence}] ${h.vendor} — ${h.source_url}`);
  console.log(`       ${h.reason}`);
}
if (payload.candidates.length) {
  console.log(`\nTop candidate feed_id: ${payload.candidates[0].feed_id}`);
}
console.log(`\nWrote ${outPath}`);
