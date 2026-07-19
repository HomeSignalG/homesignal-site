// Generated SQL artifact sanity checks (offline).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRANSITIONS } from '../lib/generated/transitions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'lib/generated/transitions.sql'), 'utf8');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) fails++;
};

ok(sql.includes('create table if not exists public.feed_candidate_transitions'), 'SQL creates transition table');
ok(sql.includes('on conflict (from_state, to_state, event) do nothing'), 'SQL insert is idempotent');

let rowCount = 0;
for (const t of TRANSITIONS) {
  const needle = `('${t.from}', '${t.to}', '${t.event}'`;
  if (sql.includes(needle)) rowCount++;
}
ok(rowCount === TRANSITIONS.length, 'every JS transition has SQL row');

ok(!sql.toLowerCase().includes('update public.feeds set active = true'), 'generated SQL does not activate feeds');

process.exit(fails ? 1 : 0);
