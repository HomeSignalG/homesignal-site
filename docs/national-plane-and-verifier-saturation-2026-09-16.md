# Map 1 national data-center plane — build receipt, and the verifier-saturation incident

Session record for PRs #1227, #1232, #1233, #1234 (2026-09-15/16). Two halves:
what shipped, and **an incident I caused while verifying it** whose cause I
initially misdiagnosed. The second half is the more transferable one.

---

## 1. WHAT SHIPPED

A third Map 1 data plane carrying real national data-center records, so a ZIP with
**no local permit or planning connector** still shows sourced projects. Modelled on
the EPA FRS national plane: read live, no jurisdiction-registry entry, no coverage
gate. Source: OpenStreetMap (`telecom=data_center`), ODbL.

| | |
|---|---|
| records imported | 1,824 |
| `map_eligible` | 1,384 |
| excluded | 440 — all "no source-supplied project name", never a placeholder |
| eligible-but-unevidenced | **0** |

DDL of record: `docs/national-dc-plane.sql`. Tests:
`test/national-plane-failure-visibility.test.mjs`,
`test/map1-national-plane-failure.browser.test.mjs`.

### 1.1 🔑 A PRIVILEGED READ IS NOT A CONTROL FOR AN ANON PATH

The RPC shipped `SECURITY INVOKER` against a table revoked from `anon`. Probed
through `execute_sql` as a privileged role it returned 169 records for 20147 and
looked perfect. The browser's own call returned
`401 {"code":"42501","message":"permission denied for table national_dc_records"}`,
and the page's `.catch(() => [])` swallowed it into an empty plane. **The page looked
deployed and rendered nothing.** Fixed with `SECURITY DEFINER` — never a grant of the
raw table, which would expose the 440 ineligible rows.

### 1.2 🔑 A FAILED READ MUST NOT LOOK LIKE A LEGITIMATE ZERO

Two swallow points (`if (error) return []`; `.then(r => r.ok ? r.json() : []).catch(() => [])`)
collapsed a permission error, a 5xx, a timeout, a dropped connection, a malformed body
and an undeployed plane into the same value an empty ZIP produces. This is
`lib/zip-authoritative.js` rule 1 ("`null` IS NOT `[]`") applied to the third plane;
`HS.nationalPlaneResult` is that pattern, beside `rpcAllRows` so the map page needs no
new script tag and no analytics dependency (it does not load `events.js`).

### 1.3 🔑 TRUNCATION REPORTED AS COMPLETE IS THE SAME DISHONESTY, ONE STATE OVER

Found only by evaluating the RPC over **every** canonical ZIP rather than a sample:
`limit 200` clipped **ZIP 20166 (Sterling VA — the Loudoun corridor, the densest ZIP
this feature has)** at 203 eligible records. 200 returned, 3 hidden, reported as a
complete success. **One ZIP of 12,722** — the anomaly size CLAUDE.md calls "exactly
the anomaly size that gets rounded away" — and the one that mattered most.

Cap moved 200 → 1000 (sized from the corpus: 503 B/row measured ⇒ ~491 kB, against a
3.5 MB ceiling and a 1,384-row eligible table) **and made self-reporting via `has_more`**.
Raising a limit only moves the boundary; self-description removes the dishonesty. It
fetches cap+1, because at exactly `cap` rows a full set and a clipped one are identical.

After, over all 12,722: 0 truncated, 0 truncated-and-silent, total rows 9,963 → 9,966
— exactly the 3 that had been hidden.

⚠️ **No production receipt exists for `has_more` firing**: 0 of 12,722 ZIPs reach the
new cap, so it is evidenced by the deployed SQL plus the suites, not a live run.

---

## 2. THE INCIDENT — AND WHY MY FIRST DIAGNOSIS WAS WRONG

