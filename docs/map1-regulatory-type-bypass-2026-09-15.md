# Map 1 — the Regulatory switch was a Type BYPASS, and the audit of the 2026-09-07 decoupling

**Date:** 2026-09-15 · **Reported:** twice, from live ZIP pages, by the founder
**Scope:** `HS.categoryVisible` in `lib/map.js`. No engine change, no SQL, no schema change.

---

## 1. What was reported

> *"why do the data center projects disappear when i turn off the overlay of regulatory?"*
> — `community.html?zip=78617` (Del Valle TX), PROJECT TYPE = **Data center** only.

Then, on a second ZIP:

> *"this map has errors as well"*
> — `community.html?zip=75009` (Celina TX), same filter state.

In both, the map drew pins with the Regulatory chip on and emptied when it went off.

---

## 2. The finding, stated plainly

**Neither ZIP contains a single data-center record.** The pins were EPA regulatory
records, admitted by their `facility` membership while their OWN Type chip was off, and
drawn with the Type silhouette the resident had just unchecked.

| ZIP | records | data centres | what drew under "Data center" |
|---|---|---:|---|
| 78617 Del Valle | 512 development + 30 facility | **0** | 26 Industrial triangles + 4 infrastructure diamonds |
| 75009 Celina | 24 development + 27 facility | **0** | 26 Industrial triangles + 1 (COSTCO, `logistics` → Industrial) |

75009's list is the clearest statement of the problem. A resident asking for data centres
was shown `CONCRETE BATCH PLANT CELINA`, `CELINA HOT MIX PLANT`, `AUSTIN ASPHALT COLLIN
COUNTY PLANT`, `NORTH DALLAS CEMENT TERMINAL – MARTIN MARIETTA`, `CHEMTRADE SULFATE
CHEMICALS CELINA` and `COSTCO WAREHOUSE - CELINA`.

**Positive control for the zero:** the same text probe (`data cent|hyperscal|server
farm|colocat` over `name`/`type`/`type_raw`) returned 0 of 51 rows on 75009 while the same
pass classified all 51 into six other categories. The zero is real, not an empty query.

---

## 3. Root cause

`HS.categoryVisible` was a flat any-of over the membership set:

```js
const cats = markerCategories(item);
for (let i = 0; i < cats.length; i++) if (categoryFilters[cats[i]]) return true;
return false;
```

An overlay-on-Type EPA record carries `categories: ['industrial', 'facility']`. With
Industrial **off** and Regulatory **on**, the second membership admitted it. So `facility`
was not an overlay at all — it was an **existence grant that outranked the Type
dimension**. The Type row said one thing and the map said another, which is why the
regulatory switch read as the control that hides data centres.

