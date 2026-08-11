# The property card — layout of record, and the rules it enforces

**Status:** shipped as `property-card.html` + `lib/property-card.js`, reached from the Maps
slide-in's top link. **Unverified surface** — declared in `scripts/lib/surface-banner.mjs`
`UNVERIFIED_SURFACES`; the offline suites assert the SOURCE, not the rendered live page (§7).

**Read this before changing either surface.** The card is not a dashboard with badges bolted on.
The badges *are* the card: every rule below exists because a specific misreading was possible
without it, and two of them are repairs of defects this repo has already shipped once.

---

## 1. The flow

```
maps.html  ──click a pin or a list card──▶  #infoSlide  (the QUICK VIEW)
                                              │
                                              │  first element in the panel:
                                              ▼  "View the full property card →"
                                     property-card.html?addr=<canonical address>
                                              │
                                              ├─▶ homesignalmap.html?addr=…   (deep filing history)
                                              └─▶ each record's own official public record
```

The slide-in answers *what is this and should I care*. The card answers *what is on record at
this address, source by source, and what have we not looked at*. Those are different questions,
which is why they are different surfaces rather than one panel that grew.

---

## 2. The state vocabulary (`HS.card.STATES`)

Seven states come verbatim from `docs/multi-source-evidence-architecture.md` **Part 12** and are
not collapsible. Three more describe *coverage* rather than a single claim, and each names a
condition already seen in production that the seven cannot express without lying.

| State | Renders as | Means | Can carry a count? |
|---|---|---|---|
| `verified` | Checked — records found | Register of record returned records | **yes** |
| `reported` | Checked — records found as filed | An authoritative filing; values are as filed | **yes** |
| `checked_empty` | Checked — no records found | We queried it; it returned nothing. A real, measured zero | **yes** |
| `conflicting` | Sources disagree | ≥2 active contradicting claims, both kept | **yes** |
| `unresolved` | Unresolved | Claims exist; arbitration produced no winner | no |
| `partial` | Partial coverage | Some fields checked, some not (a section rollup) | no |
| `in_progress` | In progress | A corpus is being built and is not queryable yet | no |
| `not_checked` | Not checked | **No check exists.** Not a finding of any kind | no |
| `unavailable` | Source unavailable | We queried it and the request failed | no |
| `access_restricted` | Access restricted | The source exists and refuses automated access | no |

**Why `access_restricted` is not `unavailable`:** retrying will not help. Buffalo's permit views
return 403 "Cannot read rows"; Fort Bend's permitting web map 403s outright
(`docs/source-registry.md`). Rendering those as a transient outage implies a retry that will never
succeed.

**Why `in_progress` is not `not_checked`:** it says work is underway. Nothing in the page infers
it — only the read model may set it, because claiming work is in progress that is not is a
provenance fabrication (CLAUDE.md, "A provenance field records what was actually done").

**Fail closed.** `HS.card.state()` maps null/empty → `not_checked` (Part 12: *no `source_check`
row* **is** "not checked"), tolerates shape (`"NOT CHECKED"`, `"checked-empty"`), and returns
`null` for anything it does not recognize. It never guesses the nearest plausible state — every
state is a claim about what we did, so guessing one fabricates a provenance record. A `null`
state is non-countable, so an unreadable state can never print a number either.

---

## 3. THE GATE: `HS.card.metricText(state, n)`

**The only function on either surface allowed to print a number.**

```
metricText('not_checked',   0)  ->  '—'      // NOT '0'
metricText('unavailable',   0)  ->  '—'
metricText('checked_empty', 0)  ->  '0'      // a measured zero IS zero
metricText('verified',      4)  ->  '4'
metricText('verified',   null)  ->  '—'      // "we counted" ≠ "we have a number"
```

This is not a style preference. A `0` printed next to a source nobody queried reads as *clean* —
which is exactly the defect PR #662 repaired on the ZIP page after a failed EPA read rendered as
zero facilities across 1,722 pages. The property card multiplies that surface by twelve sources,
so the gate is a function with a test rather than a convention.

