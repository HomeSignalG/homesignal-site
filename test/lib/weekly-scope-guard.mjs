// THE TAB 20 (WEEKLY) SCOPE GUARD, as a pure decision plus one git read (used by test/weekly-topics.test.mjs; proven by test/weekly-scope-guard.test.mjs).
//
// PURPOSE (from the guard's origin, #2772): a branch that builds the Tab 20 weekly feature must change nothing in Tab 17, the Bluesky stage 1 files or YouTube, and outside the weekly files
// only a short allowlist (the dashboard page and the tab-count tests). It is a FEATURE-BRANCH scope check. It was written to run on every branch with origin/main fetched, so any later
// branch that touched a non-weekly file failed it although it had nothing to do with Tab 20.
// SCOPE (policy decision, 2026-11-20): the guard applies ONLY when the branch's diff touches a weekly-feature path. A diff with none is reported NOT APPLICABLE (never a pass);
// an unavailable comparison ref is reported UNAVAILABLE (the guard was NOT enforced, never a pass); when it applies, both existing rules are enforced exactly as before. Nothing here fetches.
import { execFileSync } from 'node:child_process';

/** What makes a path part of the weekly feature: the same word the original rule used to decide "the weekly files". */
export const FEATURE = /weekly/i;
/** Rule 6 (unchanged): files that must not differ from the base at all. */
export const PROHIBITED = /impact|acq-weekly-report|^topics\.js$|youtube|^lib\/.*bluesky|^docs\/(?!weekly-bluesky-sources\.sql$).*bluesky/i;
/** Rule 6b (unchanged): the only files outside the weekly files that may differ. */
export const ALLOWED_OUTSIDE = ['acquisition.html', 'CLAUDE.md', 'test/claim-check.test.mjs', 'test/video-bluesky-queue.test.mjs'];

/** The decision. `changed` is the list of paths that differ from the comparison base. */
export function evaluate(changed) {
  const list = Array.isArray(changed) ? changed : [];
  const feature = list.filter((f) => FEATURE.test(f));
  if (feature.length === 0) return { status: 'not_applicable', feature, prohibited: [], outside: [] };
  return {
    status: 'enforced', feature,
    prohibited: list.filter((f) => PROHIBITED.test(f)),
    outside: list.filter((f) => !FEATURE.test(f) && ALLOWED_OUTSIDE.indexOf(f) < 0),
  };
}

/** The branch's changed paths against its merge-base with `ref` (default origin/main). Never fetches: a ref that is not in this checkout is `available: false` with the reason. */
export function changedAgainst(ref = 'origin/main', cwd = process.cwd()) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let base;
  try { base = git(['merge-base', 'HEAD', ref]).trim(); } catch (e) { return { available: false, reason: ref + ' is not in this checkout (or shares no history with HEAD); the guard was not run' }; }
  if (!base) return { available: false, reason: 'no merge-base with ' + ref };
  try { return { available: true, base, changed: git(['diff', '--name-only', base]).split('\n').filter(Boolean) }; }
  catch (e) { return { available: false, reason: 'git diff against ' + base + ' failed: ' + String(e.message).split('\n')[0] }; }
}
