#!/usr/bin/env node
// STEP 2A ISOLATION GATE.
//
// Step 2A installs three evidence-staging tables -- dc_source, dc_acquisition_run,
// dc_source_observation -- that NO resident-facing surface may read. They hold what a publisher
// asserted, not what HomeSignal believes; they carry no canonical entity identity, no lifecycle
// resolution and no geography, so a page reading them would be presenting raw source assertions
// as HomeSignal's answer. That is the shortcut this repo's "ONE CANONICAL TRUTH PATH" rule
// forbids, and it is easiest to commit in the week the tables are new and empty.
//
// The gate FAILS if any resident-facing file names one of those objects.
//
// ⚠️ IT MUST PROVE IT RAN. A gate that silently scans zero files is indistinguishable from a
// clean repo, so the scan prints its own file count and REFUSES a suspiciously small one.
//
// ⚠️ `national_dc_source_key_unique` (docs/national-dc-plane.sql) contains the substring
// "dc_source". The pattern is token-bounded precisely so that a substring match cannot
// manufacture a violation -- an over-flagging gate is how a real violation gets waved through.
//
// 🛑 THE LIST IS DERIVED FROM THE DDL OF RECORD, NOT TRANSCRIBED -- AND THAT IS A CORRECTION,
// NOT A TIDY-UP. It was three hand-typed table names, and Step 2B-1A then added
// `public.dc_complete_acquisition`: the RPC that is now the ONLY path to SUCCESS_COMPLETE.
// A resident-facing file could call it and this gate would have passed, because a caller
// reaches that function WITHOUT NAMING ANY TABLE -- which is precisely what a name-based gate
// misses. The ingest half was widened to four names in homesignal-ingest#562 and this half was
// not, so the two copies of one boundary disagreed for as long as it took someone to look.
//
// Transcribing a list is an unreviewed edit to a control (claims rule 7). Deriving it from
// `docs/dc-step2a-foundation.sql` -- the DDL of record, which lives in this repo -- means the
// gate covers every object Step 2A declares TODAY and every object a future revision adds,
// with no second copy to keep in step. Measured before widening: the 3 names became 12, and
// the scanned surface carries ZERO references to any of them, so it cost no false positive.
//
// TABLES AND FUNCTIONS ONLY. Triggers and indexes are not callable or readable from a page --
// naming one proves nothing a resident could act on -- so they are deliberately out, and
// leaving them out keeps the parse surface small enough to reason about.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// The DDL of record. This repo owns it, so no cross-repo token is needed to read it.
// STEP 3C: the boundary is no longer one file. Step 3A added a CANONICAL plane and Step 3C a
// RECONCILIATION read model; neither has a resident reader either, and a page naming one would
// be the premature cutover this architecture forbids. Every file is read; any unreadable one
// REFUSES (a missing DDL is a shorter list, and a shorter list is a greener gate).
const DDL = 'docs/dc-step2a-foundation.sql';
const DDLS = [DDL, 'docs/dc-step3a-canonical-identity.sql', 'docs/dc-step3a-selftest.sql',
  'docs/dc-step3b-canonical-geography.sql',
  'docs/dc-step3c-resident-lineage-ledger.sql', 'docs/dc-step3c-ledger-distinct-record-grain.sql'];
// The reconciliation plane is whatever the Step 3C DDL declares, derived like everything else.
const RECONCILIATION_DDLS = DDLS.filter((f) => f.includes('dc-step3c-'));
// The ONE non-resident script permitted to READ the reconciliation plane: the Step 3C report.
// It may name reconciliation objects and nothing else -- never evidence, never canonical.
const RECONCILIATION_READER = 'scripts/dc-step3c-reconcile.mjs';

// ⚠️ THE ANCHOR THAT MAKES DERIVATION SAFE. A parse that quietly returns fewer names produces a
// SHORTER forbidden list and therefore a GREENER gate -- failure in the direction nobody looks.
// So the derived set must contain all four of these or the gate REFUSES to run: the three
// evidence tables, plus the completion RPC this whole correction is about.
const REQUIRED = ['dc_source', 'dc_acquisition_run', 'dc_source_observation',
  'dc_complete_acquisition', 'dc_current_observation', 'dc_canonical_entity',
  'dc_resolve_canonical', 'dc_resident_lineage_ledger', 'dc_entity_geography',
  'dc_resolve_geography'];

/**
 * The Step-2A objects a resident-facing file may not name, read out of the DDL of record.
 * Pure: takes the SQL text, returns the names. Longest first, so a hit reports the most
 * specific object it found rather than a prefix of it (`dc_source` is a prefix of five others).
 */
