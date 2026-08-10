# PROPOSAL — EPA outage: honest-unavailable copy, and whether a fallback source is real

**Nothing built. Read-only probes only.** Two separate questions; the copy one is the higher
priority because it is a live false statement, and it is answerable now. The fallback one has a
clear technical answer and a blocking unknown.

---

# PART 1 (priority) — the 1,722 pages are making a false statement

## 1.1 What a resident sees today

`homesignalmap.html:378` renders a stat tile:

```html
<div class="cc"><div class="n" id="cFac">0</div><div class="k">Regulated facilities nearby</div></div>
```

filled at line 1141 from `data.counts.facilities`. On the 1,722 affected pages that value is **0**,
so the page states **"0 · Regulated facilities nearby"** for areas where EPA-registered facilities
demonstrably exist. That is not missing data presented as missing — it is a **count asserted as
zero**, which is a factual claim we cannot support.

## 1.2 The statement that IS true for all 1,722, without needing per-page knowledge

We can prove "this page had facilities" for only **234** of them (the ones whose `app_projects`
facility rows had not yet been overwritten when the materializer was paused). For the other
**1,488** there is no surviving before-value — `development_reports` keeps no history.

So do not claim "there are facilities here." **Claim what is certainly true of every one of the
1,722: the EPA read failed for this snapshot.** That holds even for a genuinely-empty rural ZIP
refreshed during the outage — the fetch really did fail there too — so the copy cannot be wrong in
either direction. This is the same discipline as the audit's own rule: *a failed read must never be
recorded as a measured absence.*

## 1.3 Proposed copy

**The tile** — replace the number, do not zero it:

| | today | proposed |
|---|---|---|
| `#cFac` value | `0` | **`—`** |
| `#cFac` label | Regulated facilities nearby | Regulated facilities nearby *(unchanged)* |

