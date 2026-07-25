# Accela Validation Spike — plan of record

**Status: DEFERRED — EXTERNAL ACCESS BLOCKED (2026-07-25). Accela is no longer part of the
current execution path. No further Accela work is authorized.**

What happened: the founder attempted to create an Accela developer account at
developers.accela.com and the registration system returned a **server-side entity-save
error**, so no `ACCELA_APP_ID` could be issued. The founder chose to skip Accela rather
than troubleshoot the vendor's registration system. Consequences:

- `ACCELA_APP_ID` is **no longer an active blocker** — nothing is waiting on it.
- Do **not** troubleshoot Accela registration, contact Accela, wait for credentials, or
  design/build the connector.
- Accela is deferred until **materially new access evidence** appears (e.g. a successful
  registration, or an agency exposing records without the credential). If that happens,
  the validation plan below is the plan of record — it remains valid and unexecuted.
- The measured opportunity (400 confirmed dev-empty ZIP pages, upper bound 400-697) stays
  on the books as deferred, not abandoned; El Paso/Tampa's WAF situation is being pursued
  through other routes instead (see `docs/source-registry.md`, next-source assessment).

Everything below is retained as the dormant plan, to be executed only if access evidence
materially changes.

---

This document records the accepted engineering facts at the close of the corrected-URL
ArcGIS campaign, and the exact validation plan that WOULD execute if the credential ever
became available. It is a plan, not an implementation.

---

## 1. Accepted engineering facts (2026-07-25)

1. **The corrected-URL ArcGIS discovery campaign is COMPLETE.** Do not resume broad ArcGIS
   discovery unless new evidence materially changes the opportunity.
2. **Remaining ArcGIS opportunities are exhausted or operationally blocked** — WAF (El Paso,
   Tampa), token-gated (Westchester `Municity5`, `DOH_Permit`), extended maintenance
   (Suffolk), or no longer justify continued discovery cost.
3. **Measured Accela opportunity: 400 confirmed development-empty existing ZIP pages**, upper
   bound **400–697** pending resolution of five ambiguous agencies (below).
4. **El Paso (136 ZIPs) and Tampa (27 ZIPs) are strategically important**: both are
   well-shaped sources whose *ArcGIS* path is blocked by a municipal WAF that 403s the
   Supabase edge runtime, while `apis.accela.com` is **Accela's cloud, a different host** —
   so the Accela route may reach them. Together ~163 ZIPs reachable *only* this way.
5. **The App ID is the only blocker** preventing measurement of the real opportunity.

### Campaign close-out numbers (production-verified)

| Metric | Value |
|---|---:|
| Development-backed existing ZIP pages | 1,462 / 12,722 |
| National coverage | 11.49% |
| Development markers | 615,735 |
| Markers missing `record_url` | 0 |
| Campaign ZIP pages added (Batches 1-5) | 256 |
| Campaign engineering days | 4.7 |
| Campaign blended rate | 54.5 ZIP pages / engineering day |

---

## 2. Credential prerequisite (founder action)

1. Register at **https://developers.accela.com**.
2. Create an application; set environment to **Production**.
3. Copy the **App ID**.
4. Store as `ACCELA_APP_ID` in **GitHub Actions secrets** and **Supabase edge-function
   secrets**. Never paste it into a file, a commit, or chat.

Evidence the credential is genuinely required (Batch 4 + spike probes):

```
GET https://apis.accela.com/v4/agencies            (no header)
→ 400 {"code":"bad_request",
       "message":"App ID or access token is required.",
       "more":"Please set App ID to request HTTP header 'x-accela-appid' for anonymous
               access, or set access token to request HTTP header 'Authorization' for
               authenticated access."}

GET https://apis.accela.com/v4/agencies            (x-accela-appid: <placeholder>)
→ 500 {"code":"internal_server_error"}
```

The header path is live; only a valid App ID is missing.

---

## 3. Execution order (locked)

Ordered by measured ZIP opportunity, so the largest variable is resolved first.

