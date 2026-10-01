# Epoch timeline record key — receipt, 2026-10-01

**Status: NOT YET APPLIED to production.** Merged text and the production read-back go in "Applied" below once it is.

**What ships:** `docs/dc-epoch-timeline-key-apply.sql` (the production artifact), the same two statements in
`docs/dc-step3a-canonical-identity.sql` (the DDL of record), `test/dc_epoch_timeline_key_pg/` (the rehearsal) and a
two-line update to `test/dc-epoch-geography-structure.test.mjs` (see "The rule that was tested", below).

## The defect, measured on production (2026-09-30, every count with its control)

`epoch_ai/timelines` carries several milestones per data centre, so a name repeats inside a run, and the step 3A rule
("a name is a key only when it is unique in its run") leaves every row a singleton. Every daily pull therefore mints a
fresh canonical entity per row, and yesterday's entities are never matched again.

| measure | value | control |
|---|---:|---|
| timeline observations | 3,798 over 7 runs | per-run rows 535–545 |
| timeline-only entities | 3,798 (one per observation) | 0 entities mix timeline and other evidence |
| of those, with current evidence | 545 | = rows in the latest run |
| of those, **no current evidence** | **3,253** | all live (`superseded_by` null), all unclassified |
| of those, with a geometry | **0** | so none is on Map 1 |
| identity decisions touching a timeline observation | 15,290 | **0 CONFIRMED_MATCH** — all UNRESOLVED or CANDIDATE_MATCH |

The geography resolver walks `where e.superseded_by is null`, so the 3,253 are in its input every hour. Whether they
are the reason it went from ~102 s to ~138 s is **not proven** (see "What this does not claim").

## The key

`(Data center, Date)` is unique inside every run (per-run rows = distinct pairs, 7 of 7) and persists: of 546 distinct
pairs over seven runs, **534 appear in all seven**, 4 in six, 7 in five, 1 in one. No row lacks either part
(`bad = 0` in every run).

A new registry, `public.dc_record_key_discriminator` (one row: `epoch_ai / timelines / Date`), names the payload field
that pairs with the name for a distribution. The key view reads the registry, so **no source is named in the rule**.
Key = `<source>|<distribution>|name+date:<name>|<date>`, rank 1, only when the pair is unique in its own run. A repeated
pair stays two singletons; a row missing the field falls through to the pre-existing name rule, unchanged. A renamed or
re-dated milestone mints a new key — the cost the step 3A name rule already states.

## What it does to the stored entities — nothing is deleted

The next `dc_resolve_canonical` run groups every timeline observation by the new key, anchors each group on its oldest
entity, relinks the group's observations to it and **supersedes** the other entities (`supersede_reason =
'SAME_RECORD_GROUP: <key>'`) — the mechanism that already retired 182 Epoch entities (all 182 have `superseded_by` set
and no observation). Entities, links and identity decisions are all kept; the geography resolver and Map 1 read only
entities with `superseded_by` null. The founder chose "rule fix plus one-time clear" on 2026-09-30; the clear is the
resolver's own supersede, not a delete, because the delete would have left the audit trail and the `dc_entity_geography`
rows (no cascade) to be handled by hand and would have needed an archive table for nothing.

## Proof (stand-in, shipped resolver — its `prosrc` md5 equals production's `ba2a7505…`)

`test/dc_epoch_timeline_key_pg/run.sh`: **22 shipped checks**, then **6 deliberate breaks, all killed on exit code**.

- **K1** the defect reproduced on production's own old view (md5 `12d40cc3…`): 18+18+19 daily rows mint 55 entities, 19 with current evidence.
- **K2** the apply file refuses a view that is not the definition it replaces; re-applying is a no-op.
- **K3** one resolver pass: 55 → **20 live** (18 distinct pairs + 1 re-dated + 1 new); 35 superseded, 35 observations relinked, **0 minted**; entity/link/decision row counts and the timeline link count identical before and after; the 19 current rows all sit on live entities; a re-dated milestone keeps both dates as separate records.
- **K4** a new daily run mints exactly one entity (the new milestone).
- **K5** a repeated (name,date) pair is two rank-2 singletons; a row with no Date falls through to the old name rule.
- **K6** a second pass writes nothing; the geography resolver considers exactly the live entities.
- **K7** `epoch_ai/data_centers` links are byte-identical before and after (fingerprint).
- **K8** the registry and view statements in the apply file are byte-identical to the DDL of record; the key view names no source.
- Breaks killed: no rank 1 · key ignores the date · uniqueness ignores the date · guard removed · registry seed widened to a second distribution · registry readable by anon.
- The existing Epoch PostGIS suite (`dc_epoch_geography_pg`: 38 checks, 44 of its own breaks killed, exit 0) passes with the change; the structure suites for step 3A/3B, the watcher and the hardening pass.

## The rule that was tested

`test/dc-epoch-geography-structure.test.mjs` S1b says production SQL names `epoch_ai` only in the source-keyed rules.
The registry seed is the one place a source is now named **as data**. S1b strips that one statement, and two new checks
pin that it is exactly `epoch_ai/timelines/Date` and that the key view itself names no source. The rule is not
loosened for anything else.

`docs/dc-epoch-geography-apply.sql` still carries the old view text. It is a **frozen applied artifact** (S6 pins its
sha256) and is never re-applied; re-applying `docs/dc-step3a-canonical-identity.sql` keeps the new rule.

## What this does not claim

- That the geography job gets faster. It removes ~3,250 live entities from that job's input and stops ~545 a day being
  added; the run time before and after is measured at apply time and reported, not assumed.
- That the leftovers' `dc_entity_geography` rows disappear. They stay (status `GEOGRAPHY_UNRESOLVED`, no geometry),
  exactly as the 182 earlier superseded entities' do.
- `link_rule_key` on the new links reads `SAME_SOURCE_SAME_NAME_UNIQUE_IN_RUN` (the resolver derives it from rank 1);
  for timelines it now means name + date. Changing the label means changing the shared resolver and is not done here.

## Apply plan (production — nothing here has been run)

1. Merge. Apply `docs/dc-epoch-timeline-key-apply.sql` outside UTC :18–:45 and not at :10 (guard + post-conditions refuse a drifted view).
2. Run `dc_resolve_canonical` once through the serialized wrapper (one-off cron job with a 300 s ceiling, self-unscheduling), so the consolidation does not wait for :25.
3. Read back, each beside a control: live timeline entities = distinct (name,date) among all timeline observations; entity/link/decision counts unchanged; `data_centers` fingerprint equal; Map 1 member fingerprint equal before and after; next geography run succeeds and its duration; next acquisition mints ≈ only new milestones.
