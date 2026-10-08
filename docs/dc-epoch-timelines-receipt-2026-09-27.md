# Step 10 (C6): the 545 Epoch "timeline" records — receipt, 2026-09-27

**Verdict: no address rule is written, and none should be.** The 545 records are not sites. They are the
rows of Epoch's `timelines` dataset: dated snapshots (date, power, construction status, costs) of data
centres named in their `Data center` field. Nothing in them can be checked against an address, and none of
them can appear on Map 1. They are already excluded from the address check.

## What they are (production, read-only)

- The `dc_geocode_input` outcome for current Epoch records:
  - `NO_GEOCODE_RULE` 545 (all `epoch_ai/timelines`)
  - `GEOCODABLE` 58, `NOT_US` 16, `BLANK` 8, `HOUSE_NUMBER_RANGE` 5, `NO_HOUSE_NUMBER` 4, `NO_LOCALITY` 2
    (all `epoch_ai/data_centers`)
- The payload keys of a timeline row are:
  - `Date`, `Data center`, `Construction status`, `Buildings operational`;
  - power, IT power, H100 equivalents and performance;
  - costs and water use.
  - There is **no address key**.
- Of the 545: **0** carry coordinates, **0** carry an address, and **0** is the geography authority for any
  entity. They reference **93** distinct data centres.
- `dc_observation_derived_point` already filters `input_quality <> 'NO_GEOCODE_RULE'`, so they never reach
  the queue, the geocoder or a verdict. That is correct.

**Where the address for those 93 data centres is checked:** on their own `epoch_ai/data_centers` records,
through the shared chain (58 geocodable today). A timeline row adds dates and capacity, never a location.

## Why they are not merged into their data centre

By design (`docs/dc-step3a-canonical-identity.sql`, stable record keys):
- A timeline row has no publisher record id.
- Its name repeats across snapshots, so it gets no stable key and **stays a singleton entity**.
- The rule is the uniqueness measurement; nothing is guessed from the name.

All 545 current timeline entities are `CLASSIFICATION_UNRESOLVED` / `NO_COORDINATES`, so none is on
Map 1. The coverage goal counts Map 1 markers, so **these records do not enter the coverage partition.**

## A separate defect found here: leftover timeline entities accumulate every day

| day | timeline entities minted | Epoch timeline acquisitions |
|---|---:|---:|
| 2026-09-23 | 535 | 1 |
| 2026-09-24 | 538 | 1 |
| 2026-09-25 | 545 | 1 |
| 2026-09-26 | 545 | 1 |
| 2026-09-27 | 545 | 1 |

- Each daily acquisition gives every timeline row a new singleton entity.
- The previous day's entities are **never retired**. Today:
  - **2,163 live, unclassified, timeline-only entities have no current observation at all**;
  - plus the 545 current ones, for 2,708 in total.
- Resident impact: **none**. They have no coordinates and no classification, so they never reach Map 1.
- Cost: the entity table and the resolvers' work grow by about 545 rows a day, about 200,000 a year.

A fix is an identity-rule change: retire an entity once none of its observations is current. It goes
through the same gated process as C3c/C7. It is recorded as its own item and not bundled with this step.