The rule runs in both directions. `test/facilities-unavailable-copy.test.mjs` pins the other half:
printing "unavailable" over a *correct* zero (Dugway, Ibapah, Wendover, Grouse Creek are genuinely
0-facility ZIPs) is a new inaccuracy, not a fix. Hence `checked_empty` is countable, and a
checked-but-empty track-record source renders `0 / 0 / 0`.

**Formatting happens after the gate, never instead of it.** A penalty figure is prettified to
`$12,500` only once `metricText` has already decided it may appear at all.

**Each source labels what it counts.** `trackMetricLabels()` gives the state environmental
registry `Programs on record`, not `Enforcement actions` — a programme enrolment displayed under
an enforcement label reads as an accusation the record does not make. A metric a source has no
analogue for stays an em-dash rather than borrowing the nearest available number.

---

## 4. Owner of record vs owner as filed

The specific confusion the card is built not to repeat (**Part 25**). These are two claims from
two sources and they render as two separate lines:

* **Owner of record** — the county appraisal district, the register of record for who owns the
  land. **No assessor adapter exists** (Part 29 Q3 recommends TCAD first), so this line renders
  *Not checked*.
* **Owner as filed on a permit** — what an applicant typed on a filing. Real, cached, and often a
  *different company*. It is labelled as filed, links to its own record, and is **never** used to
  fill in the owner of record.

`test/property-card-page.test.mjs` asserts there is no `owner_of_record || …owner` fallback
anywhere on the page, because that one-character convenience is the whole defect.

---

## 5. Identity — how a card is keyed

The key is the **engine's canonical address string**, the same key `property_reports` and
`homesignalmap.html?addr=` already use (`docs/property-reports-cache.sql`). One normalizer,
engine-side, so the page and the cache always agree about which row is "this property".

Resolution order, in `property-card.html`:

1. `?addr=` — the caller already knows the canonical key.
2. `?zip=` + `?id=` — the caller knows which *record* was clicked. `app_projects` has **no address
   column**, so `HS.data.canonicalAddrFor()` reads the ZIP's `development_reports` row (the same
   row the map page reads) and matches the site on its `record_url`, which is mandatory on every
   emitted site. Matched on the URL, never on a name.
3. Neither resolves → the honest **"this record isn't tied to a parcel yet"** state, which offers
   an address lookup. Picking a nearby address would be a fabricated join.

**Known cost of (2):** it reads a whole cached ZIP row (the heaviest is Cleveland 44127 at ~6 MB).
The obvious fix is to carry `canonical_addr` onto `app_projects` in `app_refresh_zip`, which would
make the link direct — a materializer change, deliberately not bundled here.

---

## 6. What the card can actually show today

Twelve sources are reported on. Only four are wired, and the card says so rather than looking
complete:

| Source | Today | Where the data comes from |
|---|---|---|
| Permit filings (TDLR TABS, county permits) | **wired** → `reported` | `property_reports.sites[]` where `project_no` is set |
| EPA FRS | **wired** → `verified` | sites carrying `registry_id` |
| EPA ECHO | **wired** → `verified` | `site.env.epa` (engine v19) — violations, action year, penalties |
| State environmental (TCEQ Central Registry) | **wired** → `verified` | `site.env.tceq.programs` |
| County appraisal district / assessor | `not_checked` | no adapter — Part 29 Q3 |
| County recorder / clerk | `not_checked` | no adapter — Part 29 Q3 |
| OSHA · SEC · state/local enforcement | `not_checked` | no adapter |
| FEMA flood / wildfire / heat | `not_checked` | `app_environmental_risk` is empty (Part 29, open question) |
| Public meetings & notices | `not_checked` at property level | matched per ZIP/county today; the section links to the community page |
| Sustainability / ESG | `not_checked` | keyed to a company; no company here is resolved to a disclosure |

