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
for (const key of ['dev_anywhere', 'dev_phrase_anywhere', 'dev_head', 'dev_head_weak', 'dev_noun',
                   'routine_anywhere', 'routine_object', 'scale_noun', 'place_ambiguous']) {
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
const inList = (col, xs) => `${col} in (${xs.map(q).join(', ')})`;

// `name` is a plan / case / address LABEL for these families, so the four place-ambiguous
// routine words carry no activity meaning there, and neither weak heads nor DEV_HEAD may be
// read out of it. Generated from lib/residential-qualify.js's own table.
// The 55-family label list is emitted ONCE as a boolean column by --norm, not inlined at each
// of its six use sites: repeating it made the generated CASE 21 KB, most of it the same list.
const LABEL = Object.keys(V.name_kind_label);
const isLabel = 'lbl';
const routineMinusPlace = V.routine_anywhere.filter(w => V.place_ambiguous.indexOf(w) === -1);
const prov = inList('registry_id', Object.keys(V.dev_provenance));

// ACTIVITY text: type_raw always; `name` only when it is not a pure label.
const actHas = ps => `(${has('tr', ps)} or (not ${isLabel} and ${has('nm', ps)}))`;
const accessory = has(both, V.routine_object);
const scale = has(both, V.scale_noun);
const devHead = `(${head('tr', V.dev_head)} or (not ${isLabel} and ${head('nm', V.dev_head)}))`;
const devPhrase = actHas(V.dev_phrase_anywhere);
const weak = `((${head('tr', V.dev_head_weak)} and ${has('tr', V.dev_noun)})`
           + ` or (not ${isLabel} and ${head('nm', V.dev_head_weak)} and ${has('nm', V.dev_noun)}))`;
// step 3 reads the FULL vocabulary from tr (and from nm when nm is activity text), and the
// place-ambiguous-free vocabulary from nm always.
const routineRest = `(${has('tr', V.routine_anywhere)}`
                  + ` or (not ${isLabel} and ${has('nm', V.routine_anywhere)})`
                  + ` or ${has('nm', routineMinusPlace)})`;

const sql = `case
  when ${has('tr', V.routine_anywhere)} then 'ROUTINE'
  when ${head('nm', V.routine_anywhere)} then 'ROUTINE'
  when (${devPhrase} or ${devHead} or ${weak}) and ${accessory} and not ${scale} then 'ROUTINE'
  when ${devPhrase} or ${devHead} or ${weak} then 'DEVELOPMENT'
  when ${routineRest} then 'ROUTINE'
  when ${has(both, V.dev_anywhere)} then 'DEVELOPMENT'
  when ${prov} then 'DEVELOPMENT'
  when ${fam} then 'DEVELOPMENT'
  else 'UNRESOLVED' end`;

const NORM = c => `(' ' || btrim(regexp_replace(lower(coalesce(${c},'')), '[^a-z0-9]+', ' ', 'g')) || ' ')`;
const mode = process.argv[2];
if (mode === '--norm') process.stdout.write(
  `${NORM('type_raw')} as tr, ${NORM('name')} as nm, ${inList('registry_id', LABEL)} as lbl`);
else process.stdout.write(sql.replace(/\s+/g, ' ') + (mode ? ` as ${mode}` : ''));
