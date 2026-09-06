# Data center significance — what KIND of activity, not just what it relates to (2026-09-06)

`Data center` was the whole answer for a **285,282 SF ground-up data hall** and for a
**sign permit**. Both classifications are correct. Neither tells a resident whether
something is being built next door.

This unit adds a **second dimension** — significance — using only evidence HomeSignal
already holds, and says *"not stated"* wherever that evidence is absent.

---

## 1. The problem, in production text

All three of these rendered identically: a Data center octagon and a lifecycle stage.

| record (verbatim) | permit class | what the page said |
|---|---|---|
| `Commercial/Industrial Projects New ground up 285,282 SF unlimited area data hall building…` | `Commercial/Industrial Projects` | *Approved / permitted* |
| `QTS DATA CENTER` | `SIGN  PERMIT` | *Proposed / hearing* |
| `Data Center 123  GREAT OAKS BL  , SAN JOSE CA 95119` | `Data Center` | *Recorded / operating* |

A homeowner could not tell the ground-up building from the sign.

---

## 2. What evidence actually exists — the field inventory that decided the design

Measured across the whole shipped corpus (**107 distinct records / 479 rows**):

| field | populated |
|---|---:|
| `size` | **0 / 479** |
| `investment` | **0 / 479** |
| `jobs` | **0 / 479** |
| `scope_text` | **0 / 479** |
| `developer` | **0 / 479** |
| `stage` | 479 / 479 |
| `status` | 479 / 479 |
| `type_raw` (the issuing authority's own permit class) | 383 / 479 |
| explicit square footage inside the record's own name | **6 / 479** (4 records) |
| megawatts inside the name | 1 record |

**There is no structured scale anywhere in this corpus.** So significance is derived from
exactly two things, both authoritative:

1. **The jurisdiction's own permit class** — `SIGN  PERMIT`,
   `FP STATIONARY LEAD-ACID BATTERY SYSTEM`, `NEW CONSTRUCTION`. The issuing authority
   assigned it; we are reading it, not inferring it.
2. **The record's own description text.**

Nothing else. No acreage, MW, cost, phase or building count is invented, and **absence of
square footage is never read as "small"**.

---

## 3. The taxonomy — two established states and an explicit unknown

| label | evidence contract |
|---|---|
| **Major development** | the source states construction of a data-centre building: a new-construction/shell permit class, or wording such as "new ground up", "construct data center", "to construct … data center" |
| **Ancillary work** | the source's own permit class is an ancillary class (sign, fire alarm, fire pump, stationary battery system, vehicle access gates, fire-prevention service request), or the record names an ancillary act (roof replacement, cooling-tower replacement) |
| **Significance not stated** | data-centre identity is known and the evidence supports nothing stronger |

### ⛔ EXPANSION was measured and REJECTED

It was the obvious third category and the evidence does not carry it. The candidates:

- `DATA CENTER CRAC ADDITION` — a cooling unit, not a building expansion
- `BOSTON- DATA CENTER & HVAC EXPANSION & UPGRADES AT HQ BOSTON` — HVAC, 65 rows
- `Building American Tower Modular Data Center Phase 2 - Addition to Unmanned Modular…` — genuine
- `ADD PEMB & Foundation additions and Data Hall structures only…` — genuine
- `Sandy Farm Data Center - Phase 2` — a preliminary plan

**2 of 5 genuine.** A rule keyed on "addition"/"expansion" would tell residents a cooling
unit is a data-centre expansion. Rejected; those records read *Significance not stated*.

### 🔑 THE VETO — the source's own class outranks its free text

`ADDITIONS/ALTERATIONS/REPAIRS Construct data center and pump house renovations…` reads as
new construction in its description, and the jurisdiction filed it as an alteration.
**2 production records turn on exactly this conflict** and both are correctly *not* major.
The veto is proven load-bearing: strip the class and the identical text does read as major.

---

## 4. Adjudication — every record the rules touch

**MAJOR — 5 records / 9 rows, all PROVEN CORRECT**

- `Commercial/Industrial Projects New ground up 285,282 SF unlimited area data hall building…`
- `Commercial/Industrial Projects Shell data hall building 1, construction type II-B, two story 243,332 SF total building.`
- `NEW CONSTRUCTION Construct Data Center (IB158 #1) per plans reviewed for code compliance.`
- `Building Commercial - New To construct a single-story 103,877 SF structure to accommodate a Data Center`
- `PHOENIX NAP II DATA CENTER - SHELL` (class `SHELL - STRUC/ELEC/PLMB/MECH`)

**ANCILLARY — 15 records / 46 rows, all PROVEN CORRECT.** 13 from the permit class
(`SIGN  PERMIT` ×2, `FP FIRE ALARM MODIFICATION` ×4, `FP FIRE ALARM INSTALLATION`,
`FP FIRE PUMP INSTALLATION`, `FP VEHICLE ACCESS CONTROL DEVICE GATES`,
`FP STATIONARY LEAD-ACID BATTERY SYSTEM` ×3, `FIRE PREVENTION SERVICE REQUEST`) and 2 from
the record's own words (`Replacement of Data Center cooling tower`,
`Training and Data Center Roof Replacements`).

**0 false positives in either bucket. 0 records carry both verdicts.**

---

## 5. The adversarial attack — what must NOT carry a verdict

Every one of these is a real production record and every one stays *not stated*:

