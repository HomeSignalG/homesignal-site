# Regulated facility whole-ZIP — GATE 0-3 source equivalence receipt (2026-09-05)

Read-only. No database write, no schema change, no read-path change. Evidence channel is
the job log, as with `recon-fetch.yml` and `db-sql.yml`.

Runs: **33982804645** (`frs-gate0-overlap`) and **33983286911** (`frs-gate0-diff`), workflow
`phase2-b1-zcta.yml`, branch `claude/map1-production-ready-g5qu07`.

Why a runner at all: this session's agent proxy answers `CONNECT ordsext.epa.gov:443` with
**403 (policy denial)** — recorded in its own status endpoint as
`{"kind":"connect_rejected","host":"ordsext.epa.gov:443"}`. Postgres has egress through
pg_net but cannot unzip a 2.68 GB archive.

## The artifact — discovered, not remembered

| | |
|---|---|
| discovery | EPA's own download page, HTTP 200, 77,639 bytes, **58 `.zip` links** |
| url | `https://ordsext.epa.gov/FLA/www3/state_files/national_single.zip` |
| bytes | 349,469,314 |
| sha256 | `e30750f12108ebdb4e7d2e6b3ddddf775674fc3a77ecd53c5d949c23a391eb23` |
| Last-Modified | Fri, 07 Aug 2026 16:04:34 GMT |
| integrity | ZIP magic `PK\x03\x04`; **CRC OK across 2 members** |
| members | `NATIONAL_SINGLE.CSV` 2,681,711,036 bytes · `Facility State File Documentation 11132012_new.pdf` |
| columns | 39 — `REGISTRY_ID`@1, `PRIMARY_NAME`@2, `LATITUDE83`@31, `LONGITUDE83`@32 |

The previously recorded probe (`docs/proposals/epa-outage-fallback-and-copy.md`, 2026-08-10)
called this file "multi-GB; unusable from an edge function". **The compressed artifact is
0.35 GB and downloads in 131 s on a runner**; that note was right about an edge function and
should not be read as ruling the file out for a batch job.

## GATE 1 — eligibility parity

The predicate is unchanged: `index.ts::looksIndustrial`. `scripts/frs_eligibility.py` PARSES
its token sets out of `index.ts` rather than transcribing them, and the parse fails closed.

`test/frs-eligibility-parity.test.mjs` evaluates the JS side **from the shipped source spans**,
so the two implementations cannot be made to agree by editing a duplicate.

* offline: **825** adversarial + production names — 0 mismatches
* on the runner: **60,825** names (the same 825 plus **60,000 real `PRIMARY_NAME` values read
  straight out of the archive**) — **0 mismatches**, 17/17 assertions
* corpus exercises both verdicts: 60,280 eligible / 545 not

## GATE 2 — identity

| | |
|---|---:|
| source rows | 5,300,149 |
| eligible rows (`looksIndustrial`) | 423,217 |
| `REGISTRY_ID` null | **0** |
| `REGISTRY_ID` blank | **0** |
| duplicate `REGISTRY_ID` rows | **0** |
| RegistryIds with a conflicting coordinate | **0** |
| RegistryIds with a conflicting name | **0** |
| distinct eligible RegistryIds with proven geography | 333,453 |

The national single file carries **one row per facility registry**. `epa_frs:<RegistryId>` is a
defensible physical-site identity in this source with nothing to adjudicate.

## GATE 3 — geography

| | |
|---|---:|
| PROVEN physical points | **333,453** |
| GEOGRAPHY_UNRESOLVED (no coordinate) | **89,764** |
| non-numeric | 0 |
| 0/0 sentinel | 0 |
| out of range | 0 |

`423,217 = 333,453 + 89,764`, exact. Nothing is invented for the 89,764.

Physical-site vs mailing semantics is answered from the source's **own** vocabulary, not from
an assumption about EPA. `REF_POINT_DESC`, 40 distinct values, top of the distribution:

