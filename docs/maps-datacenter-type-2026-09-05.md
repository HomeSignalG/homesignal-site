# Data center TYPE on the maps — the legend row that never drew (2026-09-05)

Scope: `lib/map.js` (the canonical marker resolver) + `test/marker-datacenter-type.test.mjs`.
No schema change, no connector change, no registry change, no migration.

---

## 1. The finding

`CATEGORY_REGISTRY.datacenter` has existed since the maps-backbone repair: label
**"Data center"**, symbol **octagon**, `legend: true`, and it is one of the six members of
the closed `use_type` vocabulary every connector is written against. Measured on production
`app_projects` (**control: 3,216,489 rows total**), **1,190 records state a data centre in
their own words** — in `type`, `type_raw`, or `name` — and only **153** of them resolved to
that category. The other **1,037** drew a different marker, for two unrelated reasons.

| what the record is | rows | ZIPs | marker BEFORE |
|---|---:|---:|---|
| `record_kind='facility'`, `type='datacenter'` (EPA FRS) | **738** | 509 | purple **square**, "Regulated facility" |
| `type='Development'` / `'unclassified'`, name says data centre | **153** | 95 | **octagon** — correct |
| `type='Utility'` | **100** | 37 | diamond, "Roads & infrastructure" |
| `type='Industrial'` | **84** | 24 | triangle, "Industrial" |
| `type='Commercial'` | **61** | 44 | hexagon, "Commercial" |
| generic type, name truncated / stated only in `type_raw` | **39** | 39 | circle, "Other project" |
| `type='Civic/Public'` | **15** | 9 | cross, "Civic & public" |

738 + 153 + 100 + 84 + 61 + 39 + 15 = **1,190**, exact.

Verified against the **shipped** classifier before anything was changed, not inferred from
reading it — `HS.resolveMarker` run over verbatim production rows:

```
type=datacenter  rk=facility | facility        square    PRECEDENCE:facility-flag
type=Industrial  tr=Data Center               | industrial     triangle  TYPE_EXACT:industrial
type=Commercial  "PHOENIX NAP II DATA CENTER" | commercial     hexagon   TYPE_EXACT:commercial
type=Civic/Public "MCDOWELL ROAD DATA CENTER" | civic          cross     TYPE_EXACT:civic/public
type=Utility     "BOSTON- DATA CENTER …"      | infrastructure diamond   TYPE_EXACT:utility
type=Development "DATA CENTER SHELL"          | datacenter     octagon   NAME:datacenter
```

### Why each coarse type is a bucket, not a contradiction

The displaced categories are **all strictly broader** than "data center", and in each case
the coarse value is our own `type_map` output, not the source's judgement:

- **Phoenix** files data-centre fire work under the F-range department code, which the
  registry maps to `Civic/Public` — `IRON MOUNTAIN DATA CENTER - PUMP`,
  `IRON MTN DATA CENTER-GATES`, `LA SALLE 1G SERVERS DATA CENTER T.I F/A`.
- **Memphis** files data-centre fit-out under `COM` → `Commercial`.
- **San Jose** publishes **`type_raw = 'Data Center'` verbatim** and the registry entry
  collapsed it to `Industrial`. The classifier never read `type_raw` at all, so the
  source's own word was discarded and then unavailable.
- **MassDOT** files `BOSTON- DATA CENTER ELECTRIC UPGRADES AT HQ BOSTON` under
  `Vertical Construction (Ch 149)` → `Utility`.

There is no record for which the broader answer is the better one, so the stated class wins.

---

## 2. What changed

`lib/map.js`, three edits:

1. **A `DATACENTER` precedence phase**, second only to the facility flag. It reads the
   record's own class fields — `type`, **`type_raw`**, `use_type`, `layer`, `category` — and
   its `name`/`title`/`label`, against
   `/data\s*cent(?:er|re|e)|hyperscale|server\s*farm/i`. `type_raw` is read **here and
   nowhere else**, so no record outside the data-centre vocabulary is reshaped.
2. **`'datacenter'`, `'data-center'`, `'data centre'` added to `TYPE_EXACT`.** Production
   carries the one-word spelling on all 738 rows and the spaced form on none; the one-word
   spelling had been resolving only by accident, through `LAYER_EXACT` — a table meant for
   the `layer`/`category` fields.
3. **The pre-existing `NAME_RULES` data-centre rule gained the street-name guard.** Without
   it the new phase's guard was undone one phase later; an adversarial test caught this while
   it was being written.

### Two details that are measured, not stylistic

