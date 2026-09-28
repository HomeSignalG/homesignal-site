// Parked named-ZIP READY coverage for 94128 / 95219 / 99128 (Step 7).
//
// Standing founder lock (2026-09-27):
// "Do not unlist ~1,005 map pages just because they have plants and no new
//  construction. 'Nothing is being built' is a valid answer. Those pages stay
//  listed. This was the old Unit 1 idea; it is rejected."
// The `_nfc >= 3` limb of indexable STAYS. Unit 1 is rejected. Plant-only
// Map 1 pages remain listed. This park never activates a generation and never
// assigns indexable. Parking is not taking the live write for the 3 ZIPs.
//
// Offline pins + mutations on EXIT CODE. Copy files to tmp; do not mutate live
// files. Do not edit test/n5-generation-publish.test.mjs.
//
// Run: node test/n5-missing-zip-status.test.mjs
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let n = 0, bad = 0;
const ok = (c, m, d) => {
  n++;
  if (c) console.log('PASS — ' + m);
  else {
    bad++;
    console.log('FAIL — ' + m + (d === undefined ? '' : '  ' + JSON.stringify(d)));
  }
};
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const stripSql = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:"'\\])\/\/.*$/, '$1')).join('\n');

const ZIPS = ['94128', '95219', '99128'];
const ACTIVATE = 'n5_generation_' + 'activate';
const CHECKER = join(ROOT, 'scripts', 'n5_missing_zip_status.py');
const PARKED = 'docs/n5-named-zip-status-coverage.sql';
const PUBLISH = 'docs/n5-generation-publish.sql';
const CANDIDATES = 'scripts/verify-map1-zip-states.mjs';
const QUEUE = 'QUEUE.md';
const WORKFLOW = '.github/workflows/n5-missing-zip-status.yml';
const UNIT1 = 'docs/epa-decouple-phase2-unit1-core-completion-markers.sql';
const THIS = 'test/n5-missing-zip-status.test.mjs';

const LOCK = [
  'Do not unlist ~1,005 map pages',
  'Nothing is being built',
  'This was the old Unit 1 idea; it is rejected',
];

function pythonChecker(extraArgs) {
  return spawnSync('python3', [CHECKER].concat(extraArgs || []), {
    encoding: 'utf8',
    cwd: ROOT,
  });
}

function hasActivateCall(text) {
  const body = String(text).replace(/[ \t]+/g, '');
  return new RegExp(ACTIVATE + '\\s*\\(').test(text)
    || body.includes('geo.' + ACTIVATE);
}

