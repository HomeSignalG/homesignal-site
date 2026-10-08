# Step 11 (C5): every Map 1 data-centre marker, one address-check state and one reason — receipt, 2026-09-27

**What ships:** `docs/dc-map1-address-check.sql` defines the view `public.dc_map1_address_check`. It has one row per
marker on every canonical ZIP page, in exactly the set `map1_dc_zip_members` draws.

Each row has:
- exactly one `check_state`: `CHECKED` · `CHECKABLE_NO_CLEAN_MATCH` · `NOT_CHECKABLE` · `PENDING`;
- one `reason_code`;
- the shared rule's own reason text.

**It labels; it decides nothing.** Every value is read from a shared decision already in production:
- the Map 1 reader (what is drawn and which layer it is on);
- `dc_entity_geography` (placement rule and `CORROBORATED_BY_DERIVED_ADDRESS`);
- `dc_observation_derived_point` (input policy + verdict, canonical layer);
- `dc_osm_address_check` (the same policy + verdict + conflict rule, OpenStreetMap layer).

It has no source names, no distance math and no geocode reads. `test/dc-map1-address-check-structure.test.mjs`
pins all of that (14 checks). Three pins were mutation-checked (a distance call, a dropped revoke, a geocode-table
read), and all three mutations were caught.

## Production reading (read-only; the view body run live, 2026-09-27 18:23 UTC)

| layer | CHECKED | CHECKABLE_NO_CLEAN_MATCH | NOT_CHECKABLE | PENDING | markers |
|---|---:|---:|---:|---:|---:|
| canonical | 493 | 102 | 377 | 0 | 972 |
| openstreetmap | 303 | 127 | 415 | 0 | 845 |
| **total** | **796** | **229** | **792** | **0** | **1,817** |

- **Control:** 1,817 rows = the 1,817 Map 1 markers measured after C7 (972 canonical + 845 OSM). Every row has a
  state, a reason code and non-empty reason text.
- **Coverage** = CHECKED / (CHECKED + CHECKABLE_NO_CLEAN_MATCH + PENDING) = 796 / 1,025 = **77.7%**.
- **The reasons:**
  - canonical CHECKED: 492 corroborated by their own address, 1 placed at it;
  - canonical no clean match: 93 no match, 5 ambiguous, 4 diverges (C7's direction and house-number rule);
  - canonical not checkable: 349 blank, 25 no house number, 3 house-number range;
  - OSM no clean match: 127 no match;
  - OSM not checkable: 386 blank, 28 no locality, 1 no house number.
- **The 792 NOT_CHECKABLE markers are the publishers' own gaps**: no address, or an address without a house
  number or locality. No geocoder or rule change can check them. They are recorded, not hidden.

## Proof

`test/dc_map1_address_check_pg/run.sh` builds a stand-in from the DDL of record and the OSM suite's fixture, then
runs both resolvers. It proves:
- one row per marker;
- every row has a state and a reason;
- only the four states occur.

Each fixture record lands in the state the shared decisions give it:
- Corrob / Shared OSM and Shared Atlas → CHECKED;
- Failed → REJECTED_NO_MATCH;
- Blank / Nolocal / Canada / Area → BLANK / NO_LOCALITY / NOT_US / NO_SITE_CLAIM;
- Far OSM, which Map 1 withholds, is absent.

It runs in `zip-membership-suite.yml` on any PR or push that touches the view.

## Applying it

This is an additive, read-only DDL change: one view, with no writes, and service-role only (anon and authenticated
are revoked). It changes no pin, no resolver and no resident-facing surface. Step 12's daily monitor reads it.
