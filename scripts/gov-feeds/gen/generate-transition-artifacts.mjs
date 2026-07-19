#!/usr/bin/env node
// Generate JS + SQL transition artifacts from scripts/gov-feeds/spec/transition-spec.v1.json.
// Run: node scripts/gov-feeds/gen/generate-transition-artifacts.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const specPath = join(root, 'scripts/gov-feeds/spec/transition-spec.v1.json');
const registryPath = join(root, 'scripts/gov-feeds/spec/registry-schema.v1.json');
const outDir = join(root, 'lib/generated');

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

mkdirSync(outDir, { recursive: true });

const stateNames = spec.states.map((s) => s.name);
const terminalStates = spec.states.filter((s) => s.terminal).map((s) => s.name);

const transitionsJs = `// AUTO-GENERATED — do not edit. Source: scripts/gov-feeds/spec/transition-spec.v1.json
// Regenerate: node scripts/gov-feeds/gen/generate-transition-artifacts.mjs

export const SCHEMA_VERSION = ${spec.schema_version};
export const TRANSITION_SPEC_VERSION = ${JSON.stringify(spec.transition_spec_version)};

/** @type {readonly string[]} */
export const STATES = ${JSON.stringify(stateNames, null, 2)};

/** @type {readonly string[]} */
export const TERMINAL_STATES = ${JSON.stringify(terminalStates, null, 2)};

/**
 * @typedef {{ from: string, to: string, event: string, requires_gate?: string }} Transition
 */

/** @type {readonly Transition[]} */
export const TRANSITIONS = ${JSON.stringify(spec.transitions, null, 2)};

/** @type {Record<string, { description: string }>} */
export const GATES = ${JSON.stringify(spec.gates, null, 2)};

/** @type {Map<string, Transition[]>} */
export const TRANSITIONS_BY_FROM = new Map(
  STATES.map((state) => [
    state,
    TRANSITIONS.filter((t) => t.from === state),
  ]),
);

/** @param {string} state */
export function isTerminalState(state) {
  return TERMINAL_STATES.includes(state);
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string} event
 */
export function findTransition(from, to, event) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to && t.event === event) ?? null;
}

/**
 * @param {string} from
 * @param {string} event
 */
export function legalTargets(from, event) {
  return TRANSITIONS.filter((t) => t.from === from && t.event === event).map((t) => t.to);
}
`;

const transitionRows = spec.transitions.map((t) => {
  const gate = t.requires_gate ? `'${t.requires_gate.replace(/'/g, "''")}'` : 'null';
  return `  ('${t.from}', '${t.to}', '${t.event}', ${gate})`;
});

const transitionsSql = `-- AUTO-GENERATED — do not edit. Source: scripts/gov-feeds/spec/transition-spec.v1.json
-- Regenerate: node scripts/gov-feeds/gen/generate-transition-artifacts.mjs
-- Apply manually via docs/gov-feeds-phase1b-p0-functions.sql (not auto-applied).

-- Legal feed_candidates state transitions (transition_spec_version ${spec.transition_spec_version})
create table if not exists public.feed_candidate_transitions (
  from_state text not null,
  to_state text not null,
  event text not null,
  requires_gate text,
  primary key (from_state, to_state, event)
);

comment on table public.feed_candidate_transitions is
  'Phase 1B P0 legal state transitions; generated from transition-spec.v1.json';

insert into public.feed_candidate_transitions (from_state, to_state, event, requires_gate)
values
${transitionRows.join(',\n')}
on conflict (from_state, to_state, event) do nothing;

-- States reference (documentation)
-- terminal: ${terminalStates.join(', ')}
`;

const versionsJs = `// AUTO-GENERATED — do not edit. Source: scripts/gov-feeds/spec/*.v1.json
// Regenerate: node scripts/gov-feeds/gen/generate-transition-artifacts.mjs

export const REGISTRY_SCHEMA_VERSION = ${registry.schema_version};
export const REGISTRY_TRANSITION_SPEC_VERSION = ${registry.transition_spec_version};
export const CURRENT_SCHEMA_VERSION = ${registry.current_schema_version};
export const CURRENT_TRANSITION_SPEC_VERSION = ${registry.current_transition_spec_version};

/** @type {readonly string[]} */
export const FEED_CANDIDATES_COLUMNS = ${JSON.stringify(registry.tables.feed_candidates.columns, null, 2)};

/** @type {Record<string, string>} */
export const GATE_DEFINITIONS = ${JSON.stringify(registry.gate_definitions, null, 2)};
`;

writeFileSync(join(outDir, 'transitions.mjs'), transitionsJs);
writeFileSync(join(outDir, 'transitions.sql'), transitionsSql);
writeFileSync(join(outDir, 'versions.mjs'), versionsJs);

console.log('Generated:');
console.log('  lib/generated/transitions.mjs');
console.log('  lib/generated/transitions.sql');
console.log('  lib/generated/versions.mjs');
console.log(`  ${spec.transitions.length} transitions, ${stateNames.length} states`);
