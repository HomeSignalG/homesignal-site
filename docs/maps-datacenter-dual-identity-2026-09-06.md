# Data center + EPA regulated facility — dual identity on Map 1 (2026-09-06)

A site can be a **data centre** and separately carry an **EPA-FRS regulatory record**.
Those are two different facts, and until this change Map 1 could only hold one of them:
the facility flag short-circuited classification, so 741 rows that the EPA's own record
names as data centres rendered as anonymous purple "Regulated facility" squares with no
trace of what they actually are.

**The founder-set contract implemented here:** what the thing **IS** owns the primary
symbol; what it **CARRIES** rides beneath as a subordinate signal. One record, one
marker, two truthful attributes, two filter memberships.

---

## 1. What a resident saw before

For every one of the 741 rows — `CORESITE - VA1 DATA CENTER`,
`CYRUSONE NORTHERN VIRGINIA DATA CENTER - MARIES ROAD`,
`ALIGNED ENERGY DATA CENTERS (ASHBURN), LLC`,
`NTT GLOBAL DATA CENTERS AMERICAS, INC.- VA1`:

| surface | before |
|---|---|
| marker | purple **square**, identical to a plating works or a landfill |
| legend row | *Regulated facility* |
| popup subheader | `Facility · operating now` — the word "data center" appears nowhere |
| filter membership | `facility` only |
| type filter | **did not exist** — the shape legend was a static caption |

A resident on a Northern Virginia ZIP page could see eight purple squares and have no
way to learn that six of them are data centres. The Data center octagon shipped in
#1046 drew for *projects* only, so the two halves of the same subject were rendered in
two vocabularies.

---

## 2. Population measured (production, 2026-09-06)

Denominator control: **215,305 facility rows / 114,039 distinct FRS records** in
`app_projects`.

| category | definition | rows | records | ZIPs |
|---|---|---:|---:|---:|
| **A** | the FRS record's **own stamped class** is `datacenter` | **741** | **342** | **512** |
| **B** | high-confidence project↔FRS same-site join | **0 — not attempted, and not needed** | | |
| **C** | campus/building grain ambiguous | **1** | 1 | 1 |
| **D** | insufficient identity evidence — untouched | **214,563** | 113,696 | — |

Every count paired with its control:

- **0 of the 741** lack data-centre wording in their own facility name — so the class
  field and the name agree on all of them, and Category A is not resting on a mapping
  step that could have invented the class. The probe's control is non-zero: **1** facility
  row states a data centre in its name while carrying a different class, which is
  Category C below.
- **0 of the 741** come from anywhere but `epa_frs:` — this is EPA's own record, not a
  project record wearing a facility flag.
- **0 duplicate rows** for the same `(zip, source_key)`: a record already appeared exactly
  once per ZIP page, and still does.

### Category C is one record, and it is deliberately NOT promoted

`epa_frs:110038203734` — **`CYRUS ONE DATA HALL 1 POWER POD 1`**, stamped `energy`,
ZIP 75067. Its name mentions the data hall it powers. Its two siblings on the same
campus, `CYRUSONE POWER POD 5` and `CYRUSONE POWER POD 7`, are the same kind of facility
and mention nothing.

Reading the free-text name would call **one of three identical power pods** a data centre
purely because of what its label happens to mention. So on the facility path the
evidence is the **stamped class field only** (`statedDataCenter(item, /* classOnly */ true)`).
All three stay Regulated facilities, which is both consistent and correct.

This is the same discipline as #1046's incidental-reference guard, applied one layer up:
a power pod at a data centre is not a data centre.

---

## 3. Internal architecture — three concepts, deliberately not conflated

`HS.resolveMarker` now returns:

| field | meaning | dual record |
|---|---|---|
| `categoryKey` | **ENTITY IDENTITY** — one value, drives the primary symbol | `'datacenter'` |
| `signal` | **SIGNAL / ATTRIBUTE** — the subordinate symbol to draw | `{shape:'square', color:'#6f42c1'}` |
| `categories` | **FILTER MEMBERSHIP** — the set that can qualify it for display | `['datacenter','facility']` |

`filterKey`, `isFacility`, `lifecycle` and every existing field are unchanged, so nothing
that reads the marker today has to know this exists. An ordinary record carries
`categories: [categoryKey]`, `signal: null` — one membership, no signal.

**No schema change. No database write. No new table, column, or entity-resolution join.**
The dual identity is derived at render time from the record the engine already caches.

`HS.categoryVisible(item)` is an **any-of** test over `categories`. That is what makes
"appears under either filter, exactly once" structural rather than a convention: there is
one marker object, and the filter answers a yes/no question about it.

---

## 4. The marker

```
        ⬢     ← Data center octagon, lifecycle colour, ON the icon anchor
        ▪     ← EPA square, 55% size, thinner stroke, purple
```

`HS.markerSVG(shape, color, label, size, signal)` takes an optional fifth argument. The
primary symbol stays centred on `(c, c)` — the anchor point — and the badge overflows
downward (the SVG is already `overflow:visible`). **The icon box and anchor are byte-identical
to every other pin**, which is why no coordinate, offset or second marker was needed to
show both facts. Asserted directly: test 18b compares the `viewBox` of a composed marker
against a plain one.