export function deriveForbidden(sql) {
  const names = new Set();
  const re = /create\s+(?:table\s+(?:if\s+not\s+exists\s+)?|or\s+replace\s+function\s+|(?:or\s+replace\s+)?view\s+)public\.([a-z0-9_]+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) names.add(m[1].toLowerCase());
  return [...names].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Every reason the derived list may not be trusted. Empty array = usable. */
export function forbiddenComplaints(list) {
  const out = [];
  if (!Array.isArray(list) || list.length === 0) {
    out.push(`derived 0 object name(s) from ${DDL} -- a gate with an empty forbidden list `
      + 'reports clean against every possible violation');
    return out;
  }
  for (const req of REQUIRED) {
    if (!list.includes(req)) {
      out.push(`derived list is missing ${req}, which Step 2A definitely declares -- `
        + `the ${DDL} parse is wrong, and a short list is a green gate`);
    }
  }
  return out;
}

function loadForbidden() {
  let sql = '';
  let file = DDL;
  try {
    for (file of DDLS) sql += readFileSync(join(ROOT, file), 'utf8') + '\n';
  } catch (err) {
    console.error(`REFUSED: cannot read the DDL of record at ${file} (${err.code || err.message}). `
      + 'The forbidden list is derived from it, so an unreadable DDL means this gate does not '
      + 'know what it is defending. "Could not look" must never render as "looked and found '
      + 'nothing".');
    process.exit(1);
  }
  const list = deriveForbidden(sql);
  const complaints = forbiddenComplaints(list);
  if (complaints.length) {
    console.error('REFUSED: the derived forbidden list is not trustworthy.');
    for (const c of complaints) console.error(`  - ${c}`);
    process.exit(1);
  }
  return list;
}

const FORBIDDEN = loadForbidden();
const PATTERN = new RegExp(`(^|[^A-Za-z0-9_])(${FORBIDDEN.join('|')})([^A-Za-z0-9_]|$)`);
const RECONCILIATION = new Set(deriveForbidden(
  RECONCILIATION_DDLS.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n')));
// What the reconciliation reader may NOT name: everything except the reconciliation plane.
const READER_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_])(${FORBIDDEN.filter((n) => !RECONCILIATION.has(n)).join('|')})([^A-Za-z0-9_]|$)`);

// Resident-facing, or built into something a resident loads.
const SCAN_DIRS = ['lib', 'partials', 'supabase/functions', 'scripts'];
const SCAN_EXT = new Set(['.html', '.js', '.mjs', '.ts', '.py', '.json', '.css']);
const SKIP_DIR = new Set(['node_modules', '.git', 'test', 'docs', 'fixtures', 'dist', 'community']);
const SELF = 'scripts/check-dc-step2a-isolation.mjs';
// The one legitimate reason a scanned path may name these objects: it is the gate itself.
const ALLOW = new Set([SELF]);
// A floor derived from the repo's actual shape, not a round number: the scan covers the root
// pages plus lib/ plus the edge functions, and if it ever drops near zero the gate is broken.
const MIN_FILES = 80;

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out); continue; }
    if (SCAN_EXT.has(e.name.slice(e.name.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

function targets() {
  const files = [];
  // every root-level page / script that ships
  for (const e of readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const ext = e.name.slice(e.name.lastIndexOf('.'));
    if (SCAN_EXT.has(ext)) files.push(join(ROOT, e.name));
  }
  for (const d of SCAN_DIRS) {
    const full = join(ROOT, d);
    try { if (statSync(full).isDirectory()) walk(full, files); } catch { /* absent dir */ }
  }
  return files.map((f) => relative(ROOT, f).split(sep).join('/')).sort();
}

function scan(paths, readFile) {
  const hits = [];
  for (const rel of paths) {
    if (ALLOW.has(rel)) continue;
    let text;
    try { text = readFile(rel); } catch { continue; }
    const pattern = rel === RECONCILIATION_READER ? READER_PATTERN : PATTERN;
    text.split('\n').forEach((line, i) => {
      const m = pattern.exec(line);
      if (m) hits.push({ file: rel, line: i + 1, object: m[2], text: line.trim().slice(0, 140) });
    });
  }
  return hits;
}

function selfTest() {
  // The gate must FAIL on a planted violation and PASS on the lookalike it must not flag.
  //
  // 🔑 THE FOURTH PLANT IS THE DEFECT THIS GATE SHIPPED WITH. `sb.rpc('dc_complete_acquisition')`
  // names NO table, so it scored CLEAN against the original three-name list while reaching the
  // one function that can finalise an acquisition. A page cannot be allowed near it.
  const planted = {
    'lib/fake-page.js': "const r = await sb.from('dc_source_observation').select('*');",
    'lib/fake-two.js': 'select * from public.dc_acquisition_run where 1=1',
    'lib/fake-three.js': "from('dc_source')",
    'lib/fake-rpc.js': "const { data } = await sb.rpc('dc_complete_acquisition', args);",
    // STEP 3C: a resident page reading canonical or reconciliation data is a premature cutover.
    'lib/fake-canonical.js': "const e = await sb.from('dc_canonical_entity').select('*');",
    'lib/fake-ledger.js': "const l = await sb.from('dc_resident_lineage_ledger').select('*');",
    // ... and the one permitted reader is permitted the ledger ONLY.
    [RECONCILIATION_READER]: "const o = await query('select * from public.dc_current_observation');",
  };
  const lookalike = {
    [RECONCILIATION_READER]: "await query('select * from public.dc_resident_lineage_ledger');",
    'docs-like/national.sql': 'constraint national_dc_source_key_unique unique (dc_source_key)',
    'lib/unrelated.js': 'const mydc_sourceish = 1; // adc_source_observationx',
  };
  // Two readers, not one: the reconciliation reader appears in BOTH sets (a violation when it
  // names canonical, clean when it names the ledger), and a shared lookup would shadow one.
  const bad = scan(Object.keys(planted), (rel) => planted[rel] ?? '');
  const ok = scan(Object.keys(lookalike), (rel) => lookalike[rel] ?? '');
  let fails = 0;
  const want = Object.keys(planted).length;
  // Derived from the plant set, never a literal: a hard-coded count silently stops matching the
  // moment a fifth plant is added, and then the detector-is-alive check is the thing that broke.
  if (bad.length !== want) {
    console.error(`SELF-TEST FAIL: planted violations detected ${bad.length}/${want}`);
    fails++;
  }
  if (ok.length !== 0) {
    console.error(`SELF-TEST FAIL: ${ok.length} false positive(s): ${JSON.stringify(ok)}`);
    fails++;
  }

  // ---- the derivation itself, because the list is no longer written by hand ----------------
  // A parse regression shortens the list, which makes the gate GREENER. So the parse is tested
  // in both directions against SQL shaped exactly like the DDL of record.
  const sample = [
    'create table if not exists public.dc_source (',
    'create table public.dc_acquisition_run (',
    'create table if not exists public.dc_source_observation (',
    'create or replace function public.dc_complete_acquisition(',
    'create or replace function public.dc_evidence_commit_guard()',
    'create or replace view public.dc_current_observation as',
    'create table if not exists public.dc_canonical_entity (',
    'create or replace function public.dc_resolve_canonical(',
    'create view public.dc_resident_lineage_ledger',
    'create table if not exists public.dc_entity_geography (',
    'create or replace function public.dc_resolve_geography(p_apply boolean default false)',
    // present in the real DDL and deliberately NOT derived -- a trigger is not callable
    'create constraint trigger dc_run_evidence_commit_trg',
    'create trigger dc_source_observation_guard_trg',
    'create index if not exists dc_obs_run_ordinal_uk on public.dc_source_observation',
  ].join('\n');
  const derived = deriveForbidden(sample);
  for (const req of ['dc_source', 'dc_acquisition_run', 'dc_source_observation',
    'dc_complete_acquisition', 'dc_evidence_commit_guard']) {
    if (!derived.includes(req)) {
      console.error(`SELF-TEST FAIL: deriveForbidden dropped ${req}`);
      fails++;
    }
  }
  for (const never of ['dc_run_evidence_commit_trg', 'dc_source_observation_guard_trg',
    'dc_obs_run_ordinal_uk']) {
    if (derived.includes(never)) {
      console.error(`SELF-TEST FAIL: deriveForbidden picked up ${never}, which is not a `
        + 'callable object -- the parse is matching more than tables and functions');
      fails++;
    }
  }
  // Longest first, or a hit reports `dc_source` for a `dc_source_observation` line.
  if (derived[0].length < derived[derived.length - 1].length) {
    console.error('SELF-TEST FAIL: derived list is not longest-first, so a hit will report a '
      + 'prefix instead of the object actually found');
    fails++;
  }

  // ---- fail-closed: an untrustworthy list must REFUSE, never scan with it ------------------
  if (forbiddenComplaints([]).length === 0) {
    console.error('SELF-TEST FAIL: an EMPTY derived list was accepted -- that gate forbids '
      + 'nothing and reports PASS against every violation');
    fails++;
  }
  if (forbiddenComplaints(['dc_source', 'dc_acquisition_run', 'dc_source_observation'])
    .length === 0) {
    console.error('SELF-TEST FAIL: a list missing dc_complete_acquisition was accepted -- that '
      + 'is exactly the hole this gate shipped with');
    fails++;
  }
  if (forbiddenComplaints(deriveForbidden(sample)).length !== 0) {
    console.error('SELF-TEST FAIL: a correctly derived list was REJECTED -- the anchor is '
      + 'over-strict and the gate cannot run at all');
    fails++;
  }

  // ---- STRUCTURAL: loadForbidden must ACT on the verdict it computes -------------------
  // 🔑 TWO MUTATIONS SURVIVED EVERYTHING ABOVE, AND BOTH ARE THE SAME SHAPE: make
  // `loadForbidden` compute the complaints and then ignore them, or let an unreadable DDL fall
  // back to a hand-typed list. Every behavioural assertion in this file still passed, because
  // they exercise the PURE functions -- nothing checked that the caller obeys them. A gate that
  // decides correctly and proceeds anyway has silently stopped being a gate.
  const self = readFileSync(join(ROOT, SELF), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const at = self.indexOf('function loadForbidden()');
  let slice = '';
  if (at === -1) {
    console.error('SELF-TEST FAIL: cannot find loadForbidden() to pin -- this check is inert');
    fails++;
  } else {
    let depth = 0;
    for (let i = self.indexOf('{', at); i < self.length; i++) {
      if (self[i] === '{') depth++;
      else if (self[i] === '}') { depth--; if (depth === 0) { slice = self.slice(at, i + 1); break; } }
    }
  }
  // POSITIVE CONTROL: the slice must BE loadForbidden, or every assertion below is vacuous.
  // (The first version of a pin like this ran to end-of-file and certified the whole module.)
  if (!slice.includes('readFileSync') || !slice.includes('deriveForbidden')
    || !slice.includes('forbiddenComplaints') || slice.length > 1800) {
    console.error(`SELF-TEST FAIL: the loadForbidden slice is not what this pin thinks it is `
      + `(${slice.length} chars) -- refusing to assert against it`);
    fails++;
  } else {
    const exits = (slice.match(/process\.exit\(1\)/g) || []).length;
    if (exits !== 2) {
      console.error(`SELF-TEST FAIL: loadForbidden carries ${exits} refusal(s), expected 2 -- `
        + 'one for an unreadable DDL and one for an untrustworthy derived list. A computed '
        + 'complaint that does not stop the run is not a control.');
      fails++;
    }
    if (/\[\s*'dc_[a-z_]+'/.test(slice)) {
      console.error('SELF-TEST FAIL: loadForbidden contains a hand-typed dc_* list -- the whole '
        + 'point is that the list is DERIVED; a literal fallback re-creates the defect');
      fails++;
    }
  }

  if (fails) { console.error('SELF-TEST FAILED -- the gate cannot be trusted'); process.exit(1); }
  console.log(`SELF-TEST PASS: ${want}/${want} planted violations caught (including the `
    + 'dc_complete_acquisition RPC call the three-name list missed), 0 false positives on the '
    + 'national_dc_source_key_unique lookalike, derivation proven in both directions, and an '
    + 'empty or RPC-less list REFUSED, with loadForbidden pinned to ACT on both.');
}

if (process.argv.includes('--self-test')) { selfTest(); process.exit(0); }

const paths = targets();
console.log(`scanned ${paths.length} resident-facing file(s) across `
  + `[root pages] + ${SCAN_DIRS.join(', ')}`);
if (paths.length < MIN_FILES) {
  console.error(`REFUSED: only ${paths.length} file(s) scanned, expected >= ${MIN_FILES}. `
    + 'A gate that scans nothing reports clean; treat this as a broken instrument, not a pass.');
  process.exit(1);
}

const hits = scan(paths, (rel) => readFileSync(join(ROOT, rel), 'utf8'));
if (hits.length) {
  console.error(`\nFAIL: ${hits.length} resident-facing reference(s) to Step 2A evidence tables.`);
  console.error('Step 2A is source evidence, not resident truth. A page must read the canonical');
  console.error('result owner, never a publisher assertion.\n');
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.object}]  ${h.text}`);
  process.exit(1);
}
console.log(`PASS: 0 references to ${FORBIDDEN.join(', ')} in any scanned file.`);
