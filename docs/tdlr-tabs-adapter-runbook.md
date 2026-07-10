# TDLR/TABS Adapter — Engine-Side Runbook (Texas enrichment source)

> Decoupled engine job per source-of-truth §7.6 — the page batch never blocks on this.
> Files: `sources/tdlr-tabs.ts` (the adapter) ·
> `docs/pins/tdlr-tabs-projects.travis.json` (registry-mode input).
> Governance: anti-fabrication (§0), quarantine-don't-stop (§7.2), claims discipline.

---

## 0. STEP 0 — pins (do once; the adapter refuses search mode until done)

1. **PIN_FIXTURES.** From a machine with egress, fetch ≥3 real project pages
   (`curl -A "HomeSignal refresh" https://www.tdlr.texas.gov/TABS/Projects/TABS2024022676`
   etc.) and commit them under `fixtures/tabs/`. Run `parseProjectHtml()` against each;
   adjust the label extraction until all fields in §2's expected table parse. **The
   parser was written against screenshots of these pages — screenshots are a LEAD; the
   fixtures are the fact.**
2. **PIN_SEARCH (optional — unlocks search mode).** Capture the live TABS search
   interface (URL, method, params, paging) into `docs/pins/tdlr-tabs-search.md` with
   vintage, then implement `deps.search`. Until then, **registry mode** (a committed
   project-number list per county) is the operating mode — shippable today.
3. **Re-verify the registry file.** Each project number in
   `tdlr-tabs-projects.travis.json` must resolve live (HTTP 200 + page states the same
   number). A 404 is removed, never guessed. The file asserts *existence only* — every
   field on a site comes from the live fetch at refresh time (this is what keeps
   registry mode compliant with "the engine returned it").
4. **Rate limit.** Sequential fetches, ≥1.2s apart (default in the adapter). TDLR is a
   public registry, not an API — be a polite citizen.

## 1. Integration into `get-address-report` (additive branch, address behavior unchanged)

```
ZIP mode, state == TX:
  county = countyForZip(zip)                        // existing communities lookup
  tabs   = await refreshByRegistry(pinnedList(county), deps)   // or refreshBySearch
  sites  = [...epaSites, ...planningSites, ...tabs.sites.filter(inZip)]
  log(tabs.quarantined)                             // quarantine log, run continues
```
- TABS sites are `scope:"point"` with real geocoded coordinates — **never** the
  synthetic area placement. Geocode failure → quarantine (standing answer).
- `counts`: TABS sites count under `development` (they are development records, not
  EPA facilities). Do not touch `counts.facilities`.
- Cache flows through `development_reports` unchanged — extension fields ride in the
  `sites` jsonb; **no new cache columns** (not a §12 schema stop).
- Address mode: include TABS sites within `radius_mi` of the geocoded home, same as
  every other point source.

## 2. Expected output for the case study (parser acceptance table — verify at Step 0)

Refreshing the Travis registry file must yield 5 sites, all `record_url`'d, with
(values below are leads transcribed from the source video — the fixture parse is the
acceptance test):

| project_no | type | layer | owner | owner_phone_norm | contact_name | design_firm | est_cost | sqft |
|---|---|---|---|---|---|---|---|---|
| TABS2023006483 | built | research | River Bottoms Ranch | — | Jeff Gutknecht | Emersion Design | 2000000 | 7500 |
| TABS2023006449 | built | animal-facility | River Bottoms Ranch | 8137589100 | Scott Padilla | Emersion Design | 2000000 | 14200 |
| TABS2024016698 | built | commercial | River Bottoms Ranch LLC | 8137586679 | — | Emersion Design | 1000000 | 3410 |
| TABS2024022676 | built | industrial* | Neuralink | 8137586679 | Scott Padilla | Studio8 Architects | 14700000 | — |
| TABS2026011928 | approved | commercial | Neuralink Corporation | 7078031177 | Kristin Lorentzen | Neuralink | — | — |

\* "New Construction" scope text is thin; layer may resolve to `development` — fine.
Any field the live page doesn't state must be **absent**, not defaulted.

**Entity-matcher smoke test:** `entitiesFrom()` over these 5 sites, grouped by
`phone_norm`, must link River Bottoms Ranch LLC ↔ Neuralink on `8137586679` with
evidence = [TABS2024016698, TABS2024022676] — ≥2 record_urls, satisfying the link
invariant (case-study doc §4.5).

## 3. Verification additions (verify-development.mjs)

- Existing invariant unchanged: every rendered site has a `record_url`.
- New per-source probe: for a sampled TX ZIP, every TABS-sourced site's `record_url`
  matches `^https://www\.tdlr\.texas\.gov/TABS/Projects/TABS\d{10}$` and its
  `project_no` equals the URL suffix.
- Quarantine report: the refresh log's quarantined list is attached to the run summary
  (report, don't fail — §7.2).

## 4. §10 framing (already covered by the proposed amendment — restated for this source)

Render filed facts verbatim with the record linked. `owner`, `contact_name`,
`design_firm`, `est_cost`, `scope_text` are all statements *the filer made to a Texas
agency* — renderable as filed. Entity links render as shared-attribute facts with every
evidence record linked. Never render "shell", "front", "secret", or any intent claim.

## 5. Stops (kept tiny, same shape as §12)

Stop only for: fixtures can't be captured / the page layout defeats labeled parsing
(re-pin, don't guess); the registry blocks automated access (robots/ToS question →
founder); anything requiring new cache columns. Everything else — a 404 project, a
geocode miss, a parse miss on one record — quarantines and continues.
