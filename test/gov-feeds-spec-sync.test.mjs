// Spec sync — generated artifacts must match transition-spec.v1.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SCHEMA_VERSION,
  STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  TRANSITION_SPEC_VERSION,
} from '../lib/generated/transitions.mjs';
import {
  CURRENT_SCHEMA_VERSION,
  CURRENT_TRANSITION_SPEC_VERSION,
  FEED_CANDIDATES_COLUMNS,
} from '../lib/generated/versions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(root, 'scripts/gov-feeds/spec/transition-spec.v1.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(root, 'scripts/gov-feeds/spec/registry-schema.v1.json'), 'utf8'));

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

ok(SCHEMA_VERSION === spec.schema_version, 'transitions.mjs schema_version matches spec');
ok(TRANSITION_SPEC_VERSION === spec.transition_spec_version, 'transitions.mjs transition_spec_version matches spec');
ok(STATES.length === spec.states.length, 'state count matches spec');
ok(TERMINAL_STATES.length === spec.states.filter((s) => s.terminal).length, 'terminal count matches spec');
ok(TRANSITIONS.length === spec.transitions.length, 'transition count matches spec');

for (const t of spec.transitions) {
  const found = TRANSITIONS.find((x) => x.from === t.from && x.to === t.to && x.event === t.event);
  ok(!!found, `transition present: ${t.from} -> ${t.to} (${t.event})`);
}

ok(CURRENT_SCHEMA_VERSION === registry.current_schema_version, 'versions.mjs current_schema_version');
ok(CURRENT_TRANSITION_SPEC_VERSION === registry.current_transition_spec_version, 'versions.mjs current_transition_spec_version');
ok(FEED_CANDIDATES_COLUMNS.length === registry.tables.feed_candidates.columns.length, 'feed_candidates column count');

const sql = readFileSync(join(root, 'lib/generated/transitions.sql'), 'utf8');
ok(sql.includes('feed_candidate_transitions'), 'transitions.sql defines transition table');
ok(sql.includes(`transition_spec_version ${spec.transition_spec_version}`) || sql.includes(spec.transition_spec_version), 'transitions.sql references spec version');

process.exit(fails ? 1 : 0);
