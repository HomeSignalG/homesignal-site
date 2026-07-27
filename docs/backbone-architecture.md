# The development-ingestion backbone

**Status: Phases 1–3 implemented (branch only, not deployed). Phase 4 identified, not built.**

The objective is no longer "add another source." It is: *every future source is an adapter,
never an engine project.* This document is the contract that makes that true.

---

## 0. The one rule

**Adding a platform = one adapter module + one `ADAPTERS` row + one registry section.
Adding a jurisdiction = one `jurisdiction-registry.json` entry, no code at all.**

If a change to support a new source requires editing `index.ts` anywhere other than the
`ADAPTERS` table, the backbone has regressed and the change is wrong.

---

## 1. Dependency graph

**Before** — the contract was a side effect of one platform:

```
                    socrata.ts  ← the de-facto contract
                    ▲  ▲  ▲  ▲
        arcgis.ts ──┘  │  │  └── carto.ts
             ckan.ts ──┘  └── csv.ts
                        │
     index.ts ──────────┴── 6 hand-written call blocks
                             5 byte-identical mapping blocks
                             manual dedupe list + 5 response keys
```

**After** — the arrow points one way, into a neutral module:

```
                    contract.ts   (types · SourceAdapter · RunReport ·
                    ▲ ▲ ▲ ▲ ▲     safe helpers · geofence · backoff · validator)
                    │ │ │ │ │
   socrata ─────────┘ │ │ │ └───────── carto
        arcgis ───────┘ │ └─────── csv
              ckan ─────┘
                    │
     index.ts ──────┴── ADAPTERS[] → one loop → toEngineSites()
```

`contract.ts` imports nothing from any platform module. That is enforceable by inspection
and is the property that makes an adapter droppable.

---

## 2. What is shared, and what is deliberately not

### Hoisted into `contract.ts` (proven safe)

Every helper here was diffed across all five copies before moving. Moved only when
behaviourally identical or a strict superset:

| Helper | Basis |
|---|---|
| `readCol` | socrata's dot-path variant is a **strict superset** — the path walk runs only when `row[ref] === undefined && ref.includes(".")`, so flat refs are byte-identical |
| `firstCol` | all five copies byte-identical |
| `valOrNull` | two spellings, provably equivalent |
| `buildBucketLookup` | `forEach` vs `for…of` only |
| `layerFor` | trailing-comment difference only |
| `coverageMatches` | identical in socrata + arcgis |
| `GEOCODE_FENCE_MI` + `milesBetween` | identical constant and formula (arcgis `milesBetween`, socrata `milesBetweenGeo`) |

### Deliberately NOT hoisted — platform policy (`RecordCodec`)

The audit found these are **not** the same function wearing five hats. Unifying any of them
is a behaviour change requiring its own evidence pass and a re-cache diff:

| Helper | Divergence |
|---|---|
| `isoDay` | 3 semantics: strict regex (socrata) · +epoch-millis (arcgis) · permissive `new Date(s)` (ckan/csv/carto). `"15 Jul 2026"` parses under one, returns null under another |
| `numOrNull` | `" "` → `0` (socrata/arcgis, `v === ""`) vs `null` (ckan/csv/carto, `String(v).trim() === ""`). The former can produce a Null-Island coordinate |
| `fillTemplate` | raw substitution · encode + URL validation · encode + trim + stricter validation |
| `extractUrl` | returns `""` vs `null`; http-scheme validation present or absent |
| `rowId` | genuinely platform-specific id precedence (`:id` / `OBJECTID` / `_id`) |

**This is the most important finding of the sprint.** A "clean" extraction that unified these
would have silently changed output in three adapters. The contract names them as policy
instead of pretending they are the same.

---

## 3. The record contract

`NormalizedRecord` — 28 existing fields plus four **declared but not populated** additions
that close the review's gaps (`parcel_id`, `approx`, `retrieved_at`, `raw_ref`). They are
optional, so adding them changed no existing output byte. Populating `retrieved_at`/`raw_ref`
is the staging layer (Phase 4).

Anti-fabrication invariants, unchanged: `record_url` required and non-empty · absent fields
stay absent · coordinates only from source geometry or a geocode that passed the fence.

---

## 4. Adding a source (the whole procedure)

