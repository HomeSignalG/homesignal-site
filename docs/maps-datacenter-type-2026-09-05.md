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
