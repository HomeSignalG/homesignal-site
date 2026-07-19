// Activation gate unit tests.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkActivationGates } from '../scripts/gov-feeds/lib/activation-gates.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(readFileSync(join(root, 'fixtures/gov-feeds/activation-gate-fixtures.json'), 'utf8'));

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

for (const fx of fixtures) {
  const result = checkActivationGates({
    candidate: fx.candidate,
    feed: fx.feed,
    syncDiff: fx.syncDiff,
    circuit: fx.circuit,
    actor: 'ci',
  });
  ok(result.pass === fx.expect_pass, `gates: ${fx.name}`);
  if (fx.expect_failures) {
    for (const f of fx.expect_failures) {
      ok(result.failures.includes(f), `${fx.name} includes failure: ${f}`);
    }
  }
}

process.exit(fails ? 1 : 0);
