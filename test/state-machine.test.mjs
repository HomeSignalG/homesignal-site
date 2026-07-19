// State machine unit tests — legal/illegal transitions from generated spec.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isLegalTransition,
  isTerminalState,
  outgoingTransitions,
  validateTransition,
} from '../scripts/gov-feeds/lib/state-machine.mjs';
import { TERMINAL_STATES, TRANSITIONS } from '../lib/generated/transitions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const illegalFixtures = JSON.parse(readFileSync(join(root, 'fixtures/gov-feeds/transition-spec-illegal-fixtures.json'), 'utf8'));

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

ok(TRANSITIONS.length >= 40, 'spec has expected transition volume');
ok(TERMINAL_STATES.includes('superseded'), 'superseded is terminal');
ok(TERMINAL_STATES.includes('abandoned'), 'abandoned is terminal');
ok(!isTerminalState('title_verified'), 'title_verified is not terminal');

ok(isLegalTransition('goliving', 'title_verified', 'title_verify_pass'), 'goliving -> title_verified legal');
ok(!isLegalTransition('goliving', 'active', 'activate'), 'goliving -> active illegal');

ok(validateTransition({
  from: 'discovered',
  to: 'discriminated',
  event: 'discriminate',
  gates: { scope_discriminator: true },
}) === null, 'discriminate with gate passes');

ok(validateTransition({
  from: 'discovered',
  to: 'discriminated',
  event: 'discriminate',
  gates: {},
}) !== null, 'discriminate without gate fails');

for (const fx of illegalFixtures) {
  ok(!isLegalTransition(fx.from, fx.to, fx.event), `illegal: ${fx.from} -> ${fx.to} (${fx.reason})`);
}

const fromDiscovered = outgoingTransitions('discovered');
ok(fromDiscovered.some((t) => t.event === 'discriminate'), 'discovered has discriminate outgoing');
ok(fromDiscovered.some((t) => t.event === 'abandon'), 'discovered has abandon outgoing');

process.exit(fails ? 1 : 0);