While verifying, I dispatched **five full-corpus live verifiers simultaneously**
(`verify-zip-universe`, `verify-zip-pages-live`, `verify-map1-zip-states`,
`verify-communities`, `verify-development`) at 21:28Z. From ~21:13Z to ~22:04Z
PostgREST returned
`503 {"code":"PGRST002","message":"Could not query the database for the schema cache."}`
across `development_reports` and `app_community_meta` — **and to residents**:
`community.html?zip=11706: #commPage never rendered within 45s` on real ZIP pages.

### 2.1 ⛔ I BLAMED MY OWN DDL. THE LOGS REFUTED IT — CHECK BEFORE YOU CONFESS

I had run two `DROP FUNCTION` + `CREATE FUNCTION` pairs shortly before, and
`PGRST002` *is* the schema cache, so I reported that as the likely cause and
recommended changing how DDL is done. **Wrong.** The discriminating query:

```sql
-- postgrest_logs, 5-minute buckets
countIf(event_message ilike '%reload message%')                                as reload_msgs,
countIf(event_message ilike '%Could not query the database for the schema cache%') as pgrst002
```

| bucket | reload_msgs | pgrst002 |
|---|---:|---:|
| 20:50, 20:55, 21:00, 21:05 | 2, 2, 2, 1 | **0** |
| **21:35** | **0** | **2,688** |
| 22:30, 22:45, 22:55, 23:00 | 2, 2, 6, 7 | **0** |

Schema reloads happen routinely on this project and **every one loaded cleanly with
zero PGRST002**. The single window that had PGRST002 had **no reload requested at
all** — the opposite shape from a cache invalidated by DDL.

### 2.2 THE REAL CAUSE: DATABASE SATURATION FROM MY OWN FAN-OUT

The co-occurring error at 21:35 was `57014 canceling statement due to statement
timeout` (5,548 log lines). Endpoint breakdown for 21:30–21:45:

```
app_community_meta   1265   <- verify-communities walking 12,722 pages
app_coverage_states   107
development_reports    32
app_projects           26
national_dc             0   <- my function, absent entirely
```

PostgREST's **own** schema-cache query timed out along with everything else, which
surfaces as PGRST002. My function appears zero times.

> ⛔ **STANDING ANSWER — RUN FULL-CORPUS LIVE VERIFIERS ONE AT A TIME.**
> They are not free reads. `verify-communities` walks 12,722 live pages;
> `verify-development` walks the uncapped cache. Fanning several out at once
> saturates the database, times out unrelated statements, and reaches residents as
> failed page loads. Sequence them, and never start one while another is running.

Baseline pressure is not all mine: `Warp server error: Thread killed by timeout
manager` runs continuously from 20:00Z onward, and at 22:35Z a real resident request
`GET /app_coverage_states?select=*&zip=eq.28403` from `homesignal.net` returned **500**
— the `app_coverage_states` cost problem already recorded in CLAUDE.md, hitting live
pages.

---

## 3. VERIFIER BASELINES (measured — plan against these, do not re-derive)