```
ENTRANCE POINT OF A FACILITY OR STATION   119,709
CENTER OF A FACILITY OR STATION           117,111
(blank)                                    69,955
POINT WHERE SUBSTANCE IS RELEASED           6,951
ACRES POINTS NOT REPRESENTED BY 101-107     5,784
PLANT ENTRANCE (GENERAL)                    4,387
FACILITY CENTROID                           3,590
CENTER OF FACILITY                          1,626
```

`COLLECT_DESC` (47 distinct) describes HOW the point was derived — `ADDRESS MATCHING-HOUSE
NUMBER` 199,447, `GPS - UNSPECIFIED` 3,788, interpolation classes — which is method, not a
mailing address. `GEOMETRIC_TYPE_CODE` is not present in this file.

## GATE 0 — overlap against the REST-derived corpus

Not a population-equality test: the radius path is incomplete by construction, which is the
defect being fixed. What must hold is identity and coordinate parity on what they share.

| | |
|---|---:|
| REST distinct RegistryIds | 113,893 |
| BULK distinct eligible RegistryIds | 333,453 |
| overlap tested | 112,449 |
| **RegistryId match** | **112,449 (100%)** |
| FacilityName exact/equivalent | 111,914 (99.524%) |
| coordinate equivalent (<=1e-4 deg) | 111,711 (99.344%) |
| material coordinate conflicts | 738 |
| REST-only ids | 1,444 |
| BULK-only ids (the radius never reached them) | 221,004 |

### The 1,444 REST-only ids, every one placed in exactly one bucket

| bucket | ids |
|---|---:|
| present, eligible, coordinate present | 112,449 |
| **ABSENT from the file** | **678** |
| **present but `PRIMARY_NAME` is INELIGIBLE** | **314** |
| **present, eligible, NO COORDINATE** | **452** |
| **sum** | **113,893** (exact) |

### The 738 coordinate conflicts, in metres

| band | n |
|---|---:|
| < 100 m | 198 |
| 100 m - 1 km | 394 |
| 1 - 10 km | 77 |
| > 10 km | **69** |

median 226.0 m · p90 7,730.8 m · **max 2,965,457 m**

## VERDICT, and the one thing it does NOT settle

**Identity semantics: PROVEN.** `REGISTRY_ID` is the same identity in both sources — 112,449 of
112,449 matched, 0 duplicates, 0 intra-file conflicts.

**Coordinate semantics: PROVEN.** `LATITUDE83`/`LONGITUDE83` are physical-site coordinates by the
file's own `REF_POINT_DESC` vocabulary, and agree with the REST corpus on 99.344% of the overlap.

**NAME semantics: NOT THE SAME FIELD, and it changes what qualifies.** The bulk's
`PRIMARY_NAME` is the canonical registry name; the REST service's `FacilityName` is frequently
the operating/site name. Where the site name carries the industrial word and the registry name
does not, the same unchanged predicate reaches a different verdict:

```
110000425807  REST 'SKYWATER TECHNOLOGY FOUNDRY INC'    vs BULK 'SKYWATER TECHNOLOGY INC'
110000348589  REST 'ATI SPECIALTY MATERIALS, MONROE PL' vs BULK 'TELEDYNE ALLVAC'
110000329715  REST 'SHERMAN-WILLIAMS MANUFACTURING COM' vs BULK 'THE SHERWIN-WILLIAMS CO'
110000319012  REST 'MOTIVA ENTERPRISES LLC SEWAREN PLA' vs BULK 'EQUILON ENTERPRISES LLC (DBA SHELL'
```

**314 facilities Map 1 shows today would stop qualifying** if `PRIMARY_NAME` alone became the
eligibility input. The predicate has exact parity; the INPUT does not. This is a founder
decision — keep the REST name as the eligibility input, accept the 314, or take both names —
and it is recorded here rather than decided.

Two further items are reported as measured, not explained away:

* the **678 absent** ids are consistent with the archive being a month old (Last-Modified
  2026-08-07) against a daily-refreshed REST corpus, but that is a hypothesis; it was not
  tested and is not asserted.
* the **69 conflicts over 10 km** are two EPA endpoints disagreeing with no adjudication rule
  between them. Most are small water-system sub-facilities (`...-TREATMENT PLANT`,
  `...-TREATMENT ROOM`). A rule for choosing between them has to be decided, not invented.
