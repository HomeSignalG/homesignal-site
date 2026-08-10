# Multi-source evidence — Phase 2 record (Travis County Clerk)

**2026-08-10.** Builds on Phase 1 (`b2e969f`). **The Clerk adapter was not built — the source
prohibits automated retrieval.** What was built instead: honest source registration, an
abstention record for all four instruments, and the ownership-resolution layer the Clerk would
have fed, proven on synthetic contradiction fixtures.

## 1. Source discovery — the assumed path was the wrong one

The Phase 1 brief named `travis.tx.publicsearch.us`. The Clerk's **own** site
(`countyclerk.traviscountytx.gov/departments/recording/`) links instead to
**`https://www.tccsearch.org/`**. Both were probed.

| Path | Result |
|---|---|
| `www.tccsearch.org/` | **HTTP 403**, Cloudflare "Just a moment…" challenge |
| `www.tccsearch.org/robots.txt` | `User-agent: *` → `Allow: /`, but **`User-agent: ClaudeBot` → `Disallow: /`** (also GPTBot, CCBot, Google-Extended, Bytespider, Amazonbot, meta-externalagent). `Content-Signal: search=yes,ai-train=no,use=reference` |
| `travis.tx.publicsearch.us/robots.txt` | `Allow: /$` + `Disallow: /` — everything but the homepage |
| `travis.tx.publicsearch.us/api/*` (4 shapes), `/api/v1`, `/api/v3`, `/search/api/*` | all **404** |
| `api.publicsearch.us` | DNS does not resolve |
| `/results?q=2021024697` | 200, but **no result rows** — the number appears only echoed in the query string, `window.__data` carries a `timedAccess` paywall state and a Sign In gate |

Backend identified as Kofile **`ko-search-api`** (from a `github.com/kofile/ko-search-api` link in
the client bundle).

**Conclusion: there is no lawful automated path to Travis County Clerk metadata.** One portal
names ClaudeBot in an exclusion rule; the other disallows every path. Nothing was scraped.

## 2–5. Instrument 2021024697, parties, recording metadata, parcel linkage

**Not independently determined.** Everything HomeSignal knows about this instrument still comes
from TCAD (Phase 1): document type `WARRANTY DEED`, recorded `2021-02-03`, seller
`DOSS H ALLEN & SUSAN B & TRAVIS A`, buyer `RIVER BOTTOMS RANCH LLC`. That is **appraisal-source
evidence about a deed**, not the deed. The Clerk did not confirm it, and per §5 the correct
action is to abstain rather than promote TCAD's report to recorded-instrument evidence.

Parcel linkage under §13 is therefore **not established at any strength** from the Clerk side —
neither Strong, Strong/derived, nor Weak — because no Clerk document was read.

## 6–7. Source registration and raw preservation

`ev_source.travis_county_clerk` registered: `access_mode='not_machine_accessible'`,
`status='blocked_by_source_terms'`, coverage TX/Travis, capabilities declared,
role map (`grantee` → `grantee_on_recorded_instrument`, `grantor` →
`grantor_on_recorded_instrument`), and authority declared **authoritative for recorded
instruments only** — explicitly not for values, acreage or classification.

There is **no Clerk `ev_source_record`**, because no payload was retrieved. Fabricating one would
be the exact defect the architecture exists to prevent. The TCAD source records are untouched.

## 8. Instrument entity reuse

The four Phase 1 instrument entities were **left exactly as they are** — still classified as
TCAD-reported references. No reuse decision was needed because there was no second observation
to attach. The equivalence rule is nonetheless recorded for when there is: reuse the existing
entity when the Clerk's own document number normalizes to the same
`travis.instrument_no` value, since that identifier is unique within the recording jurisdiction;
attach the Clerk observation as an additional `ev_entity_identifier` row plus new claims, never
as a second instrument entity.

## 9–11. Claims created, corroboration, the other three instruments

- **Clerk claims created: 0.**
- **TCAD's `property_owner_of_record` claim is intact** (measured: 1).
- Corroboration state for parcel 292354 is **`single_source`** — correct and honest. It is *not*
  "corroborated by independent county records", because there is only one county source.
- All four instruments (`2008006779TR`, `2010122587TR`, `2012114190TR`, `2021024697`) were
  attempted and recorded as **`unavailable`** — the §15 category "lookup error / access denied",
  never "not found" and never "does not exist".

## 12. Ownership trail

**Cannot be produced from recorded instruments.** The only chronology available is TCAD's
reported deed list, which is already stored as four `conveyed_by_instrument` claims at
`source_reported` / `official_secondary`. Presenting that as a recorded-instrument trail would
misrepresent its provenance. **The gap is the finding.**