The primary symbol takes the **lifecycle colour**, not the facility purple. Purple is what
the *secondary* symbol says; letting it own the whole pin would make the record read as
"Regulated facility" at exactly the moment the contract says its primary identity is Data
center.

---

## 5. The filter dimension this required

Map 1 had **one** filter dimension — the lifecycle chips (Operating / Approved / Proposed /
Unknown). The "Type — pin shape" legend was a static caption, so *"turn off every Map 1 type
except EPA"* was not a thing a resident could do.

The shape rows are now toggles, using the same pattern as the lifecycle chips they sit under
(`role=button`, `aria-pressed`, keyboard-operable, `sessionStorage`-persisted). A marker must
clear **both** dimensions, via one shared predicate `siteVisible()` used by all three views —
2D, 3D aerial and 3D satellite — so a record can never be filtered in on one surface and out
on another.

---

## 6. Filter matrix — tested in a real browser, by clicking the legend

`test/map1-dual-identity.browser.test.mjs`, 20 assertions, **FAILS: 0**. Fixtures are
verbatim production `development_reports` sites from ZIP 20171.

| Data center | EPA | result | proof |
|---|---|---|---|
| ON | OFF | visible, Data center octagon, **EPA square still attached** | 5a/5b |
| OFF | ON | visible, **still the Data center octagon** | 4a/4b |
| ON | ON | visible **once** | 6a |
| OFF | OFF | not visible | 6b |

**The founder's acceptance test (4b)** — every type off except EPA — passes: the record
remains visible, keeps its Data center primary symbol, keeps its EPA square, appears once.

The EPA secondary symbol persists under Data-Center-only filtering (5b). EPA status is an
attribute of the entity, not a decoration owned by a filter checkbox.

---

## 7. Counts

Map 1 exposes a **facilities** count and a **development** count, both from the engine, plus
lifecycle rails. It has **no per-category counters** today, so there was no per-category count
to correct. What is asserted instead:

- **category-specific counting**, if it is ever added, may legitimately count the dual record
  under *both* Data center and Regulated facility (test 12);
- the **unique-results count must not**: three records with four memberships filter to **3**,
  never 4 (test 13);
- the page publishes `__HS_VERIFY.dualIdentityMarkers`, and it reads **1** for one dual record
  under EPA-only filtering — the live proof that dual membership did not create a second
  marker object (browser test 7a).

---

## 8. What deliberately did NOT change

- **214,563 facility rows / 113,696 records** — every regulated facility that is not a data
  centre keeps its purple square, its `Regulated facility` legend row, its `facility` filter
  membership and its `Facility · operating now` popup. Asserted on a real production record
  (`ANDURIL INDUSTRIES, INC`) in both suites.
- **Every other category** — industrial, residential, commercial, civic, other,
  infrastructure — carries `signals: []` and `signal: null`. This unit is data centres only;
  the mechanism is generic but nothing else uses it.
- **Geography.** No coordinate, ZIP assignment, ZCTA membership, parcel relationship, radius
  or footprint was read, written or derived. The resolver returns no geography at all
  (test 18), and the composed marker keeps the same anchor (test 18b).
- **Entity grain.** No campus was collapsed and none was multiplied. No project↔facility join
  was performed. Operator brand (16), similar name (15), and identical coordinates (17) are
  each proven insufficient on their own.

---

## 9. Verification

| suite | result |
|---|---|
| `test/marker-dual-identity.test.mjs` (new) | **36 checks, 0 failed** |
| `test/map1-dual-identity.browser.test.mjs` (new) | **20 checks, 0 failed** |
| `test/marker-datacenter-type.test.mjs` | 87 checks, 0 failed |
| full offline suite | **147 files, 0 failed** |

Both new suites are **mutation-proved load-bearing**: removing the category test from
`applyFilter` reddens 6 browser assertions; disabling the dual-identity branch reddens 8
browser assertions and 12 unit assertions.

`test/user-journey.browser.test.mjs` reports 5 failures in this sandbox — **and reports the
identical 5 on unmodified `origin/main` (4a80502)**, so they are pre-existing and
environment-caused (no egress), not caused by this change. The control was run before the
number was quoted.

---

## 10. Known limitations of this implementation

1. **Category A only.** A data centre with an EPA record whose *stamped class* is something
   else (the Category C power pod) is not promoted. That is a deliberate precision choice,
   not an oversight.
2. **No project↔facility relationship is asserted anywhere.** A resident looking at a
   campus with both a permit record and an FRS record still sees two records, because
   HomeSignal has no evidence they are one entity. Phase 8 forbids inventing one.
3. **The type filter is per-session** (`sessionStorage`), like the lifecycle chips. It does
   not survive a new tab.
4. **The 3D aerial view** draws simplified blocks and shows no shapes, so the EPA signal is
   visible in 2D and satellite only — the legend note already says so for type shapes.
5. **`counts.facilities`** still counts the dual record as a facility, which is correct
   (it is one) but means the facilities counter and the Data center type filter describe
   overlapping sets. No counter claims they are disjoint.