function assignsIndexable(text) {
  return /(?:^|[\s,;(])indexable\s*=(?!=)|(?:'indexable'|"indexable")\s*,/m.test(text);
}

const parked = read(PARKED);
const parkedBody = stripSql(parked);
const publish = read(PUBLISH);
const publishBody = stripSql(publish);
const candidates = read(CANDIDATES);
const queue = read(QUEUE);
const workflow = read(WORKFLOW);
const unit1 = read(UNIT1);
const checker = read('scripts/n5_missing_zip_status.py');
const self = read(THIS);

// ── A. publish_scope unions canonical prefixes ────────────────────────────────
ok(
  /n5_generation_publish_scope/.test(publishBody)
    && /canonical_zip_registry/.test(publishBody)
    && /left\(r\.zip,\s*3\)/.test(publishBody),
  'A publish_scope unions shard prefixes with canonical ZIP prefixes (left(r.zip, 3))'
);

// ── B. status INSERT from canonical_zip_registry ──────────────────────────────
ok(
  /n5_gen_publish_prefix/.test(publishBody)
    && /insert\s+into\s+geo\.maps_zip_geography_status/i.test(publishBody)
    && /canonical_zip_registry/.test(publishBody),
  'B n5_gen_publish_prefix INSERTs maps_zip_geography_status from canonical_zip_registry'
);

// ── C. READY includes canonical_zip_without_status ────────────────────────────
ok(
  /canonical_zip_without_status/.test(publishBody)
    && /n5_generation_mark_ready/.test(publishBody),
  'C READY includes canonical_zip_without_status'
);

// ── D. CANDIDATES still includes the three unknown ZIPs ───────────────────────
ok(
  /const CANDIDATES/.test(candidates)
    && ZIPS.every((z) => candidates.includes("'" + z + "'") || candidates.includes('"' + z + '"')),
  'D CANDIDATES still includes 94128, 95219, 99128 (cannot delete)'
);

// ── E. QUEUE.md still names them ──────────────────────────────────────────────
ok(
  ZIPS.every((z) => queue.includes(z)) && /maps_zip_geography_status/.test(queue),
  'E QUEUE.md still names the 3 ZIPs with no maps_zip_geography_status row'
);

// ── F. founder lock (Unit 1 rejected; plant-only pages stay listed) ───────────
function quotesLock(text, extra) {
  return LOCK.every((needle) => text.includes(needle))
    && (text.includes('Unit 1 idea; it is rejected') || text.includes('Unit 1 is rejected'))
    && text.includes('_nfc >= 3')
    && (!extra || extra(text));
}
ok(quotesLock(parked), 'F1 parked SQL quotes the founder lock; _nfc >= 3 stays');
ok(quotesLock(checker), 'F2 checker quotes the founder lock; _nfc >= 3 stays');
ok(quotesLock(self), 'F3 this test quotes the founder lock; _nfc >= 3 stays');
ok(
  quotesLock(unit1, (t) => t.includes('PHASE 2 UNIT 1 IS REJECTED')),
  'F4 Unit 1 remains rejected; plant-only pages stay listed'
);
ok(
  /RAISE EXCEPTION/.test(parked)
    && /n5_named_zip_status_problems/.test(parkedBody)
    && ZIPS.every((z) => parkedBody.includes("'" + z + "'") || parkedBody.includes('"' + z + '"'))
    && /canonical_zip_registry/.test(parkedBody)
    && !/n5_generation_publish_problems/.test(parkedBody),
  'F5 parked SQL is its own named-ZIP function (not a splice, not a prefix count)'
);

// ── G. this park never calls activate, never assigns indexable ────────────────
ok(
  !hasActivateCall(parkedBody) && !assignsIndexable(parkedBody),
  'G1 parked SQL never activates a generation and never assigns indexable'
);
function stripHashComments(s) {
  return s.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => {
    const i = l.indexOf(' #');
    return i === -1 ? l : l.slice(0, i);
  }).join('\n');
}
const workflowBody = stripHashComments(workflow);
ok(
  /workflow_dispatch/.test(workflow)
    && !/^\s*schedule\s*:/m.test(workflow)
    && !/^\s*push\s*:/m.test(workflow)
    && !/^\s*pull_request\s*:/m.test(workflow)
    && !/supabase/i.test(workflowBody)
    && !/secrets\./i.test(workflowBody)
    && !hasActivateCall(workflowBody)
    && /n5_missing_zip_status\.py/.test(workflow)
    && /n5-missing-zip-status\.test\.mjs/.test(workflow),
  'G2 workflow is dispatch-only, secret-free, and never activates'
);
ok(
  /def check_workflow/.test(checker)
    && /strip_hash_comments\(/.test(checker)
    && /secrets\./.test(checker)
    && !/"secret" in/.test(checker),
  'G2b checker matches secrets. after stripping comments, not the word secret'
);
ok(
  !hasActivateCall(stripJs(self).replace(/ACTIVATE = 'n5_generation_' \+ 'activate'/, ''))
    && !assignsIndexable(self),
  'G3 this park never assigns indexable'
);

// ── H. happy path + mutations on EXIT CODE (copies only) ──────────────────────
const happy = pythonChecker([]);
ok(
  happy.status === 0 && /n5_missing_zip_status: all parked pins held/.test(happy.stdout || ''),
  'H0 parked checker happy path exits 0',
  { status: happy.status, stderr: (happy.stderr || '').slice(0, 400) }
);

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'n5-missing-zip-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const dropZip = withTmp((dir) => {
  const copy = join(dir, 'candidates.mjs');
  writeFileSync(copy, candidates.replace("'94128', ", '').replace('"94128", ', ''));
  return pythonChecker(['--candidates', copy]);
});
ok(
  dropZip.status !== 0,
  'H1 copy CANDIDATES, drop one ZIP → checker exits non-zero',
  { status: dropZip.status, stderr: (dropZip.stderr || '').slice(0, 300) }
);

const gutNamed = withTmp((dir) => {
  const copy = join(dir, 'parked.sql');
  writeFileSync(
    copy,
    parked.replace("array['94128', '95219', '99128']::text[]", 'array[]::text[]')
  );
  return pythonChecker(['--parked-sql', copy]);
});
ok(
  gutNamed.status !== 0,
  'H2 copy parked SQL, gut named list → checker exits non-zero',
  { status: gutNamed.status, stderr: (gutNamed.stderr || '').slice(0, 300) }
);

const addActivate = withTmp((dir) => {
  const copy = join(dir, 'n5_missing_zip_status.py');
  writeFileSync(
    copy,
    checker + '\n\ndef _park_must_never_activate():\n    geo.' + ACTIVATE + '("parked")\n'
  );
  return spawnSync('python3', [copy, '--checker', copy], {
    encoding: 'utf8',
    cwd: ROOT,
  });
});
ok(
  addActivate.status !== 0,
  'H3 copy checker, add activate call → that copy exits non-zero',
  { status: addActivate.status, stderr: (addActivate.stderr || '').slice(0, 300) }
);

const commentSecret = withTmp((dir) => {
  const copy = join(dir, 'wf.yml');
  writeFileSync(
    copy,
    workflow + '\n# secrets.GITHUB_TOKEN is named only in this comment\n'
  );
  return pythonChecker(['--workflow', copy]);
});
ok(
  commentSecret.status === 0,
  'H4 comment naming secrets. does not fail the checker',
  { status: commentSecret.status, stderr: (commentSecret.stderr || '').slice(0, 300) }
);

const liveSecret = withTmp((dir) => {
  const copy = join(dir, 'wf.yml');
  writeFileSync(
    copy,
    workflow + '\n        env:\n          t: ${{ secrets.GITHUB_TOKEN }}\n'
  );
  return pythonChecker(['--workflow', copy]);
});
ok(
  liveSecret.status !== 0,
  'H5 live secrets. usage fails the checker',
  { status: liveSecret.status, stderr: (liveSecret.stderr || '').slice(0, 300) }
);

console.log('\n' + n + ' checks, ' + bad + ' failed');
if (bad) process.exit(1);
