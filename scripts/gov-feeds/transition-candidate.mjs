#!/usr/bin/env node
// transition-candidate.mjs — validate and print a feed_candidates state transition (P0).
//
// Usage:
//   node scripts/gov-feeds/transition-candidate.mjs \
//     --from discovered --to discriminated --event discriminate \
//     [--gate scope_discriminator]

import { validateTransition } from './lib/state-machine.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const from = arg('--from');
const to = arg('--to');
const event = arg('--event');
const gateArg = arg('--gate');

if (!from || !to || !event) {
  console.error('usage: transition-candidate.mjs --from STATE --to STATE --event EVENT [--gate GATE_NAME]');
  process.exit(2);
}

/** @type {Record<string, boolean>} */
const gates = {};
if (gateArg) gates[gateArg] = true;

const err = validateTransition({ from, to, event, gates });
if (err) {
  console.error(JSON.stringify({ ok: false, error: err }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, from, to, event, gates: gateArg || null }, null, 2));
