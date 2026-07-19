# Phase 1B P0 — SQL migrations (docs only)

**Do not auto-apply.** These files are the reproducible DDL for the Phase 1B P0
control plane. Apply manually in the Supabase SQL editor when authorized.

## Apply order

1. `docs/gov-feeds-phase1b-p0-schema.sql` — `feed_candidates`, audit, circuit tables
2. `lib/generated/transitions.sql` — legal transition seed (also embedded in functions file)
3. `docs/gov-feeds-phase1b-p0-functions.sql` — `transition_feed_candidate` RPC
4. `docs/gov-feeds-phase1b-p0-views.sql` — funnel, stuck, active feed views

## Regenerate transition artifacts

When `scripts/gov-feeds/spec/transition-spec.v1.json` changes:

```bash
node scripts/gov-feeds/gen/generate-transition-artifacts.mjs
```

Then re-copy or `\ir` the updated `lib/generated/transitions.sql` into the functions file.

## Single source of truth

| Artifact | Source |
|----------|--------|
| JS transitions | `lib/generated/transitions.mjs` |
| SQL transitions | `lib/generated/transitions.sql` |
| Spec | `scripts/gov-feeds/spec/transition-spec.v1.json` |
| Registry columns | `scripts/gov-feeds/spec/registry-schema.v1.json` |

## P0 scope boundaries

- No production data modifications from this repo
- No county onboarding
- No Pilot A until P0 is applied and verified in a staging environment
- Golive job queue (`golive_jobs`) deferred to P1

## Verification

After applying schema (staging only):

```sql
select count(*) from public.feed_candidate_transitions;
-- expect 41 rows (transition_spec_version 1.0)

select * from public.v_feed_candidates_funnel limit 5;
```

Unit tests in this repo validate spec ↔ generated artifact sync offline:

```bash
node scripts/run-unit-tests.mjs
```
