// The EPA recovery watcher cannot arm itself, and cannot grow a permission scope silently.
//
// WHY THIS FILE EXISTS. During the build I ran a one-off python assertion in a shell command and
// then described it to the founder as "a guard asserts it stays commented". It was not a guard —
// it ran once, locally, and nothing re-ran it. That is the same failure as describing a scheduled
// watcher that did not exist: presenting a check as standing when it is momentary. This file is
// the real thing. It runs inside the 91-file offline suite, which the `unit` check gates on every
// PR, so it re-runs on every change to the workflow.
//
// It pins three properties:
//   1. ARMING IS DELIBERATE — an uncommented `schedule:` requires a committed approval marker.
//      Uncommenting alone fails CI. Two separate acts, or nothing happens.
//   2. NO SILENT SCOPE GROWTH — the permissions block is pinned EXACTLY. Adding `issues: write`
//      (or anything else) fails until someone edits this file, which forces the disclosure.
//      The founder had to find `issues: write` themselves once; that should not be possible twice.
//   3. NO WRITE-PATH ESCALATION — no `contents: write`, no service-role key, no model key.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WF = join(root, '.github/workflows/epa-recovery-watch.yml');
const MARKER = join(root, '.github/epa-recovery-armed');

const failures = [];
if (!existsSync(WF)) {
  failures.push('.github/workflows/epa-recovery-watch.yml is missing');
} else {
  const src = readFileSync(WF, 'utf8');
  const lines = src.split('\n');

  // 1. arming
  const scheduleActive = lines.some((l) => /^\s*schedule:\s*$/.test(l));
  const cronActive = lines.some((l) => /^\s*-\s*cron:/.test(l));
  const armed = existsSync(MARKER);
  if ((scheduleActive || cronActive) && !armed) {
    failures.push(
      'epa-recovery-watch.yml has an ACTIVE schedule but .github/epa-recovery-armed is absent. '
      + 'Arming is a deliberate two-part act: uncomment the schedule AND commit the marker file.');
  }
  if (armed && !(scheduleActive || cronActive)) {
    failures.push(
      '.github/epa-recovery-armed exists but the schedule is still commented out — the marker '
      + 'claims the watcher is live when it is not. Remove the marker or enable the schedule.');
  }

  // 2. permissions pinned exactly — scope growth must be disclosed, not discovered
  // `[ \t]+` not `\s+`: \s matches newlines, so the greedy form swallowed the whole `jobs:`
  // tree and reported thirteen "scopes". Caught by running this check rather than trusting it.
  const permBlock = /permissions:\n((?:[ \t]+[a-z-]+:[ \t]*\S+.*\n)+)/.exec(src);
  if (!permBlock) {
    failures.push('no permissions: block found — the workflow must declare its scopes explicitly');
  } else {
    const got = permBlock[1].split('\n')
      .map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean).sort();
    // contents: read  — cannot commit or push, so it cannot ship piece (c) / the badge / the sweep
    // issues:   write — its ONLY write scope: opening the report issue
    const want = ['contents: read', 'issues: write'].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures.push(`permissions changed: expected exactly ${JSON.stringify(want)}, got `
        + `${JSON.stringify(got)}. If this is intended, update this test IN THE SAME COMMIT so the `
        + 'new scope is stated out loud rather than found later.');
    }
  }

  // 3. no write-path escalation
  if (/contents:\s*write/.test(src)) failures.push('contents: write must never appear here');
  if (/SERVICE_ROLE|service_role/i.test(src)) failures.push('no service-role key in this workflow');
  if (/ANTHROPIC_API_KEY/.test(src)) {
    failures.push('no model in the write path — this runner is curl-only by ruling');
  }
}

if (failures.length) {
  console.error(failures.map((f) => `FAIL — ${f}`).join('\n'));
  process.exit(1);
}
console.log('epa-recovery-watch: schedule disarmed + no marker, permissions exactly '
  + '[contents: read, issues: write], no service-role key, no model key.');
