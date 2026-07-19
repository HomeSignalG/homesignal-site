#!/usr/bin/env node
// activate-feed-candidate.mjs — pre-flight activation gates (P0; does not mutate production).
//
// Usage:
//   node scripts/gov-feeds/activate-feed-candidate.mjs \
//     --feed-id wake-county-nc-granicus-meetings \
//     --candidate-json path.json \
//     --feed-json path.json \
//     [--sync-json path.json]

import { readFileSync } from 'node:fs';
import { checkActivationGates } from './lib/activation-gates.mjs';
import { isLegalTransition } from './lib/state-machine.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const feedId = arg('--feed-id');
const candidatePath = arg('--candidate-json');
const feedPath = arg('--feed-json');
const syncPath = arg('--sync-json');
const fromState = arg('--from') || 'title_verified';

if (!feedId || !candidatePath || !feedPath) {
  console.error('usage: activate-feed-candidate.mjs --feed-id ID --candidate-json FILE --feed-json FILE [--sync-json FILE] [--from STATE]');
  process.exit(2);
}

const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'));
const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
const syncDiff = syncPath ? JSON.parse(readFileSync(syncPath, 'utf8')) : { has_drift: false };

if (!isLegalTransition(fromState, 'active', 'activate') && fromState !== 'activating') {
  const viaActivating = isLegalTransition(fromState, 'activating', 'start_activation');
  if (!viaActivating) {
    console.error(JSON.stringify({
      ok: false,
      error: `state ${fromState} cannot reach active`,
    }, null, 2));
    process.exit(1);
  }
}

const gates = checkActivationGates({ candidate, feed, syncDiff });
const report = {
  feed_id: feedId,
  from_state: candidate.state || fromState,
  gates,
  ok: gates.pass,
};

console.log(JSON.stringify(report, null, 2));
process.exit(gates.pass ? 0 : 1);
