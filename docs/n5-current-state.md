# N5 / Map 1 generation: current state (2026-10-23)

A short pointer file. CLAUDE.md §7.13 holds the dated receipts and is not rewritten; this file says
what runs today. Re-read production before quoting any figure here.

## What runs
- **Daily, unattended.** pg_cron job 69 `n5-generation-dispatch` (`47 * * * *`) dispatches
  `n5-generation.yml` with `mode=work, auto=1`; GitHub's `17 * * * *` schedule is a second trigger.
- **A tick** opens `n5-national-<UTC date>` when nothing is building (at most one per 20 h, only with
  free disk above the floor), works shards, publishes, marks READY, **proves**, then activates.
- **Switch rule.** `geo.n5_generation_activate` accepts only the newest recorded proof, only if it
  passed, only against the generation still serving. A refusal turns the tick red; the generation
  stays READY and the next tick proves again.
- **Keep two.** After each activation, SUPERSEDED generations other than the serving one's
  predecessor are discarded. `legacy-phase1-2026-09-01` is protected.

## The proof
- **Data half** `geo.n5_generation_preactivation_problems(candidate, baseline, declared_no_boundary)`:
  prefix receipts equal their rows, status rows are canonical, the no-boundary ZIPs are exactly the
  declared list (`docs/maps-coverage/fix4/no-boundary-zip-classification.csv`, 706), no member on an
  unmeasured ZIP, and every (ZIP, project) that left is explained.
- **Browser half** `scripts/n5_preactivation_browser.mjs`: a 48-ZIP sample (up to 32 changed, up to 2
  large changed, one unmeasured, a spread) rendered in the real `homesignalmap.html` under both
  generations. A large ZIP that cannot be read is skipped and recorded as `large_skipped`; an ordinary
  sample ZIP that cannot be read stops the proof.
- **Negative control** `MODE=prove_negative` (dispatch-only, read-only, records nothing): runs the data
  check on a generation that already passed, with a declared list wrong in a known way, and fails
  unless each is refused for its own reason. Run it after any change to Part D or to the declared list.
- **Rehearsal** `MODE=prove_dry` renders the sample and records nothing.

## Alarms (homesignal-ingest, `public.pipeline_health_check`)
- `n5_map1_build`: no progress for 6 h, no build running while the serving map is older than 72 h, or
  two builds in flight.
- `n5_proof_failing` (ingest `20261023160000`): a READY generation whose newest proof failed and has
  failed at least twice. It means the switch is stuck, not that the proof ran once and failed.

## Rollback
`MODE=rollback` with a `reason` restores the superseded predecessor by state alone (no rows copied). The
predecessor is the serving generation's `predecessor_generation_id`; keep-two guarantees it exists.

## Not done
- The cause of the 2026-10-08 `home-index.browser.test.mjs` failures is unknown. The unit-test runner now
  re-prints a failed file's output at the end of the log, so the next occurrence is recoverable.