- **`cente` (no trailing `r`) is in the pattern because connectors truncate names.** 37
  production rows end `... EXISTING 2-STORY DATA CENTE`. The old `NAME_RULES` pattern required
  the whole word, so those 37 — the rows with the most descriptive names — drew the honest
  circle. Widening the stem loses nothing: `data\s*cent` and `data\s*cent(er|re|e)` both match
  exactly **1,188** names, residue **0**, and `data central` does not match either.
- **The street-name guard has 0 collisions today and ships anyway.** Control: 1,188 rows match
  the pattern on the name, and `data\s*cent(er|re)\s+(rd|road|dr|drive|…)` matches **0** — so
  the zero is a real absence, not a dead query. `Data Center Drive` is an address the moment
  one source carries it, which is exactly the history of the `\bschool\b` rule's own guard.

---

## 3. Effect

**Project records drawing the Data center octagon: 153 → 452 (+299).**
**ZIP pages showing at least one Data center pin: 95 → 214 (+119).**
Nothing else moves — every record that states no data centre classifies exactly as before.

---

## 4. Deliberately NOT done — the 738 facilities (founder call)

All 738 `type='datacenter'` rows are **EPA-FRS regulated facilities**, and
`resolveMarker` checks the facility flag before any type phase. They keep the purple square,
the "Regulated facility" legend row, and the `facility` filter bucket.

That is the larger population (738 rows / 509 ZIPs vs 299 / 119) and it is left alone on
purpose. `datacenter` is a **project type**; `facility` is a **record kind**. Moving them
would change the facility filter bucket, the `counts.facilities` figure that
`verify-development` asserts against the rendered rail, and a colour the legend explains —
i.e. it is resident-visible and it is a product decision, not a classifier defect.

**The open question, stated once so it is not re-derived:** should a regulated facility that
IS a data centre draw the octagon, keep the square, or carry both (square + a "Data center"
line in the popup)? Logged in `QUEUE.md`; not taken.

---

## 5. Verification

- `test/marker-datacenter-type.test.mjs` — 33 checks, every non-adversarial string verbatim
  from production. Covers the four coarse types, the `type_raw` path, truncation, the label a
  resident reads, the street-name and `data central` negatives, facility precedence, and
  symbol uniqueness. Check 9 proves the rule is **load-bearing** rather than fixture-shaped:
  the same record with the data-centre words removed must fall back to its coarse type.
- Full offline suite green: **143 files, 0 failed**, including
  `maps-delvalle-golden` (235 checks — no golden classification drifted),
  `maps-category-contract` (178), `maps-rule-output-contract`, `marker-name-enrichment`.
  The new file appears in the runner's own log, so its silence is not being read as a pass.

---

# CTO merge gate — independent evidence and the Case B measurement (2026-09-05)

## 6. What this classifier actually asserts — the evidence contract it needs

The prior gate applied a two-source (Compute Atlas + Epoch AI) contract and returned NOT MERGE
READY when Epoch proved unreachable. Re-examined against the assertion the code makes, that
contract was **the wrong instrument for this change**. Six distinct things were being treated
as interchangeable:

| # | Evidence type | Needed to merge THIS change? |
|---|---|---|
| 1 | The HomeSignal source record's own wording states it is a data centre | **YES — this is the whole assertion** |
| 2 | Independent corroboration that the physical site is a data centre | No — audit value, not correctness |
| 3 | Proof the classifier finds data centres with opaque names (completeness) | No — a *coverage* question |
| 4 | EPA-FRS evidence a regulated facility is data-centre associated | No — frozen layer, untouched |
| 5 | Geography sufficient to locate a record | Unchanged — no geography touched |
| 6 | Geography sufficient to assert an exact footprint | Not asserted, not touched |

**The classifier makes claim 1 and only claim 1.** It reads `type`, `type_raw`, `use_type`,
`layer`, `category` and `name` — all HomeSignal's own record — and fires only on a literal
data-centre string. It cannot fire on an operator, a place, a coordinate, or an external
dataset. Verified structurally over all 96 records below: **0 classified without a literal
data-centre string in their own source data.**

So Atlas and Epoch are a **completeness/audit mechanism (claim 3), not a correctness gate for
claim 1**. Requiring a second external dataset to approve a record that *says* "Data Center"
in the county's own filing inverts the source-of-truth order this repo runs on. Epoch is
therefore **not a merge blocker for this change**; it remains the right instrument for the
coverage question, which is logged as unmeasured.

## 7. Epoch access — one attempt, all official surfaces, BLOCKED

