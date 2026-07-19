#!/usr/bin/env node
// rollback-feed-candidate.mjs — validate rollback transition path (P0; does not mutate production).
//
// Usage:
//   node scripts/gov-feeds/rollback-feed-candidate.mjs \
//     --from active --event start_rollback

import { isLegalTransition, legalTargets } from './lib/state-machine.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const from = arg('--from') || 'active';
const event = arg('--event') || 'open_circuit';

if (!from) {
  console.error('usage: rollback-feed-candidate.mjs [--from STATE] [--event EVENT]');
  process.exit(2);
}

const targets = legalTargets(from, event);
const report = {
  from,
  event,
  legal_targets: targets,
  ok: targets.length > 0,
};

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

// Full rollback chain check: active -> open_circuit -> circuit_halting -> circuit_halted -> rollback_running
const chain = [
  ['active', 'open_circuit', 'open_circuit'],
  ['open_circuit', 'circuit_halting', 'start_circuit_halt'],
  ['circuit_halting', 'circuit_halted', 'circuit_halted'],
  ['circuit_halted', 'rollback_running', 'start_rollback'],
  ['rollback_running', 'rolled_back', 'rollback_complete'],
];

/** @type {string[]} */
const chainErrors = [];
for (const [f, t, e] of chain) {
  if (!isLegalTransition(f, t, e)) chainErrors.push(`${f} --[${e}]--> ${t}`);
}

report.rollback_chain_ok = chainErrors.length === 0;
report.chain_errors = chainErrors;

console.log(JSON.stringify(report, null, 2));
process.exit(report.rollback_chain_ok ? 0 : 1);