| record | why it is not enough |
|---|---|
| `ACC Project: Building a Data Center - Phase 1` | "Building" is a verb here |
| `Building American Tower Modular Data Center Phase 2` | `Building` as a permit class is not new construction |
| `AT&T - OAKTON DATA CENTER GENERATOR POWER (PR)` | a generator is not automatically minor |
| `BOSTON- DATA CENTER & HVAC EXPANSION & UPGRADES` | HVAC expansion is not a data-centre expansion |
| `DATA CENTER CRAC ADDITION` | an equipment addition is not a building expansion |
| `PHOENIX NAP II DATA CENTER - G&D` (grading) | site work: neither proven major nor ancillary |
| `Master Use Permit … to allow a 9-story … (Data Center) building` | permission, not construction |
| `CLT 15 12MW Data Center` | a capacity figure is not proof of construction activity |
| `AMAZON DATA HALL PH02- ACCESS CONTROL` | `data hall` proves IDENTITY, never scale |
| `600 River Road - Data Center` | a county proposal stating no activity |

---

## 6. Before → after

| | records | rows |
|---|---:|---:|
| **BEFORE** — carrying any significance distinction | **0** | **0** |
| AFTER — Major development | 5 | 9 |
| AFTER — Ancillary work | 15 | 46 |
| AFTER — Significance not stated | **87** | **424** |
| total (control) | **107** | **479** |

**81% of records remain unknown, and that is the correct outcome.** The alternative was a
confident label on evidence that does not exist.

---

## 7. What a resident sees

| | before | after |
|---|---|---|
| Mesa 285,282 SF data hall | `Approved / permitted` | **`Major development · Approved / permitted`** |
| QTS sign permit | `Proposed / hearing` | **`Ancillary work · Proposed / hearing`** |
| San Jose trade permit | `Recorded / operating` | **`Significance not stated · Recorded / operating`** |

The type, the octagon, the colour, the filters and the counts are unchanged. Significance
is added to the popup line; it never replaces the lifecycle stage.

---

## 8. The ZIP-mode carry — measured, not assumed

ZIP mode rebuilds development records through `zipAuthSiteFromMarker`, which does not map
`type_raw`. Measured impact if the permit class were not carried:

- **MAJOR loses nothing** — all 5 records' evidence also appears in their name (several
  connectors prepend the permit class into the description).
- **ANCILLARY loses 12 of 15 records / 41 of 46 rows** — those are provable only from the class.

So the class is carried, under the deliberately separate name **`permit_class`**. It is
*not* called `type_raw`, because that name is read by the frozen data-centre classifier and
by Rule 5 residential qualification, and neither may widen: mapping it under its own name
would turn 2 more production records into data centres on Map 1. Asserted both ways —
significance works on the ZIP path, and `Hewlett Packard- Site 2 EcoPOD` /
`Norwood Park, Replat…` (whose only data-centre evidence is `type_raw`) still do **not**
become data centres.

**It fails safe:** if a future RPC projection drops the column, `permit_class` is `null`,
the verdict is *lost* — never wrong.

---

## 9. Frozen, and proven frozen

- **The data-centre classifier** — unchanged; 107 records / 479 rows before and after.
- **Dual identity** — an EPA data centre keeps its octagon, its subordinate purple EPA
  square, both filter memberships and its popup. Its significance is pinned to *unknown*
  with `significanceApplies:false`: **an operating facility is not a development record and
  can never be major or ancillary.**
- **Every other type** — industrial, residential, commercial, civic, other, and ordinary
  regulated facilities carry `significance: null` even when their permit class matches a
  significance vocabulary. Asserted for all five.
- **Geography** — nothing read, written or derived. No coordinate, ZIP, radius or footprint.
- **Markers/filters/counts** — three records still make three markers.

---

## 10. Verification

| suite | result |
|---|---|
| `test/marker-datacenter-significance.test.mjs` (new) | **52 checks, 0 failed** |
| `test/map1-datacenter-significance.browser.test.mjs` (new) | **12 checks, 0 failed** |
| `test/marker-dual-identity.test.mjs` | 36, 0 failed |
| `test/map1-dual-identity.browser.test.mjs` | 20, 0 failed |
| `test/marker-datacenter-type.test.mjs` | 87, 0 failed |
| `test/user-journey.browser.test.mjs` | **0 failed** |
| full offline suite | **148 files, 0 failed** |

Mutation-proved load-bearing: removing the permit-class veto reddens 1; never computing
significance reddens 30; dropping the page's significance line reddens 4 browser
assertions **including the acceptance test** — which was rewritten after the first mutation
showed it could pass on the lifecycle words alone.

⚠️ **A measurement note worth keeping.** The corpus-wide SQL mirror of these rules first
reported **3** major records and **0** vetoed. Postgres regular expressions have **no `\b`
word boundary** — it is `\y`. The rules were silently under-matching in the *instrument*,
not in the shipped JavaScript. With `\y` the same query reports 5 and 2.

---

## 11. Known limitations

1. **81% of records are *not stated*.** The evidence for more does not exist in this corpus.
2. **Expansion is not offered** — measured at 2 of 5 candidates genuine; see §3.
3. **`name` is truncated at ~120 characters** by the connectors, so a square-footage figure
   or an activity verb beyond that point is invisible to both the rule and the resident.
4. **Square footage is not rendered as its own field.** It survives inside the record's own
   displayed description where the source states it (6 rows); extracting it into a separate
   line would duplicate text already on screen and would imply a structured field that does
   not exist.
5. **Ancillary detection depends on the permit class**, which 96 of 479 rows lack entirely.
6. Significance is **per record, not per project**: a campus with several permits shows
   several records, each judged on its own evidence. No entity resolution is performed.