| Surface | Result |
|---|---|
| `epoch.ai/data/ai-data-centers` | `000` — gateway 403 CONNECT |
| `epoch.ai/api/data/data-centers` | `000` — gateway 403 CONNECT |
| `huggingface.co/api/datasets?author=EpochAI` | `000` — gateway 403 CONNECT |
| `github.com/epoch-research` (Epoch's own org, 33 repos) | **200 — reachable, carries no data-centres dataset** |
| Founder-supplied file in either repo | none present |

The GitHub 200 is the control: the block is **host policy, not a network fault**. Recorded
**BLOCKED/UNKNOWN — never zero**. No mirror, no scrape, no search-snippet substitution.

## 8. All 452 — complete correctness reconciliation

The 452 are **96 distinct source records** fanned across ZIP pages by the existing 3-mile
spatial scoping. Every one was pulled and read (3 index-scan chunks over the 214 DC-project
ZIPs; the previously-timing-out full-table scan was never repeated).

| | |
|---|---:|
| Distinct source records behind the 452 rows | **96** |
| Classified from the source's own `type_raw` | **17** |
| Classified from the source's own `name` | **79** |
| **Classified with NO data-centre string anywhere (fabrication)** | **0** |
| Classified from a place name, operator, or coordinate alone | **0 — structurally impossible** |
| Records tripping the street-name guard | 0 |
| Power-generation / crypto-mining / warehouse / office records wrongly captured | **0** |
| Campus records fabricated or collapsed | **0** — each source filing stays one record |

Types displaced: Development 43 · Industrial 20 · Commercial 16 · unclassified 8 ·
Civic/Public 6 · Utility 3. Every displacement was read individually; each is a coarse bucket
losing to the record's own stated class (Phoenix files data-centre fire work under the Fire
department code → Civic/Public; San Jose's `type_raw` literally reads `Data Center` and the
registry mapped it to Industrial).

**Product nuances recorded, not defects.** Roughly a third of the 96 are *ancillary permits at
a data centre* — a fire pump, gates, a sign, a CRAC unit, interior partitions, a roof. The
**type** is right (the thing worked on is a data centre); what these do not convey is
**scale**. A resident sees "Data center" for a sign permit and for a 20-storey new build alike.
That is a stage/scale display question for Map 1, not a classification error, and is out of
scope here.

**Fan-out is pre-existing, not introduced.** 6 records produce 135 of the 452 ZIP-rows; two
MassDOT HQ records alone appear on 66 Boston ZIP pages. They already appeared on all those
pages — as "Roads & infrastructure" diamonds. This change alters their **shape and label only**;
no record's geography, ZIP set, or coordinate changes.

## 9. Case B — the measurement that mattered, and its verdict

Searched the corpus for real data centres the classifier still leaves as another type, bounded
to the **1,045 ZIPs where Compute Atlas independently places a data centre but HomeSignal
classifies none** — index-friendly `zip IN (...)` chunks, never a full-table scan.
**522 of 1,045 ZIPs measured (50%).** Three signal tiers:

| Tier | Signal | Hits | True data centres | False positives |
|---|---|---:|---:|---:|
| 1 | Explicit alternative vocabulary (`colocation`, `colo`, `server farm/room/hall`, `data hall`, `computer room`, `internet exchange`, `IDC`, `hyperscale`) | 1 | **0** | 1 |
| 2 | Compute Atlas operator brands (65 curated) | 57 | **5** | 31 adjudicated, 21 unadjudicated |
| 3 | Megawatt capacity language | 1 | **0** | 1 |

**Finding 1 — the classifier's vocabulary is not the gap.** Across 522 ZIPs, not one record
uses an alternative data-centre wording without also saying "data center". Tier 1's single hit
is `Building AT&T full Colo on existing rooftop - install antenna` (telecom colocation); Tier 3's
is `Cummins 1.5 MW optional standby power generator`. Adding either vocabulary would import
false positives and recover nothing.

**Finding 2 — the real gap is operator-named projects, and it cannot be closed safely.** The 5
genuine misses are `CoreSite VA1`, `CORESITE VA3-2 PHASE 2`, `CoreSite VA3-2A (Phase 2A)`,
`CORESITE VA-1 CR14B CRAH Addition` and `EDGECONNEX / #500` — all Atlas-corroborated Reston
campuses whose HomeSignal wording carries only the brand. The same brand rule that finds them
also produced, from real production rows:

- **20 residential townhouses** — `VANTAGE HILL - LOT 1..20 - TH` (Vantage is both a data-centre operator and a subdivision name)
- `AMAZON DELIVERY STATION, 7659 SOLLEY ROAD` — a delivery warehouse
- `Google Reston Training Room / 16 FL`, `Oracle-Reston-/ 4th FL corridor` — office fit-outs
- `ORACLE BOOTH #5739` — a **trade-show booth**
- `US 202: Markley Street` — a **street name**
- `Structural work … aligned with existing slab` — **"aligned" as an ordinary English verb**

