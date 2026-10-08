# Epoch timeline record key — receipt, 2026-10-01

**Status: APPLIED to production 2026-10-01 17:11–17:12 UTC (PR #1507, squash `d2b13465`). The geography job did NOT get faster — see "Applied" and "What the geography job is actually spending".**

> **Later the same day (2026-10-01 22:46 UTC) the geography job WAS fixed**, by a different change: the identity-open view now reads the record keys once (PR #1523). Its run time went from 210.6 s to 26.9 s, and was 42–45 s a week later. See `docs/dc-identity-open-fast-receipt-2026-10-01.md`. The "not yet fixed" wording below is the dated record of 17:57 UTC and is left standing.

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

## Applied (2026-10-01, outside UTC :18–:45 and not at :10)

- **Applied** 17:11:20 as migration `epoch_timeline_record_key` (ledger `20261001171120`). Stored text md5 `c26e3a22582a16abc61be628dfe9cf9b`
  (8,521 chars) equals the committed file with its trailing newline stripped. The guard passed (view md5 was `12d40cc3…`).
- **Resolver pass** 17:12:00, one-off cron job through `dc_resolve_serialized('canonical')` under a 300 s ceiling, **22.4 s, succeeded**,
  self-unscheduled (0 jobs left).
- **Read-back against the baseline taken 17:06, each beside a control:**

| measure | before | after |
|---|---:|---:|
| live timeline entities | 4,887 | **548** = distinct (name,Date) over all timeline observations (548) |
| live entities, all sources | 7,267 | 2,928 (−4,339, exactly the superseded count) |
| entity / link / decision rows | 7,449 / 32,170 / 21,491 | **7,449 / 32,170 / 21,491** (nothing deleted) |
| non-timeline link fingerprint | `92b3b59a…` | `92b3b59a…` (equal) |
| resolved canonical markers (id@lat,lng fingerprint) | `a1dfcdd7…`, 1,836 | `a1dfcdd7…`, 1,836 (Map 1's canonical set unchanged) |
| current timeline observations on a retired entity | — | 0 |

  4,339 entities carry `supersede_reason 'SAME_RECORD_GROUP: epoch_ai|timelines|name+date:%'`.

## What the geography job is actually spending — the leftovers were NOT the driver

The 17:35 run, the first after the clear, took **199.0 s** (164.1 s the hour before; 157.2 s at 17:35 yesterday). History at 17:35 daily:
9.3 · 6.8 · 82.6 · 94.2 · 98.4 · 101.5 · 157.2 · **199.0** s (09-23 → 10-01). Removing ~4,300 live entities from its input moved nothing.

Timed in isolation, as a read-only one-off (production, 17:46 and 17:49, two runs agree):

| piece of the geography run | rows | time |
|---|---:|---:|
| `dc_entity_geography_evidence` | 2,978 | 1.5–3.0 s |
| `dc_observation_derived_point` (admitted) | 2,383 | 0.8 s |
| `dc_observation_record_key` | 32,170 | 0.0 s |
| **`dc_entity_identity_open`** | 272 | **192–197 s** |

**One view is ~97% of the run.** It adjudicates every candidate pair (`cross join lateral dc_adjudicate_pair`, 2,338 candidates) and then runs a
correlated `NOT EXISTS` that joins `dc_observation_record_key` (a window-function view over all observations) once per surviving row. Its
cost scales with the observations table, which grows every day, so the job will keep growing until it meets the 300 s ceiling. This is
measured, not yet fixed: the next step is to rewrite that view with the same output (same rows, proven by a parity check on production)
and is a change to a shared identity definition, so it goes through the gated process.

⚠️ **A harness defect, recorded so it is not repeated.** A one-off cron job that unschedules itself in the same multi-statement command is
rolled back with the rest when a later statement raises, so my timing probe (which raises on purpose to return its message) re-ran every
~3 minutes (17:46, 17:49, 17:52, 17:55) until unscheduled by hand. Read-only, nothing written, 0 jobs left; the first one-off (which did not raise) behaved.
