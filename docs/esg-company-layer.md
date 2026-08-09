# ESG / Sustainability company layer — Del Valle (78617) PILOT

**Status: PILOT, PAUSED FOR REVIEW.** Scope is ZIP **78617 (Del Valle, Travis County, TX)** and
nothing else. Nationwide ingestion is **not** started and must not start until the founder
approves the matching logic and the presentation.

This doc is the source of truth for the layer. DDL of record: `docs/esg-company-layer.sql`.

---

## 1. The one rule

> **No ESG result is better than the wrong company's ESG result.**

Everything below is downstream of that. The layer is **company-level** information about the
business associated with a mapped record. It is **never** a measurement of the individual
facility, and the words *"Company-level sustainability data; not a rating of this individual
facility"* render wherever the data renders.

Facility-level environmental fact stays where it already lives — EPA ECHO / TCEQ via `HS.fac`
(`facility_env`). The two are separate blocks with separate headings and are never merged.

---

## 2. Where the pieces live

| Piece | File |
|---|---|
| Name normalization, confidence tiers, facility→company identification | `supabase/functions/esg-refresh/normalize.ts` |
| WikiRate client, licensing gate, metric classifier | `supabase/functions/esg-refresh/wikirate.ts` |
| The reviewed company registry (DATA — adding a company is an entry, not code) | `supabase/functions/esg-refresh/company-aliases.json` |
| The service (pilot-gated, dry-run by default) | `supabase/functions/esg-refresh/index.ts` |
| Deploy bundle builder (30 KB MCP ceiling check) | `scripts/build-esg-bundle.mjs` |
| Render layer (`HS.esg`) | `lib/templates.js` |
| Map card + detail section | `maps.html` (`esgChipHTML`, `esgSectionHTML`) |
| Tests (31 assertions) | `test/esg-company-matching.test.mjs` |
| Presentation preview harness | `test/esg-preview.mjs` |
| Schema | `docs/esg-company-layer.sql` |

**The pilot gate is `PILOT_ZIPS` in the service.** A non-pilot ZIP is refused with **409**, not
silently skipped. Proven live: `{"zip":"90210"}` → 409. Scaling = editing that one constant.

---

## 3. Matching — two stages, both conservative

**Stage A — mapped record → company.** EPA FRS facility names are **site** names, not company
names. Measured against live `app_projects` (98,059 distinct facility names): a naive
contains-match produces confident, wrong attributions —

| Real facility name | Naive match | Truth |
|---|---|---|
| `ALPHABET GARDEN CHILDCARE-TREATMENT PLANT 1` | Alphabet Inc | a childcare centre |
| `PG&E TESLA SUBSTATION` | Tesla | a PG&E substation in Tesla, **California** |
| `WALMART C/O TESLA ENERGY` | Tesla | two companies in one string |
| `ExecuTesla` (a real 78617 permit) | Tesla | a limousine company |

So Stage A matches only against the reviewed registry, on **whole tokens**, and **HOLDs** when
two entries claim one record. All four cases above are pinned by tests.

**Stage B — company → WikiRate card.** `filter[name]` is a **substring** search ("Amazon" returns
*Banco da Amazonia*). A substring hit is therefore never sufficient: a candidate is accepted only
when its **normalized core is equal** and it is the **unique** such hit. A tie is terminal — the
resolver never falls through to a looser query after finding ambiguity.