## 13. What HomeSignal can defensibly say today

> *Travis Central Appraisal District records RIVER BOTTOMS RANCH LLC as the owner of record for
> property 292354 as of the 2026 roll. TCAD additionally reports a 2021 warranty deed
> (instrument 2021024697) naming that company as buyer. The Travis County Clerk's own records
> were not consulted — the county's records portal prohibits automated access.*

Nothing stronger is supportable.

## 14–16. What WAS built and proven — ownership resolution

`public.ev_current_owner(id_type, id_value)` implements the minimum §18 policy:
candidates are ownership-bearing claims only; winner is the **latest-dated** claim with
precedence breaking ties (recency first, so an older deed cannot override a newer roll);
every candidate is always returned.

**Live, parcel 292354:** state `single_source`, display owner `RIVER BOTTOMS RANCH LLC`,
basis `property_owner_of_record`, as-of `2026-01-01`.

**§22 synthetic historical chain** (assessor 2026 = A; deed 2015 grantee = B; deed 2020
grantee = A): state **`single_source`**, display owner **Company A**, **3 claims retained**,
Company B **retained** and *not* labelled a conflict. ✅

**§23 synthetic same-period disagreement** (assessor 2026 = A; deed recorded 2026 = B, equal
rank): state **`disagreement`**, **both claims retained**. ✅

Both fixtures ran inside a transaction and were **rolled back** — nothing persisted.

## 17–18. Consumer read + privacy

`ev_parcel_report()` is unchanged and still shows TCAD ownership, TDLR projects and the four
TCAD-reported deed references with their caveat. `ev_current_owner()` is the new parallel read.
Both are `SECURITY DEFINER` with EXECUTE revoked from `anon`/`authenticated`
(verified: `has_function_privilege('anon', …)` = **false**). All 22 evidence tables still have
RLS enabled with no policies. No raw payload, mailing address, phone or personal field is
exposed. Since no Clerk document was retrieved, no individual's recorded personal data entered
the system at all.

## 19–20. Tests and backward compatibility

New suite `test/evidence-phase2-clerk.test.mjs` — 20 assertions, all pass. Full repo suite
**96 files green** (95 → 96).

| | Phase 1 baseline | Phase 2 after |
|---|---|---|
| parcels / orgs / developments / instruments | 1 / 6 / 5 / 4 | **1 / 6 / 5 / 4** |
| claims | 104 | **104** (0 added — nothing was fabricated) |
| sources / predicates | 3 / 17 | 4 / 21 |
| Clerk source checks | 0 | 4 (`unavailable`) |
| property_reports / roles / refs / conflicts | 1 / 66 / 33 / 4 | **1 / 66 / 33 / 4** |
| resolved_project_parcels / app_projects / development_reports | 93 / 3,027,773 / 12,722 | **93 / 3,027,773 / 12,722** |
| evidence tables without RLS | 0 | **0** |

## 21. Problems discovered

1. **The brief's assumed Clerk URL was not the county's designated portal.** `tccsearch.org` is.
   Following §3 ("do not assume the access path") is what surfaced it.
2. **A county's official records can be legally unreadable by an automated agent.** The
   architecture assumed adapters fail on *technical* grounds; this one fails on *terms*. The
   `ev_source_check` model absorbed it without change — but `ev_source.status` needed a value
   (`blocked_by_source_terms`) that no prior source had used.
3. **Corroboration cannot be manufactured.** The headline Phase 2 goal — independent
   confirmation of River Bottoms Ranch LLC — is unreachable from public endpoints.

## 22. Deliberately not done

No scraping of either portal · no CAPTCHA/Cloudflare circumvention · no paid document purchase ·
no Clerk claims, source records or instrument entities · no third-party title aggregator (would
not be first-party evidence) · FRS/Brunswick/NYC/DeSoto/MassDOT/TCEQ/ESG/legacy-identity/property
card all untouched · no sibling parcels.

## 23. Phase 3 recommendation

**Do Phase 3 as originally framed — jurisdiction independence with a second county — and pick a
county whose recorder is machine-readable.** That proves portability *and* delivers the
recorded-instrument evidence family that Travis cannot. Good candidates are counties on
open ArcGIS/Socrata recorder feeds rather than Kofile/Tyler paywalled portals.

For Travis specifically, the legitimate routes are procurement decisions, not engineering:
a Kofile/PublicSearch data agreement, a Texas Public Information Act request for the recorded
index, or a licensed title-data vendor. Each would arrive as an `ev_source_record` and flow
through the resolution layer already built — **no schema change required.**
