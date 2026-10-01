# Step 14 (C10): the final data-centre address-check receipt — 2026-09-29

**Goal:** every data-centre marker on Map 1 is checked against the street address its own publisher states,
through the one shared production geocoder. Each marker is confirmed, withheld for disagreeing, or recorded as
uncheckable with a reason.

This document reads the live production view `public.dc_map1_address_check` (one row per Map 1 marker) once,
on 2026-09-29 about 00:40 UTC, and reports what it says. Nothing here is a projection.

## The partition: 1,817 markers, each in exactly one bucket

| layer | checked | checkable, no clean match | not checkable | total |
|---|---:|---:|---:|---:|
| canonical (Atlas, Epoch) | 493 | 102 | 377 | **972** |
| OpenStreetMap | 303 | 127 | 415 | **845** |
| **both layers** | **796** | **229** | **792** | **1,817** |

796 + 229 + 792 = **1,817**, the marker total. Pending: 0.

### Why each marker is where it is

| bucket | reason | canonical | OSM |
|---|---|---:|---:|
| checked | corroborated by its own address | 492 | 303 |
| checked | placed at its own address | 1 | 0 |
| no clean match | geocoder found no match | 93 | 127 |
| no clean match | ambiguous match | 5 | 0 |
| no clean match | match diverges from the pin | 4 | 0 |
| not checkable | publisher gives no address | 349 | 386 |
| not checkable | no house number | 25 | 1 |
| not checkable | house number is a range | 3 | 0 |
| not checkable | no locality | 0 | 28 |

Every row of the table sums to its column total above.

## Coverage

- **Coverage = checked / (checked + checkable) = 796 / (796 + 229) = 77.7%.**
- Not checkable markers (792) are outside that fraction because the publisher states no usable street address.
  Checking them would mean inventing one.
- Say which unit when quoting this: 796 of 1,817 markers (43.8%) are confirmed by their own address. 77.7% is the
  share of markers that *can* be checked and were.

## Controls

- **Marker total agrees with the stored daily snapshot.** `dc_address_check_daily`, newest row 2026-09-28
  11:50:00: 1,817 markers (972 canonical, 845 OSM), 796 checked, 229 no clean match, 792 not checkable,
  0 pending, **0 invariant breaks**, geocode queue 0. Every count is identical to the live read.
- **Withheld markers are not in this table by construction.** A pin the publisher's own address disagrees
  with is withheld from Map 1, so it is not one of the 1,817. The view describes what residents can see.
- **The monitor is live.** `dc_address_check` in the health monitor reads the daily snapshot (step 12) and pages
  on: a stale snapshot, any invariant break, a stuck geocode queue, a fall of more than 5% in markers or
  checked, or a change in the admitted set or the shared decision functions. No alert has fired since the apply.

## What was done, in order

| step | change | result |
|---|---|---|
| 1–7 | OSM markers checked through the shared geocoder; Map 1 OSM change rehearsed on a replica, gated, applied | measured after each apply |
| 8 | no-match addresses studied | no safe policy fix; they stay unchecked (recorded) |
| 9 | shared verdict tightened | Map 1 1,816 → 1,817; 3 withheld pins restored, 3 false corroborations withdrawn |
| 10 | Epoch timelines | not sites (no address, no coordinates); never on Map 1; no rule needed |
| 11 | per-marker view `dc_map1_address_check` | 1,817 of 1,817 rows carry a reason |
| 12 | daily monitor `dc_address_check` | baseline 1,817 / 796; scheduled snapshot identical, no alert |
| 13 | marker-loss watcher | canonical layer dark 1.07 / 0.85 / 0.81 min on the 09-28 acquisitions (was 35.5) |

## Open items, recorded and not fixed here

1. **229 checkable markers have no clean match: 220 because the geocoder finds no address point** (93 canonical
   + 127 OSM), 5 ambiguous and 4 that diverge from the pin. Loading a national address-point set is a founder
   decision (no safe policy change fixes it).
2. **`dc-resolve-geography` runs 101–108 s against the 120 s statement timeout** and was cancelled once
   (2026-09-28 20:35). No health check watches the resolver jobs.
3. **`dc_resolve_canonical` can be executed by `anon`, `authenticated` and PUBLIC.** Revoking by name should break
   nothing; it belongs to the anon-surface work.
4. **Leftover Epoch timeline entities** accumulate (about 545 a day) and are not drawn on Map 1. Their effect on
   geography run time was measured and refuted (step 13 receipt).
5. **A replay of the step 3a/3b DDL would put back the unlocked resolver commands**; re-applying
   `docs/dc-marker-loss-watcher.sql` restores the lock.
6. **`cron.job_run_details` is never purged.**