A source present in `property_reports.sources_checked` is `checked_empty` — that column exists
precisely to record "we queried it and it was empty" as data (Part 12).

**Forward compatibility.** The card already reads the optional `row.parcel`, `row.instruments`,
`row.parents`, `row.hazards` and `row.related` keys, so when `property_card.payload` lands
(Part 21 / Part 31 Phase 6) the page consumes it without a redesign — which is exactly the "no UI
redesign" property Part 25 claims for the read model.

---

## 7. What is checked, and what is not

**Offline (in CI's required `unit` job):**

* `test/property-card.test.mjs` — the state vocabulary is closed and complete; countability;
  fail-closed normalization; **the gate** in both directions; rollup precedence; the donut is
  inline SVG whose arcs fill the ring exactly once (CSP allows no chart library); the declared
  section/tab structure; `keyOf` never invents a key.
* `test/property-card-page.test.mjs` — the slide-in renders the card link *as the first element of
  the panel* on both detail views; the deep sections are folded and **not removed** (the four
  why-this-matters questions and the full-project-page button that `verify-maps-live` asserts on
  the live page are still there); every declared section renders under its declared tab and
  nothing undeclared renders; every count routes through `metricText`; owner-of-record has no
  filed-owner fallback; the disclaimer is present and completeness is never presented as a score.

**Not checked:** the **rendered live page**. Source assertions say nothing about what a browser
paints — the distinction `scripts/lib/surface-banner.mjs` exists to keep honest. The page exposes
`window.__HS_CARD` (`addr`, `cached`, `records`, `sections`, and every painted `metrics` row with
its state) so a live verifier can assert the gate on production: *no value may be a number unless
its own badge says the source was checked*. Writing that verifier needs a new scheduled workflow,
which is a gated change.

For offline render testing there is `window.__HS_CARD_OVERRIDE`, **hard-gated to localhost** —
the same mechanism and the same gate as `homesignalmap.html`'s `__HS_PROPERTY_OVERRIDE`, because
the states this card exists to distinguish cannot all be exercised from one cached row, and a
card whose honest-state rendering is never seen is a card whose honest-state rendering is never
checked. No deployed flow can render injected data.

---

## 8. What the card is not

* **Not a score.** The completeness donut counts sources by research state. No weighting, no
  percentage headline, no grade. A source we have not read counts the same as a source that
  returned nothing — *the badge, not the total, is what tells them apart*.
* **Not a verdict.** Regulatory events relate to entities connected to the property through
  facilities, ownership or filings. They may describe activity at other locations and do not
  establish that anything happened at this address. Environmental records are geo-matched to a
  facility, not to a parcel.
* **Not a place to inherit a company's history.** A parent company's record appears only when a
  published, verified ownership relationship authorises it (Part 14). An unverified name match is
  never promoted to "parent company".

The footer says the first of these in one sentence, on every card, because a grid of green and
grey badges invites exactly the misreading it forbids:

> Data completeness reflects source coverage and our research status only. It is not a rating,
> score, or prediction about this property or any company.

---

## 9. Follow-ups, in the order they unblock things

1. **Carry `canonical_addr` onto `app_projects`** in `app_refresh_zip`, so the Maps link keys the
   card directly instead of reading a whole ZIP row (§5).
2. **A live verifier** over `window.__HS_CARD`, asserting the gate on production (§7). Needs a
   scheduled workflow — gated.
3. **The TCAD + county-clerk adapters** (Part 29 Q3). They are what turn *Property & ownership* and
   *Recorded instruments* from honest gaps into content, and they are the single largest coverage
   gap the architecture audit found.
4. **Consume `property_card.payload`** once Phase 6 lands, replacing the per-source derivation in
   `buildSources()` with the read model — and then reconcile this card with
   `homesignalmap.html?addr=`, which renders the same property from the same row for a different
   purpose. Two surfaces over one row is a drift risk; collapsing them before the read model
   exists would just move the derivation.