**Confidence tiers** (founder's, verbatim): `exact` / `high` / `parent` display · `ambiguous`
HOLDs. Enforced in three places: the resolver, a DB `CHECK`, and the render allowlist (which
fails closed on an unknown value).

---

## 4. Sources — what is actually available

- **WikiRate is reachable and works** (via `pg_net`; the build sandbox has no egress).
- **The WBA has no public REST API** — `api.worldbenchmarkingalliance.org` does not resolve.
  WBA data is instead reached **through WikiRate**, where WBA is the metric **designer**. That is
  also what gives it clean attribution. Across 9 sampled companies (1,800 answers), WBA is the
  dominant designer (**1,454**), and **zero** MSCI / Sustainalytics / S&P / ISS / Refinitiv
  answers appeared.
- **Licensing gate**: an **allowlist** of designers (WBA, SBTi, GRI, CDP) plus a hard denylist of
  proprietary raters. An unknown designer **fails closed** — stored raw, never rendered.

### API limitations found (each with a receipt)

1. **`filter[company_name]` is broken.** `Answer.json?filter[company_name]=Microsoft+Corporation`
   returned answers for **Kiabi**. Always filter by `company_id`. This is the single most
   dangerous defect in the API — it returns plausible, wrong data.
2. **No scale is published for the benchmark metrics.** `+unit.json` and `+value_type.json` both
   **404**, and the metric card returns pointer stubs with `"id": null`. A WBA roll-up like
   `1.8623333` therefore has **no stated maximum anywhere in the API**, so numeric values are
   **suppressed** rather than rendered with an invented scale. `overall_score` stays NULL.
3. **`~<id>.json` returns HTML**, not JSON — use the name-based card URL.
4. Answers cap at the `limit` parameter (200 used); a company with more needs pagination.

---

## 5. THE DEL VALLE PILOT RESULT

Run live through the deployed service (`{"zip":"78617"}`), 2026-08-09.

```
records_examined: 537   companies_identified: 4   displayable: 0   rows_stamped: 0
```

| Record | Kind | Status | Role | Company | Match | Confidence |
|---|---|---|---|---|---|---|
| ATX1 New Construction | development | On file | developer | Neuralink | **not found** | HOLD |
| ATX1 – Third Floor Tenant Improvement | development | On file | developer | Neuralink Corporation | **not found** | HOLD |
| River Bottoms Ranch Barn 2 | development | On file | developer | River Bottoms Ranch LLC | **not found** | HOLD |
| Barn 2 ACT Office | development | On file | developer | RIVER BOTTOMS RANCH LLC | **not found** | HOLD |
| Histology Lab | development | On file | developer | River Bottoms Ranch | **not found** | HOLD |
| TXI- Rio Garfield Site Plan | development | Approved | operator | TXI – Garfield | **not found** | HOLD |
| TXI – GARFIELD SAND & GRAVEL | facility | Operating | operator | TXI | **not found** | HOLD |
| TXI – GARFIELD SAND & GRAVEL PLANT | facility | Operating | operator | TXI | **not found** | HOLD |
| BFI WASTE SYSTEMS OF TEXAS LP | facility | Operating | operator | BFI Waste Systems of Texas LP | **not found** | HOLD |
| BFI RECYCLING CENTER MANOR | facility | Operating | operator | BFI | **not found** | HOLD |
| *527 other records* | 502 dev + 25 fac | — | none | **no company stated on the record** | n/a | n/a |

**Zero displayable ESG matches in Del Valle.** All 10 identifications are *correct* (0 false
positives); the companies simply are not in the open datasets.

### The two near-misses, and why they are HELD

Both are cases where the *parent* is well covered but the **lineage is unsourced**:

- **BFI Waste Systems of Texas LP.** Republic Services **is** on WikiRate (id 48817, 186 WBA
  answers). But Republic's own WikiRate alias list is
  `["REPUBLIC SVS","republic services","republicservices"]` — **no BFI** — and `filter[name]=BFI`
  returns only false friends (*University of Applied Sciences BFI Vienna*, *bfinance*,
  *FABFIL SRL*, *BFIM LIMITED*, *FabFit Apparels*).
- **TXI – Garfield Sand & Gravel.** Martin Marietta Materials **is** on WikiRate (id 2262988,
  186 WBA answers), aliased only as `["Martin Marietta Materials, Inc."]`. `filter[name]=TXI`
  and `filter[name]=Texas Industries` both return **zero**.

*Positive control for those zeros:* the same endpoint returned 1 item for Republic Services and
5 for BFI, so the zeros are real and not a broken query.

Attaching Republic Services' record to a BFI facility on remembered corporate history is exactly
the wrong-company attribution this layer forbids. **Held, pending a sourced lineage** (see §7).

---

## 6. Presentation — what is displayed where

Render the preview with `node test/esg-preview.mjs > /tmp/esg-preview.html`. It drives the
**shipped** `HS.esg` helpers, so it cannot drift from what the site renders.

**Map popup / card — ONE line, no metrics.**
- matched: `🏢 Company ESG · Republic Services`
- unmatched: `ESG data unavailable` (never `0` — a zero reads as "this company scores zero")

A glance surface is where company data is most easily mistaken for facility data, so no pillar
values appear there.

**After "View details" — the full section**, in this order: company · role on this record ·
reporting year · a plain-language framing sentence · Environmental / Social / Governance /
Other reported areas · the scope note · source + CC BY 4.0 attribution + a link to the record.

**Proposed vs operating** — the same data, different framing:

| | Operating facility | Proposed development |
|---|---|---|
| Heading | Company ESG / Sustainability | **Developer sustainability track record** |
| First sentence | "…the company associated with this site (site operator). Environmental conditions AT this facility come from EPA records above." | "…the company behind this proposal (developer), **not a measurement of the proposed facility**." |

**Pillar assignment comes from the metric's own words.** Anything that does not self-describe
(e.g. *Sustainability Strategy Disclosure*) goes to **"Other reported areas"** — never forced
into a pillar, because a forced pillar is an editorial claim about what a metric measures.

### DEFECT FOUND AND FIXED during the pilot — do not re-introduce

The first display rule kept only *pillar/benchmark roll-ups*. But WBA's roll-ups are **all
numeric** (suppressed for lack of a scale) while its **Yes/No answers are the indicators**. The
two filters were each defensible and **jointly empty**: Microsoft's 85 Yes/No answers yielded
**2**, Republic Services' 55 yielded **0** (every one of Republic's Yes/No titles is
code-prefixed). *A rule that renders nothing for every company is indistinguishable from a rule
that is working.* Replaced with a reviewed **homeowner shortlist** of subjects (emissions, water,
waste, pollution, and the governance/social facts a neighbour would weigh), matched after
stripping the WBA code prefix. Pinned by a regression test.