**The note** — reuse the existing `#covNote` element (`homesignalmap.html:386`), which already
exists for exactly this class of honesty ("so '0 planning items' doesn't read as 'nothing is
happening'"). Proposed text:

> **EPA's facility service could not be reached when this page was last updated, so the facility
> count for this area is unavailable rather than zero. Planning and permit records below are
> unaffected. This page updates automatically once EPA responds again.**

Three properties that copy has deliberately: it says **unavailable rather than zero** (naming the
distinction the tile was getting wrong), it **scopes the damage** so a resident does not distrust
the permit records that are fine, and it **promises only automatic recovery**, not a date.

`#covNote` and the facilities-only note are mutually exclusive — a page cannot simultaneously be
"showing facilities but no planning items" and "unable to show facilities" — so `updateCovNote()`
gains one branch and no new element is needed.

## 1.4 How the page knows — and how it reverts with no human step

The page cannot tell an outage zero from a true zero today; nothing in the cached row records
*why* the count is zero. Three options:

| option | mechanism | verdict |
|---|---|---|
| **A. infer client-side** | `facilities === 0 && development > 0` | ❌ **rejected** — genuinely-empty rural ZIPs with permits exist (Dugway, Ibapah, Wendover, Grouse Creek are the documented cases). It would print "unavailable" over real zeros. |
| **B. infer from the outage window** | `facilities = 0 AND refreshed_at BETWEEN <start> AND <end>` | ⚠️ works and self-reverts, but hard-codes an incident into the page and needs the window maintained by hand. |
| **C. mark the snapshot** ✅ | one boolean on `development_reports`, e.g. `facilities_unavailable`, set for the identified rows and **cleared by the write path whenever a refresh stores `facilities > 0`** | ✅ **recommended** — the signal lives with the data it describes, and reversion is a side-effect of the repair rather than a separate task |

Under **C** the revert needs no human action and no second deploy: the recovery run repairs a page,
the write clears the flag, the note disappears on that page's next load. Pages repair
independently, so the message clears gradually and correctly rather than all at once.

**Scope of the change if approved:** one column + one line in the collect path (server), one branch
in `updateCovNote()` and one line at `homesignalmap.html:1141` (client). It is resident-visible, so
it is yours; and it should ship **behind** the recovery, not instead of it — the fix for a wrong
count is the right count.

---

# PART 2 — is there a real fallback source? Probed, 2026-08-10

All read-only. **The most useful diagnostic first:** `ofmpub.epa.gov` **is up** — a non-FRS path on
that host returned HTTP 200 with a normal page. The outage is scoped to the
`frs_public2/frs_rest_services.get_facilities` service, not the host or EPA generally.

What `facilitySites()` actually needs, from `index.ts:289-302`: `Latitude83`/**`FacLat`**,
`Longitude83`/**`FacLong`**, `FacilityName`/**`FacName`**, `RegistryId`/**`RegistryID`**, queried by
lat/lng + radius.

| source | reachable | fields vs. what we need | radius filter | verdict |
|---|---|---|---|---|
| **EPA ECHO** `echodata.epa.gov` | ✅ **200, working** | ✅ **all four**, under the exact alternate names the code already accepts — `FacLat`, `FacLong`, `FacName`, `RegistryID` | ✅ **yes** — `p_lat`/`p_long`/`p_radius` returned `Message: Success`, `QueryRows: 626` at 1 mi from downtown Atlanta | **closest thing to a drop-in — but see 2.1** |
| **Envirofacts** `data.epa.gov/efservice` | ✅ 200, real FRS rows | ⚠️ has `registry_id`, `primary_name`, `std_name` — but **NO latitude/longitude in `frs_facility_site`** | ❌ ZIP/attribute only, no radius | ❌ **cannot pin a marker**, and every rendered site must have coordinates |
| **FRS bulk download** `ordsext.epa.gov/.../national_single.zip` | ✅ **206**, ZIP magic `PK\x03\x04` | full registry | ❌ national file | ❌ multi-GB; unusable from an edge function under a ~150 s ceiling |
| **ofmpub (non-FRS path)** | ✅ 200 | n/a | n/a | diagnostic only — proves the host is healthy |

## 2.1 The honest answer: ECHO is a near-drop-in, and I still would not ship it

ECHO clears every *mechanical* bar — same four fields, same radius query shape, and the record link
we already emit is an **ECHO** URL (`echo.epa.gov/detailed-facility-report?fid=<registry_id>`), so
links keep working. It is the one candidate that could be wired without a new connector.

**The blocker is not mechanical, it is semantic: ECHO and FRS are not the same set.** FRS is the
full facility *registry*; ECHO covers facilities in EPA's *compliance* programs (CAA, CWA, RCRA,
SDWA, TRI…). Every ECHO facility is in FRS; the reverse is not true. Swapping the source therefore
**changes which facilities a resident sees**, and would silently drop registry facilities that carry
no compliance record.

**I cannot measure the overlap while FRS is down** — that is precisely the comparison the outage
prevents. Wiring a substitute whose divergence from the thing it replaces is unmeasured is how a
page ends up confidently wrong in a new way, which is the failure this audit exists to stop.

## 2.2 Recommendation

**Wait for FRS. Do not build a fallback.**

- The outage is scoped to one EPA service on an otherwise-healthy host, which is consistent with a
  service fault rather than a decommissioning.
- The damage is **frozen** — the facilities guard is holding, 0 pages have been zeroed since the
  pause, and the count has not moved off 1,722.
- The repair is already built, gated, and armed; it needs EPA and nothing else.
- **Part 1 removes the false statement without touching the data path at all** — which is the
  right response to a source outage: stop asserting something untrue, don't substitute a different
  source under the same label.

**If the outage runs long enough to change that judgement**, the sequence would be: measure the
ECHO↔FRS overlap on a sample of cached pages *once FRS answers* (that is the only time it can be
done), and only then decide whether ECHO is a legitimate second source — as an explicitly-labelled
one, not as a silent stand-in for FRS.