| # | Agency code | Jurisdiction | Dev-empty ZIPs |
|---|---|---|---:|
| 1 | `ELPASO` | City of El Paso TX | 136 |
| 2 | `PIMA` | Pima County AZ | 52 |
| 3 | `PINELLAS` | Pinellas County FL | 48 |
| 4 | `OKC` | City of Oklahoma City OK | 38 |
| 5 | `BIRMINGHAM` | City of Birmingham AL | 30 |
| 6 | `WICHITA` | City of Wichita KS | 27 |
| 7 | `TAMPA` | City of Tampa FL | 27 |
| 8 | `OAKLAND` | City of Oakland CA | 14 |
| 9 | `BERKELEY` | City of Berkeley CA | 9 |
| 10 | `SANTAANA` | City of Santa Ana CA | 6 |
| 11 | `SANTACLARA` | City of Santa Clara CA | 4 |
| 12 | `TACOMA` | City of Tacoma WA | 9 (17 of 26 already populated via ArcGIS) |
| 13 | Resolve ambiguous | `ALLEGHENYCO`, `LANCASTER`, `ALAMEDA`, `DUPAGE`, `ALBANY` | 0–297 |

**Excluded with evidence:** `FAIRFAX` — 47/47 ZIP pages already populated by
`fairfax-active-site-construction` + `fairfax-recent-building-permits`, so its incremental
opportunity is **0**. `NASSAU` and `MONTGOMERY` — both resolve to *"City of Metropolis"*,
Accela's demo tenant, not real jurisdictions.

---

## 4. Per-agency measurement protocol

**Step 0 (once).** Confirm the live anonymous surface against the real API before assuming
any endpoint shape — call `/v4/agencies` with the App ID and read the response to establish
the actual record-search path, required headers (`x-accela-appid`, agency selector), and
paging contract. Do not assume the v4 route names from documentation; verify them.

**Steps 1-13 (per agency).** Record measured evidence for each:

| Check | Pass condition | Evidence to capture |
|---|---|---|
| Anonymous API availability | Non-error response for the agency | Status code + body |
| Development/building records exist | Records returned for a building/permit module | Record count |
| Titles | A populated, human-meaningful title field | Verbatim sample values |
| Statuses | A status field with a finite, verbatim-mappable vocabulary | Full distinct list + counts |
| Dates | A populated issue/submit date | Min/max, freshness |
| Record URLs | Per-record URL, or a template proven to discriminate real vs bogus IDs | Sample URLs + discrimination proof |
| Coordinates or routable address | Per-record lat/lng, **or** an address complete enough to geocode within the fence | Sample values, null rate |
| ZIP routing | Native ZIP, or coordinates usable for spatial ZIP scoping | Null rate, format anomalies |
| Production gate | All five conditions below | — |
| ZIP opportunity | Dev-empty existing ZIP pages in that jurisdiction | Query result |

### The five-condition production gate (unchanged)

A source counts as production-wireable **only** if all five are proven:

1. Passes schema validation.
2. Passes production evidence standards.
3. **Passes edge-runtime connectivity** — pg_net reachability is *not* sufficient (the El
   Paso/Tampa lesson: both answer pg_net 200 and 403 the edge runtime).
4. Successfully materializes markers in production.
5. Survives regression testing.

Conditions 4 and 5 cannot be met during a read-only spike; the spike measures 1-3 and
records 4-5 as *pending*. No source is called wireable until all five are satisfied.

### Rejection discipline

Every rejection is recorded with its verbatim evidence — status code, error body, field
list, or distinct-value list. No rejection is recorded as an opinion.

---

## 5. Final decision rule

After **every** agency has been measured, make exactly one recommendation, supported only by
measured evidence gathered during the spike. No vendor market share, no theoretical
coverage, no assumptions.

- **BUILD ACCELA CONNECTOR**
- **LIMITED PILOT ONLY**
- **NOT WORTH BUILDING**

If the measured production opportunity does not clearly exceed the engineering cost,
recommend against building.

Reference points for that judgement (measured, not assumed):

- Concluded ArcGIS campaign delivered **54.5 ZIP pages per engineering day**.
- Standing floor is **20 newly populated ZIP pages per engineering day**.
- Estimated connector cost: **3-5 days** implementation + **~0.5 day per agency** config
  (~10-12 days for all 12). This is an estimate and is labelled as such — it is not
  measured evidence and must not be presented as such in the final report.

---

## 6. Charter constraints in force throughout

- No new ZIP pages; no expansion of the modeled inventory.
- No geographic scope broadening.
- No weakening of evidence standards.
- No production deployment during the spike.
- No connector implementation during the spike.
- Optimize exclusively for **previously development-empty existing ZIP pages that become
  populated with verified first-party development data**.