---

## 7. Open questions for founder review

1. **Parent-company lineage.** BFI→Republic Services and TXI→Martin Marietta are the pilot's only
   realistic matches, and both need a **sourced** lineage. Options: (a) leave held; (b) wire an
   SEC EDGAR subsidiary-exhibit source; (c) allow a founder-signed registry entry recording the
   lineage with a citation. **Recommendation: (c) then (b)** — (c) unblocks review immediately
   with an auditable citation, (b) scales.
2. **Is this meaningful to a homeowner?** Honest read: **marginally, today.** Del Valle's operators
   are private/municipal, and even for a covered company the available facts are disclosure
   Yes/Nos ("Waste Reduction Target: No"), not outcomes. It tells a resident whether the company
   *reports and commits*, not how the plant behaves.
3. **Terminology.** "ESG" is jargon. The UI already says *"Company ESG / Sustainability"* and
   *"Developer sustainability track record"*. Recommend dropping "ESG" from resident-facing copy
   and keeping **"Company sustainability record"**.
4. **Auth posture.** `esg-refresh` is deployed `verify_jwt:false` to match the existing
   `get-address-report` pg_net pattern. Writes are opt-in (`dry_run` defaults true) and confined
   to one ZIP, but the endpoint is publicly callable. Worth a decision before scaling.

## 8. Scaling — NOT approved, and what it would cost

Do not scale before §7.1 and the presentation are settled. When approved, the honest constraint
is **coverage, not engineering**: nationwide, the company-bearing surface is small. `developer`
is populated on only **5 of 2,825,490** development rows; the rest of the signal is facility
names, which need a registry entry each. Recommended order: (1) settle lineage; (2) add the ~50
largest national operators (waste, energy, logistics, data centres) as registry entries with
receipts; (3) widen the pilot ZIP list a metro at a time, measuring false-positive rate per
metro before the next.