1. Write `sources/<platform>.ts` exporting
   `<platform>ForZip(zip, communities, entries, deps) → { sites: NormalizedRecord[]; reports: RunReport[] }`.
   Import types and safe helpers from `./contract.ts`. Declare your own `RecordCodec`
   members if your platform's date/URL semantics differ.
2. Add a section to `jurisdiction-registry.json`.
3. Add one row to `ADAPTERS` in `index.ts`.

Nothing else. No new call block, no mapping block, no response key, no dedupe edit, no
counts edit.

**`ADAPTERS` order is contractual.** Adapters run sequentially in that order and their
records concatenate in it, because `dedupeExactPermits` is first-seen-wins. Appending is
safe; reordering requires a golden-set diff.

---

## 5. Remaining technical debt (honest list)

| Item | Why deferred |
|---|---|
| **Geofence not applied in ckan/csv/carto/TABS** | Moving the fence to shared was decoupling; *applying* it more widely is a behaviour change, explicitly out of scope this sprint. Measured live blast radius today: **1 record** (Boston 1 geocoded of 3,336; Philadelphia/Pittsburgh/San Diego carry native coords, 0 geocoded). Needs approval + re-cache diff |
| **`csv.ts` has no retry/backoff** | `fetchWithBackoff` now exists in the contract; wiring it changes error-path behaviour |
| **`isoDay`/`numOrNull`/`fillTemplate`/`extractUrl`/`rowId` still per-adapter** | Genuine semantic divergence (§2). Each needs its own evidence pass |
| **TABS outside the contract** | `TabsSite` ≠ `NormalizedRecord`; TABS also has no registry section, no pagination, and cannot search (`PIN_SEARCH` unset — registry mode over 5 pinned project numbers). Bringing it on-contract is connector work, excluded this sprint |
| **Six `*RunReport` shapes** | All now structurally extend the shared `RunReport` core, but each keeps its platform identity field. Collapsing fully is cosmetic |
| **Staging layer / server-side fetch / detail enrichment / coded-value translation** | Phase 4 — identified below, not built |

---

## 6. Phase 4 — identified, not implemented

| Capability | Why it matters | Trigger to build |
|---|---|---|
| **Staging table** (`staging_records`: raw payload + `retrieved_at` + endpoint) | Nothing retains raw source payloads, so `retrieved_at`/`raw_ref` cannot be populated and a parser regression can't be replayed | Needed before per-record provenance is claimed anywhere in the UI |
| **Server-side fetch abstraction** | The engine only has `fetch`. WAF-blocked hosts (El Paso, Tampa) answer `pg_net` with 200 and the edge runtime with 403 — this is the single largest measured blocked opportunity (**163 dev-empty ZIPs**) | Build when El Paso/Tampa are prioritised |
| **Shared detail-page enrichment** | Only TABS fetches per-record detail pages, privately | Build when a second source needs it |
| **Coded-value/domain translation** | ArcGIS `codedValues` domains are hand-transcribed into registry whitelists today | Build when a domain-coded source is wired |

---

## 7. Acceptance criteria and how each is met

| # | Criterion | Status |
|---|---|---|
| 1 | Output byte-identical except intentional metadata | **Met by construction** — new fields optional and unpopulated; helpers hoisted only when proven equivalent; adapter order preserved. **Requires golden-set re-cache diff to confirm empirically** |
| 2 | Regression suites green | 48/49 pass; the 1 failure (`video-producer-ingest-sync`) is **pre-existing**, verified by stashing all changes and re-running |
| 3 | Production counts unchanged | Nothing deployed — production untouched (1,462 / 12,722 · 615,735 markers) |
| 4 | Anti-fabrication unchanged | `record_url` gate, fence logic, fail-closed status all moved verbatim |
| 5 | ZIP routing unchanged | Untouched |
| 6 | Dedup unchanged | `dedupeExactPermits` identity and order preserved |
| 7 | Evidence requirements unchanged | Unchanged |
| 8 | Future adapter needs no core edit | **Met** — `ADAPTERS` table is the single engine touchpoint |

Criterion 1 is the one that still needs empirical proof: a before/after re-cache of a golden
ZIP set spanning all six adapters, diffed field-by-field. That requires a deploy to a test
path and is **not** done — it is the gate before any merge.
