# Fix 4: the 706 canonical ZIPs with no boundary (2026-10-01)

**Question.** 706 of the 12,722 canonical ZIP pages have no Census ZCTA boundary, so Map 1 serves
them as `not_measured`. Is each one a legitimate non-ZCTA ZIP (PO Box, unique, retired, or a ZIP
Census did not delineate), or a boundary HomeSignal failed to acquire or publish?

**Answer.** All 706 are legitimate. **0 are HomeSignal omissions**, so there is no TIGER/ZCTA
acquisition or generation defect to correct. All 706 stay `not_measured`, as they are today.
Nothing in production was changed.

## 1. The classification

Decided once, by `scripts/fix4_classify_no_boundary_zips.py`, from three committed inputs:
the production export, the Census evidence, and the pinned USPS dataset (zipcodes 3.0.0, the one
every community build uses). Output: `docs/maps-coverage/fix4/no-boundary-zip-classification.csv`
(one row per ZIP) and its `.summary.json`.

| class | ZIPs | what it is | disposition |
|---|---:|---|---|
| `USPS_PO_BOX` | 498 | active PO Box-only ZIP | stays `not_measured` |
| `USPS_UNIQUE` | 107 | active ZIP for one organization or building | stays `not_measured` |
| `USPS_STANDARD_NO_CENSUS_ZCTA` | 52 | active standard ZIP; the 2020 Census delineation published no ZCTA for it | stays `not_measured` |
| `USPS_RETIRED` | 47 | decommissioned in the USPS dataset (19 standard, 20 unique, 8 PO Box) | stays `not_measured` |
| `NOT_IN_USPS_DATASET` | 2 | 84684 "West Mountain", 84685 "Woodland Hills" | stays `not_measured` |
| `USPS_MILITARY` | 0 | | |
| `HOMESIGNAL_OMISSION` | **0** | Census publishes a current ZCTA and HomeSignal lacks it | would be corrected |
| **total** | **706** | | |

Rules, tried in this order: Census has a current ZCTA → omission. Otherwise: not in the USPS
dataset → `NOT_IN_USPS_DATASET`; inactive → `USPS_RETIRED`; else the USPS type. **An omission is
decided only by Census evidence, never by USPS type.**

Where the 52 standard ZIPs are:
- 30 in New York City: 25 in Manhattan (10041 … 10281) and 5 in Brooklyn (11241-11243, 11252,
  11256);
- 3 in Dallas (75242, 75260, 75398), and 2 each in Austin (78710, 78799), Seattle (98131, 98161)
  and Chicago (60699, 60701);
- 1 each: 01152, 01252, 01655, 02222, 11351, 19110, 48924, 60037, 60199, 60599, 78135, 79910 and
  98413.

This record does not claim why Census delineated no ZCTA for each one. It records only that Census
publishes none.

## 2. Why "0 omissions" is a measurement, not an assumption

An omission would be one of two failures. Each was checked against production on 2026-10-01.

**Acquisition: is `geo.zcta_boundary` missing a Census ZCTA?** No.
- `geo.zcta_boundary` holds 33,791 distinct codes, md5 (collate "C") `7e927a8e…`, all loaded from
  TIGER/Line 2025 (2020 delineation).
- Census TIGERweb was read from Postgres through pg_net. TIGERweb is a different carrier from the
  TIGER/Line archive.
  - Layers read: tigerWMS_Current/2, and PUMA_TAD_TAZ_UGA_ZCTA/1, /4 and /7.
  - Every layer returned 33,791 codes with the same md5 `7e927a8e…`: 0 codes in Census and not in
    HomeSignal, 0 the other way.
  - Positive control: each layer contains all 12,016 registry ZIPs that do have a boundary.
- **The four layers returned byte-identical bodies** (response md5 `f5c1c0ac…`). They are one
  dataset served four ways, so this is **one** independent check, not four.
- **0 of the 706** appear in the current Census set.

**Generation: does the serving generation call a boundary ZIP `not_measured`?** No.
- The ACTIVE generation, `n5-national-2026-09-29`, has 12,722 status rows.
- Its 706 `not_measured` rows are exactly this set (md5 `7d1bf19a…`, the same as the export), and
  its 12,016 rows are `boundary_complete`.
