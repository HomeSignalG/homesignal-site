# SEO-ready ZIP pages — the 13 completed shards

**Shippable artifact, measured 2026-09-03.** Data: `completed-shards-zip-coverage.csv` (411 rows).
Definition of record: `scripts/n5_zip_coverage.sql`.

**Fingerprinted, not eyeballed.** The CSV body was verified against the database by md5 —
`2a3c0633cb1745d2902bdd3670fc83f5` on both sides, 411 rows. Control that the population is the
right one: `legacy_associations` sums to **20,170**, exactly the 13 shards' association count.

## Headline

**All 411 ZIP pages across the 13 completed shards are UNBLOCKED — pending = 0 on every one.**

| | |
|---|---:|
| ZIP pages | **411** |
| unblocked (pending = 0) | **411 — 100%** |
| blocked | **0** |
| adjudicated candidate developments | 12,320 |
| **pending (waiting on geometry)** | **0** |
| terminal (can never have geometry — disclosed, does not block) | 7,593 |
| legacy associations these pages carry today | 20,170 |

Pages per prefix: 010 **69** · 011 22 · 012 37 · 013 4 · 014 26 · 015 51 · 016 17 · 017 31 ·
018 47 · 019 38 · 062 33 · 063 35 · 520 1.

## ⚠️ Two states, and only one of them is finished

**UNBLOCKED ≠ PLACED. Do not ship the whole 411 as "done".**

| state | meaning | count |
|---|---|---:|
| **UNBLOCKED + PLACED** | pending = 0 **and** the boundary-first pass has computed this page's actual polygon membership | **69** (prefix 010 only) |
| **UNBLOCKED, not yet placed** | pending = 0 — nothing is waiting on geometry, so the page *can* be completed — but boundary-first has not run, so its true membership is not yet computed | **342** |

`placed_by_polygon` is populated **only for 010**. Elsewhere the column is empty — that is
"not measured", never "no developments".

**So the immediately shippable set is the 69 pages of prefix 010**, where geometry is complete
*and* the polygon membership exists. The other 342 need one boundary-first run each (0.9–1.3 s of
probe time per prefix, 12 prefixes) and no acquisition work at all.

## Why these 411 are unblocked when only 14.6% of the nation is

These prefixes are New England + one Iowa ZIP, and their RECOVERY registries — massdot, ctdot,
iowa-dot — are **already fully acquired**. Their large NOAUTH population (7,593 terminal, nearly
all in 016 Worcester) does **not** block, by design: waiting cannot change it, so it is disclosed
on the page instead of holding the page hostage.

## What 010 actually shows

630 developments placed by polygon across 69 pages, against 1,689 legacy associations —
**a net reduction of 1,059**, of which **89 are developments the legacy 3-mile method never
associated with the page at all** (under-inclusion, now visible). Three pages — **01034, 01054,
01093** — carry placed developments with **zero** legacy candidates: pages that would have shown
nothing, and now show something real.

## The gate, restated

```
pending = 0   ->  UNBLOCKED    (no development on this page is waiting on geometry)
placed  set   ->  PLACED       (boundary-first has computed the true polygon membership)
SEO-ready     ==  UNBLOCKED and PLACED
```