**31 false positives against 5 true finds.** Turning 20 townhouses into data centres on a
homebuyer's map is a far worse product outcome than missing five Reston permits. The classifier's
refusal to read operators is therefore **validated by measurement, not assumed** — and is now
pinned by 13 regression tests built from these exact production strings.

**Extrapolated, unmeasured:** ~5 true misses per 174 ZIPs suggests **roughly 30 record-level
misses** across the full 1,045. Stated as an estimate; the other 523 ZIPs were not measured.

## 10. Map 1 behaviour — verified end to end

Traced source → classifier → read model → render on a live ZIP. `app_projects_for_zip('20151',
'development')` returns **378 rows, 8 carrying data-centre wording, 0 missing `lat`** — matching
the per-ZIP measurement for 20151 exactly. All 8 resolve to `datacenter`/octagon through the
shipped `HS.resolveMarker`. Data center is a generated `SHAPE_LEGEND` row and filter bucket, so
exposure needs no separate wiring. Facility records still resolve `PRECEDENCE:facility-flag` →
purple square. No geometry, ZIP assignment, or radius behaviour was touched in either page mode.

## 11. Known limitations — stated, not resolved

1. **Epoch AI never applied** — blocked; the independent-coverage question stays open.
2. **Case B measured on 50%** of its ZIP space; ~30 record-level misses estimated, not counted.
3. **~30 record-level misses are structurally unreachable** without an operator-identity join that this evidence shows is unsafe as a classifier rule.
4. **Scale is not conveyed** — a sign permit and a 20-storey build both render "Data center".
5. **Coverage remains far short of reality** — Atlas places ≥1 data centre in 1,152 modelled ZIPs; HomeSignal classifies 214.
6. **450 of Atlas's 1,110** data centres sit outside the modelled 12,722-ZIP geography entirely.
7. Pre-existing, unrelated, **not fixed**: `NAME_RULES` matches `townhou?se` but not the plural `TOWNHOMES`, so `VANTAGE HILL TOWNHOMES` lands on the honest circle rather than Residential.

---

# Adversarial audit — the corrections that reached production (2026-09-05)

A competitor-CTO audit attacked the claim head-on: *would a stranger, shown these pins, find
one that is not a data centre?* The output of this pass is not another report — it is three
changes to `lib/map.js` and 33 more regression checks.

## 12. False-positive attack — 8 patterns, every one of the 96 distinct records