The 2026-09-07 ruling removed `facility` from the Type ROW (#1093) and fixed #1121's
disappearing pin by giving overlay records `[typeKey, 'facility']`. That closed the
false-negative and opened this false-positive. **Membership was right; which dimension
ADMITS the record was not.**

---

## 4. The fix

Three cases, replacing the flat loop. Membership is unchanged — still
`[typeKey, 'facility']`, still one record, one marker.

1. **A record with a classifiable Type is governed by its TYPE chip.** Regulatory then
   controls only its annotation (`HS.visibleSignal` draws or drops the purple R), so
   *"Regulatory OFF drops the R and leaves the Type pin"* holds exactly as ruled.
2. **A record with NO classifiable type** (`['facility']` alone — the standalone purple
   square) has no Type chip that could govern it, so regulatory is its only governor, in
   every filter state. Without this limb the default all-types-on view would hide every
   unmapped EPA record — #1121 reached from a third direction.
3. **When NO Type at all is selected, regulatory admits typed EPA records too.** This is
   the founder's acceptance scenario — *"turn OFF every Map 1 type except EPA"* — and it
   is deliberately not extended to the partial case, where the resident has an explicit
   Type selection on screen that case 3 would contradict.

---

## 5. Measured on the shipped page, before and after

Driven in Chromium against `homesignalmap.html` with the real production
`development_reports` row and the real `app_zip_projects_markers(zip,'development',true)`
payload (`boundary_complete`; 78617 → 494 projects / 522 markers, 75009 → 470 / 629).

### 78617 Del Valle

| Type chips | Regulatory | before | after |
|---|---|---:|---:|
| all 7 ON | ON | 544 pins, 30 R | **544 pins, 30 R** |
| all 7 ON | OFF | 544 pins, 0 R | **544 pins, 0 R** |
| Industrial only | ON | 54 | **50** |
| Industrial only | OFF | 50 | **50** |
| Data center only | ON | **30** | **0** |
| Data center only | OFF | 0 | **0** |
| none | ON | 30 | **30** |

### 75009 Celina

| Type chips | Regulatory | before | after |
|---|---|---:|---:|
| all 7 ON | ON | 228 pins, 27 R | **228 pins, 27 R** |
| all 7 ON | OFF | 228 pins, 0 R | **228 pins, 0 R** |
| Data center only | ON | **27** | **0** |
| Industrial only | OFF | 28 | **28** |

**The default view loses nothing**, Regulatory OFF over it still removes nothing, and the
only rows that change are the ones where a Type the resident switched off was being
overruled.

---

## 6. The assertions the ruling moves — two, both in `map1-dual-identity.browser.test.mjs`

| § | was | now | why |
|---|---|---|---|
| 5d | 2 R badges | **1** | Data center only + Reg ON: the DUAL record keeps its R; the industrial EPA record is governed by the Industrial chip, which is off |
| 6a | 3 markers | **2** | same filter state; the claim under test (one record → one marker) is unchanged |

**§4 — the founder's acceptance test — is untouched and still passes**: all types OFF +
Regulatory ON still shows both EPA records, still exactly once, still with the octagon and
the R.

---

## 7. The pin, proven load-bearing

`test/map1-regulatory-not-a-type-bypass.test.mjs` — 22 checks over verbatim production
records from both ZIPs, asserting all twelve (typed / untyped) × (Type on / off / none) ×
(reg on / off) combinations, including states no chip layout can currently reach.

| mutation | result |
|---|---|
| revert to the flat any-of | **4 fail**, exit 1 — reproduces both live reports |
| drop case 2 (untyped limb) | **3 fail** — the default view loses the purple square |
| drop case 3 (no-Type-selected limb) | **1 fail** — the founder's acceptance scenario breaks |

§0 first asserts the fixtures classify the way the test assumes (a test that agrees only
with itself proves nothing), and §6 asserts the old behaviour is refused *by name*, so a
future "simplification" back to one loop fails with the reason rather than a bare count.

---

## 8. What the audit ALSO found, and deliberately did not change

**Regulatory is still a STATUS bucket in the data model.** The 2026-09-07 ruling says
regulatory must not appear under Project Type **or Status**. It left Type; it never left
Status:

- `STATUS_FILTER_KEYS = ['proposed','approved','operating','unknown','facility']`
- `resolveMarker` stamps `statusKey:'facility'`, `statusLabel:'Regulated facility'` and
  `filterKey:'facility'` on every facility branch — while the SAME object says
  `lifecycle:'operating'`. Two contradictory status answers per record.
- Already frozen into the baseline: **29 of 66** records in
  `test/fixtures/delvalle-golden/expected.json` read `popup_lifecycle: "Regulated
  facility"` beside `lifecycle_label: "Operating / built"`.

**It has zero resident-visible effect today** — no production surface reads `statusLabel`
or `HS.statusVisible`; only `scripts/gate2/*` and the golden script do, and the page's own
status dimension reads `mk.lifecycle` through `bucketOf`. Verified by measurement:
unchecking "Operating now" removes all 30 EPA pins on 78617, so the Status dimension
already governs them correctly.

It is therefore **latent, not the reported defect**, and it is left alone here: fixing it
regenerates the committed Del Valle golden baseline and touches the status API, which does
not belong in the same change as a resident-visible filter correction. **Next unit.**

---

## 9. Two instrument failures worth keeping

Both cost a wrong conclusion before being caught, and both are the same shape — a stub
that made the product look broken.

1. **A wrong RPC stub reported all 512 development records missing from 78617.** The
   harness returned `status:'not_measured'`; the page correctly drops the report's own
   point-scope development in ZIP mode (`zipAuthMergeSites`), so the map showed only the 30
   EPA facilities. The real call passes `p_authoritative: true` and returns
   `boundary_complete`. **`app_zip_projects_markers` defaults `p_authoritative` to FALSE**,
   so calling it in SQL without that argument returns a `legacy` payload the client treats
   as `unavailable` — a plausible, wrong answer.
2. **The same stub, copied forward, reported the same thing on 75009.** Caught by the
   control: 78617 rendered 544 with the corrected payload while 75009 still rendered 27.

**629 markers rendering as 201 on 75009 is NOT a defect** — it is 425 Residential records
removed by the founder's own qualification gate (`HS.residentialQualifySites`, §7.1).
Measured in both directions: 78617 removes 0, 75009 removes 425, all `use_type:
Residential`. Celina is a subdivision boom; the gate is doing its job.

---

## 10. Reproduce

```
node test/map1-regulatory-not-a-type-bypass.test.mjs     # the unit pin, offline
node test/map1-dual-identity.browser.test.mjs            # the founder's acceptance matrix
node test/map1-regulatory-toggle.browser.test.mjs        # the R-badge contract
node test/map1-type-filter-chips.browser.test.mjs        # the Type row
```

The sandbox cannot reach `homesignal.net` or jsDelivr (egress 403), so every browser
number above is from the repo's own harness against the shipped page with Leaflet served
locally — **not from production**. Confirm on the real site: open `?zip=78617`, check
Data center alone, and the map should now be honestly empty.
