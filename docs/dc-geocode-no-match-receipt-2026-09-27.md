# Step 8 (C4): why 314 data-centre addresses do not geocode — receipt, 2026-09-27

**Verdict: no safe shared-policy change exists.** Cleaning up the address line recovers nothing. The
failures are a DATA gap in the ladder, not a formatting defect in our addresses. The 314 stay
`UNCHECKED` with the reason *"the shared geocoder has no match for this street."*

## What the ladder is today (production, read-only)

- Rung 1, `national_address_points` (OpenAddresses), holds **8,545 rows**. All of them are Texas
  (Travis 6,869 · Bastrop 1,554 · CAPCOG 122). It matched **0** data-centre queries: at the current
  ladder version all **1,022** matches came from `census_onelineaddress`.
- So the ladder is Census range interpolation (TIGER/Line street ranges) for every data-centre address.

## The probe

`dc-geocode-variant-probe.yml`, run `36282817101`. It calls the ladder's own `censusRung` and writes
nothing.

- **Inputs:** 314 failed queries, plus 150 controls that already match (deterministic md5 sample).
- **Baseline, unchanged:** **0 / 314** failed queries match now, so Census's data has not moved and a
  re-queue alone recovers nothing. **150 / 150** controls still match, so the instrument works.
  **0** transport errors.

| rewrite | failed changed | recovered | controls changed | same (≤25 m) | moved | lost |
|---|---:|---:|---:|---:|---:|---:|
| strip `, USA` | 2 | 0 | 1 | 1 | 0 | 0 |
| strip trailing county | 1 | 0 | 0 | 0 | 0 | 0 |
| abbreviate state | 3 | 0 | 1 | 1 | 0 | 0 |
| drop suite/unit | 31 | 0 | 6 | 6 | 0 | 0 |
| all four cleanups | 37 | 0 | 8 | 8 | 0 | 0 |
| **drop ZIP** | 228 | **9** | 124 | 123 | 0 | **1** |

- **The formatting cleanups recover 0.** They are not worth a policy change.
- **Dropping the ZIP recovers 9 of 228 (4%), and it is not safe as a rewrite.** It loses a control
  that already matches (`3043 Black Horse Pike, Monroe Township, NJ 08094`).
  - It could only ever be a second attempt made when the full line fails.
  - Even then it would be a change to the ONE ladder, which the resident address report also uses, and
    it accepts a match the publisher's own ZIP did not support.
  - It is recorded here and **not built**: 9 addresses do not justify a cross-product ladder change.
- **305 of 314 are unrecoverable by any rewrite.** They are well-formed addresses on streets Census's
  street ranges do not carry, dominated by data-centre parks:
  - Ashburn / Sterling, VA: Gigabit, Round Table, Interconnection, Vantage Data, Pathfinder, Optics Plaza
  - Hillsboro, OR: Starr Boulevard, Huffman Street
  - Sandston, VA: Portugee Road, Technology Boulevard
  - Leesburg, VA: Thunderball Drive
  - Boardman and Umatilla, OR

## What would actually fix it (a separate decision, not taken here)

The ladder needs a rung with those streets. `national_address_points` is the designed slot for one, and
today it holds three Texas files. Loading OpenAddresses (or another zero-fee address-point set) for the
data-centre states is the fix. That is a data-load decision, not a policy edit, and it is left to the
founder.