Run over the **full untruncated `name`** of all 96 distinct source records behind the live 452
(not the truncated display string, which is how a permit's real subject gets hidden):
incidental reference · power generation / substation / transmission · warehouse or logistics ·
office fit-out · crypto mining · telecom / central office · generic-name-only ·
operator-brand-only.

| verdict | records | notes |
|---|---:|---|
| **PROVEN CORRECT** | 94 | each states a data centre in its own words |
| **PROVEN FALSE POSITIVE** | **0** | no record classified without a literal data-centre string |
| **AMBIGUOUS** | 2 | `AT&T - OAKTON DATA CENTER GENERATOR POWER` (backup power AT a data centre) and a Phoenix `QTS DATA CENTER` sign permit — both real data-centre work, neither a new building |
| **UNMEASURED** | 0 | every distinct record was read |

**4 of 96 trip at least one attack pattern**, which is the control that makes the 0 readable: a
zero from a probe that fires on nothing is indistinguishable from a dead query.

## 13. The incidental-reference guard — shipped on absence, not on a hit

The worst failure this type can have is telling a resident a data centre is coming when what is
coming is a **switchyard**. `DATACENTER_SERVING_RE` (a "serving / feeding / adjacent to /
in support of" construction) **AND** `DATACENTER_COMPETING_RE` (substation, switchyard, kV,
transmission, solar, BESS, wind, power plant, cell tower, antenna) must **both** fire before a
name is vetoed. One alone is not enough, deliberately:

- `AT&T - OAKTON DATA CENTER GENERATOR POWER` — no serving construction → **keeps** classifying.
- `PHX 05-3 DATA HALL 1B BESS PERMIT` — battery plant **inside** the data hall → **keeps**
  classifying, even though it names BESS.
- `132 kV substation to serve the Vantage data center` → **vetoed**.

**0 of the 96 live records trip this guard today.** It ships anyway, for the same reason the
street-name guard did: such records certainly exist nationally, they are simply not yet in a
county HomeSignal has wired, and the corpus grows on every ingest.

### The real defect this found — a guard overturned one phase later

Writing the guard surfaced a bug in the shipped code: it vetoed `type='Utility'` cases but not
`type='Development'` cases. Cause — generic types fall through to `NAME_RULES`, which carried a
**duplicate** data-centre rule that re-classified records the DATACENTER phase had already
vetoed. Proven a strict subset of `DATACENTER_RE` and **deleted**, with the reason left in
place as a comment. Pinned by `13c` (a vetoed record carries no `DATACENTER` shapeRule at all)
and `13d` (the street-name veto also survives every later phase) — a guard that a later phase
can overturn is not a guard.

## 14. Case B completed — and it disproved my own 50% conclusion

The previous pass reported, from 522 of 1,045 Atlas-proven ZIPs, that *"the vocabulary is not
the gap."* Completing chunks 3–6 **disproved that**, which is why the measurement was finished
rather than extrapolated.

**`data hall` is a real, unambiguous missed vocabulary** — the industry's own term for a data
centre's equipment floor. Nationally it appears in **11 development records and every one is a
genuine data centre**: two Mesa AZ ground-up buildings (243,332 SF and 285,282 SF), a Memphis
data-hall structural addition, an Amazon data hall, an Iron Mountain colocation TI, three
Phoenix PHX05 battery permits and two Phoenix fire-alarm modifications. Added to
`DATACENTER_RE`.

Its neighbours in the same sweep were **rejected on the same evidence** — precision, not
vocabulary breadth, is what makes this type trustworthy:

- **`colo`** matches `813726 Verizon New Colo LDO2022-00283` (a cell site), `AT&T full Colo on
  existing rooftop - install antenna`, and `US 65 0.2 mi S of Co Rd E41 in **Colo**` — an Iowa
  highway segment, in *Colorado*.
- **`server room`** matches ~24 office fit-outs: mini-splits, clean-agent suppression, wall
  heaters, `INTERIOR ALTERATIONS FOR NEW SERVER ROOMS ON FLOOR 36 & 37`.

Operator-brand matching stays refused, now on the completed corpus: **~5 true finds against
31+ adjudicated false**, including 20 `VANTAGE HILL … TH` townhouses, an Amazon delivery
station, Google/Oracle office fit-outs, `ORACLE BOOTH #5739`, `Markley Street`, `pre-lumen`,
an `IDC` permit code, a bell-tower antenna colocation, and *"aligned"* used as an English verb.

## 15. Production delta after this pass

| measure | before | after | change |
|---|---:|---:|---|
| Data center **project rows** | 452 | **479** | +27 |
| ZIP pages with ≥1 Data center pin | 214 | **219** | +5 |
| distinct source **records** | 96 | **107** | +11 |
| **proven false positives removed** | — | **0** | none were found |
| **proven false negatives added** | — | **11** | all `data hall` |

⚠️ **One number needs stating precisely rather than as "738 unchanged."** The 738 is the count
of FRS rows typed `type='datacenter'`, and all 738 are untouched. A *vocabulary*-based count of
FRS rows now returns **739**, because the widened pattern also reaches one existing facility —
`epa_frs:110038203734`, `CYRUS ONE DATA HALL 1 POWER POD 1` (`type='energy'`, ZIP 75067). It
still renders as **Regulated facility**: the facility flag short-circuits before the DATACENTER
phase. Nothing was converted, and no regulatory identity was overwritten. Different denominator,
not a change — pinned by test `14d`.

## 16. Verification for this pass

- `test/marker-datacenter-type.test.mjs` — **87 checks** (was 54), every string verbatim
  production text: 7 guard-fires, 5 must-keep, 11 `data hall` keeps, 3 BESS-inside-a-hall keeps,
  7 rejected-neighbour vetoes, 1 frozen FRS facility, plus the two overturn regressions.
- Affected map/marker suites re-run and green: `maps-category-contract` (178),
  `maps-delvalle-golden` (235 — no golden classification drifted), `maps-rule-output-contract`,
  `marker-name-enrichment`, `maps-rest-shape-parity`, `cleveland-type-map`,
  `arcgis-type-const-with-map`, `city-of-orange-connector`, `idaho-itip-pair`,
  `kytc-syp-connector`, `phoenix-connector`, `type-raw-provenance`.
- **Full offline suite: 143 files, 0 failed.**
- Geography untouched in both page modes — no coordinate, ZIP assignment, radius or campus
  grouping was written, derived or fabricated. Atlas coordinates were used only to *select ZIPs
  to measure*, never as geometry.