| verifier | healthy duration | state on this work |
|---|---|---|
| `verify-communities` | 23–47 min | ✅ **12,722 / 12,722, 0 failed** |
| `verify-zip-universe` | ~1 min | ✅ success |
| `verify-zip-pages-live` | ~1 min | ✅ success |
| `verify-coverage-state` | ~19 min | ⚠️ **1** real finding (below) |
| `verify-development` | **~4 h** (#200 238 min, #199 255 min) | ⚠️ red, pre-existing (below) |
| `verify-map1-zip-states` | ~1 min | ⚠️ red, proven pre-existing |

### 3.1 `verify-development` is red on `main`, and only the DELTA is informative

A red badge here carries no information about a change; the failure count must be
diffed against a pre-change run.

| | #200 (2026-09-14, **pre**-plane) | #202 (2026-09-16, **with** plane) |
|---|---:|---:|
| ZIPs checked | 12,722 | 12,722 |
| **Failed** | **28,263** | **30,477** |
| rendered **HIGHER** than counts ← *the only class this plane can cause* | **42** | **41** ↓ |
| rendered LOWER than counts | 281 | 282 |
| rendered rail == 0 | 202 | 204 |
| `NaN` (page never rendered) | 36 | 42 |
| `openstreetmap` / `national_dc` mentions | 0 / 0 | **0 / 0** |

The one class this change could produce went **down**. The dominant class is pages
rendering *less* than their cached counts claim — the opposite direction. The +2,214
is consistent with two days of rolling-refresh drift plus load during the run.

📌 **28,263 failures predating this work is a large standing problem in its own right.**
CLAUDE.md records this class at "390 lines"; it is now two orders of magnitude larger.

### 3.2 `verify-map1-zip-states` — proven pre-existing, not inferred

The 2026-09-06 run (nine days before this plane existed) fails **byte-identically**:
same ZIP 08005, same two assertions, same `[not-measured=false could-not-read=false]`,
same `facilities/other=12`. The real gap it flags: a ZIP with cached facilities but no
authoritative geography renders facilities without saying its development is unmeasured.

### 3.3 `verify-coverage-state` — now 1 failure, down from 2

Ran the full suite 2026-09-16 (12,722 ZIPs, all structural invariants PASS, 22/22
render checks PASS). Remaining: `zero FAILED materializations`
`[19052, 19061, 19374, 19390, 19701 — all failed_ingest]`. **The stale-ZIP assertion
now PASSES** (`observed sweep 53.30h vs 72h window`), so the 48h→72h window correction
is working. Note the `failed_ingest` set has *moved* since CLAUDE.md recorded it — a
live, churning ingest problem in that region, not a frozen list.

---

## 4. INSTRUMENT DEFECTS FOUND (each nearly produced a wrong answer)

- 🔑 **`verify-development` reports a NEGATIVE pass count** — `Passed: -17754`
  (`reports.length + props.length - fails.length` when failures exceed pages). Present
  in #200 too (`-15540`). A verifier that can report negative passes will mislead
  whoever reads it next.
- ⚠️ **A range scan on `text` obeys the DB collation.** A positive control
  `source_key >= 'arcgis:' and < 'arcgis;'` returned **0** on a table holding 2,631,356
  arcgis rows, because punctuation carries little primary weight under `en_US.UTF-8`.
  `collate "C"` fixed it. Rule 9, hit from a new direction — and the zero *looked* like
  a clean result.
- ⚠️ **`.filter(sourced)` is invisible to `grep "sourced("`.** Grepping for the call
  briefly suggested the anti-fabrication gate never ran; it is passed as a bare function
  reference at `homesignalmap.html:2382`.
- ⚠️ **The ODbL assertion was measuring the basemap.** Leaflet prints "© OpenStreetMap
  contributors" for map TILES on every load, so `/OpenStreetMap/` passed trivially when
  the credit was present and failed trivially when absent — it never read the feature.
  The data-centre credit is its own sentence (`Data-centre locations from …`).
- ⚠️ **A browser suite that stubs jsDelivr with `[]`** leaves `window.supabase`
  undefined and kills every case — including the SUCCESS cases, which is what identifies
  it as a harness defect rather than a product one. Use the vendor mocks in
  `test/map1-regulatory-toggle.browser.test.mjs`.
- ⚠️ **Two unrelated 503s are easy to conflate.** The Supabase *MCP* failure was
  `api.anthropic.com/v2/ccr-sessions/.../mcp` (the Claude Code proxy); the verifier
  failure was PostgREST's PGRST002. Neither implies the other.
- ⚠️ **Sandbox egress to `*.supabase.co` is denied by ORG POLICY**, not transient — the
  proxy names the host. `curl "$HTTPS_PROXY/__agentproxy/status"` shows the denial.
  Live checks go through `pg_net` or a GitHub runner.

---

## 5. WHAT REMAINS OPEN

- **`verify-geocodes`** was not run — it historically hits GitHub's 6-hour job cap and
  is unrelated to this work.
- **The 5 `failed_ingest` ZIPs** (§3.3) and the **28,263-failure development-page class**
  (§3.1) are both real, both pre-existing, and both unowned by this session.
- **`has_more` has no production receipt** (§1.3).