- All 12,016 registry boundaries are valid, non-empty `MULTIPOLYGON`s (SRID 4269).
- Fix 3's Part G check (applied 2026-09-29) refuses READY or ACTIVATE on any status that disagrees
  with `geo.zcta_boundary`.

**Context only: the 2010 delineation.** TIGERweb's 2010 ZCTA layer (33,144 codes; positive control
11,757) contains **9** of the 706, which had a ZCTA in 2010 and lost it in 2020:
- PO Box: 01086, 01467, 02651, 02669, 80511
- unique: 01199
- standard: 11351
- retired: 98205, 98929

A superseded 2010 polygon is not a boundary for a current page and was not used.

**The two ZIPs no dataset knows.** 84684 ("West Mountain"; its page name carries no ZIP) and 84685
("Woodland Hills") are absent from:
- zipcodes 3.0.0;
- a second, older, independent ZIP database (pyzipcode 3.0.1's bundled `zipcodes.db`, 43,191 ZIPs),
  which does carry the controls 84653, 10104 and 02222;
- both Census delineations.

So whether either one is a real USPS ZIP is **not established**. They stay `not_measured`. Whether
they should be pages at all is the existing page-eligibility question (QUEUE, Fix 29 "NOT taken").
The registry is founder-owned and was not touched.

## 3. What was deliberately not changed

- No polygon was created, borrowed from a neighbor, taken from 2010, or derived from a centroid or
  radius.
- No status row, note, page copy or registry row changed. The `not_measured` rows already say
  `NO_ZCTA_BOUNDARY: canonical ZIP has no Census ZCTA polygon`, and the page contract already treats
  them as unmeasured, not zero.

## 4. What keeps it honest

- `scripts/fix4_classify_no_boundary_zips.py` is the only place a class is decided. It refuses to
  run unless:
  - the input export matches the database's own fingerprints (rows md5 `18edb6de…`, zip md5
    `7d1bf19a…`);
  - every current Census layer in the evidence is the boundary table's code set;
  - every Census read has a non-zero positive control;
  - zipcodes is exactly 3.0.0.
- `test/no-boundary-zip-classification.test.mjs` runs in the offline unit suite, 27 checks:
  - the input is the export;
  - the output covers it row for row and matches its summary;
  - the vocabulary is closed, and each class carries the founder's disposition, including classes
    no row has today;
  - an omission is exactly a ZIP Census has a current ZCTA for;
  - there are 0 omissions.
- `.github/workflows/no-boundary-zip-classification.yml` regenerates from the pinned inputs and
  fails on any difference. That is the half needing PyPI. It holds no secret and reads no database.
- Mutation-tested on exit code against a throwaway copy, 13 variants, all caught:
  - Hand-edited classes, and a hand edit that also kept the summary consistent, are caught by the
    regeneration check.
  - A dropped input row and a wrong Census layer are caught by both.
  - A zero positive control is caught by both.
  - An omission introduced into the evidence fails the offline test whether or not the output is
    regenerated.
  - A USPS type that decides "omission" is caught.
  - A removed Census rule is caught.
  - An omission disposition changed to `not_measured` is caught.

## 5. Finding, recorded and not built (Rule 16)

**Fix 3's check trusts `geo.zcta_boundary` to be complete.** READY and ACTIVATE refuse a status
that disagrees with the boundary table. But if a boundary row were deleted or a reload came up
short, the ZIP would publish as `not_measured`, agree with the table, and pass every check.

- Today it is complete: the md5 equals Census, as in §2.
- Two possible guards, both changes to the daily build's READY/ACTIVATE (a Part D/H change), and so
  their own unit:
  - require the table to still fingerprint to the Census set (33,791 codes, `7e927a8e…`); or
  - require every `not_measured` ZIP to be in this classification.

## 6. Correction to an earlier figure

QUEUE (Fix 29) recorded "21 obsolete members (19 retired + 84684/84685)" and "685 of the 706 will
never have a ZCTA polygon".
- Measured here: 47 of the 706 are retired in the USPS dataset (19 standard, 20 unique, 8 PO Box),
  plus 2 not in it. The earlier 19 matches the retired standard ZIPs alone.
- **All 706** have no current Census ZCTA. None is pending. ZCTAs are redrawn only with a new
  decennial delineation.
