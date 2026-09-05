// Emits the SQL form of lib/residential-qualify.js's decision, GENERATED from that file's own
// exported vocabulary. The national population is 450k+ objects and cannot be streamed to a test
// runner, so the measurement has to run in Postgres - but a hand-written SQL copy would be a
// second implementation of the product rule, free to drift. This reads HS.RESIDENTIAL_VOCABULARY
// out of the shipped module, so the words are the same words by construction.
//
// WHY A REGEX HERE IS SAFE WHEN THE MODULE USES SUBSTRINGS: every phrase is asserted to be pure
// [a-z0-9 ] below. With no metacharacter in any phrase, a POSIX alternation of literals and a
// substring containment test are the SAME predicate in both engines - so the two forms cannot
// diverge the way two hand-written regexes would. test/residential-qualify-sql-parity.test.mjs
// pins that equivalence on real production strings.
//
// Usage: node scripts/residential-qualify-sql.mjs [alias|--norm]
import fs from 'node:fs';
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(new URL('../lib/residential-qualify.js', import.meta.url), 'utf8'));
const V = globalThis.HS.RESIDENTIAL_VOCABULARY;

const LITERAL = /^[a-z0-9 ]+$/;
for (const key of ['dev_anywhere', 'dev_head', 'dev_head_weak', 'dev_noun', 'routine_anywhere']) {
  for (const ph of V[key]) {
    if (!LITERAL.test(ph)) throw new Error(`non-literal phrase in ${key}: ${JSON.stringify(ph)}`);
  }
}
const q = s => `'${s.replace(/'/g, "''")}'`;
const alt = ps => ps.map(x => x.trim()).join('|');
// contains any phrase  ->  ' (a|b|c) '   (phrases carry their own word boundaries as spaces)
const has = (col, ps) => `${col} ~ ${q(' (' + alt(ps) + ') ')}`;
// phrase begins the normalised string -> '^ (a|b|c) '
const head = (col, ps) => `${col} ~ ${q('^ (' + alt(ps) + ') ')}`;

const both = '(tr || nm)';
const fam = Object.entries(V.family_rules).map(([rid, r]) =>
  `(registry_id = ${q(rid)} and tr in (${r.dev_type_raw.map(t => q(' ' + t + ' ')).join(', ')}))`).join(' or ');

const sql = `case
  when ${has(both, V.dev_anywhere)} then 'DEVELOPMENT'
  when ${head('nm', V.routine_anywhere)} then 'ROUTINE'
  when ${head('tr', V.dev_head)} or ${head('nm', V.dev_head)} then 'DEVELOPMENT'
  when ${head('tr', V.dev_head_weak)} and ${has('tr', V.dev_noun)} then 'DEVELOPMENT'
  when ${head('nm', V.dev_head_weak)} and ${has('nm', V.dev_noun)} then 'DEVELOPMENT'
  when ${has(both, V.routine_anywhere)} then 'ROUTINE'
  when ${fam} then 'DEVELOPMENT'
  else 'UNRESOLVED' end`;

const NORM = c => `(' ' || btrim(regexp_replace(lower(coalesce(${c},'')), '[^a-z0-9]+', ' ', 'g')) || ' ')`;
const mode = process.argv[2];
if (mode === '--norm') process.stdout.write(`${NORM('type_raw')} as tr, ${NORM('name')} as nm`);
else process.stdout.write(sql.replace(/\s+/g, ' ') + (mode ? ` as ${mode}` : ''));
