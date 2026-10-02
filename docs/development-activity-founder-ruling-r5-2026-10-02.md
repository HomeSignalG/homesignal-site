# Development Activity — founder ruling R5, 2026-10-02: "No development activity" vs "No data ingested"

Dated record, not edited afterwards. It **decides** the question that
`docs/development-activity-founder-rulings-2026-09-30.md` §R5 left open (that record is not edited; this one
answers it). It governs together with `docs/development-activity-plan-100526.md` (Ruling 5, lines 141–178 and
1338–1352) and `docs/development-activity-build-steps-100526.md` (step 5's founder decision).

## The ruling, in the founder's words (2026-10-02, in session)

> "whhen you say zero proejcts be. more specifc. becuse no ctivity is still a report that has value. are you
> saying it is not populating correctly so do not charge as a report?"

> "so no ctivity implies there is no development. taht is a charged report... but No dt feedimng into the page
> is our error and should not be charged. so your defintion of no activity must only imply that thare is no
> devlopmet activity. that is different thn no data ingest availablee."

> "lets be more clear and write "no devlopment activity" vs "no data ingested""

## What it means: two outcomes for a report with no projects, never confused

| Outcome | Meaning | Uses one of the 20 free reports? |
|---|---|---|
| **No development activity** | HomeSignal's data for this address is being ingested, and it shows no development within 0.5 mile. A real answer with value. | **Yes** |
| **No data ingested** | The report is empty because data for this address is not coming in: no source is cleared for paying customers, a source could not be read, no source covers the area, or HomeSignal cannot prove which. This is HomeSignal's gap, not an answer about the area. | **No** |

A report that **shows development** uses one free report.

The decisions already binding before this ruling are unchanged and never use a free report: an unresolved
address, a ZIP outside `canonical_zip_registry`, a technical failure, a storage failure before the report is
issued, and a report that cannot be issued because no rights-cleared input is available (plan lines 162–168).

## How it is applied (rule `credit-rule-1`)

1. **The words are exact.** "No development activity" is said only where HomeSignal can prove its data for the
   address is coming in. It is never said, and never charged, for an empty report that HomeSignal cannot prove;
   that report is "No data ingested".
2. **Proof, not a query result.** A query that returns zero rows is not, on its own, proof of no development
   activity (plan line 1338). The proof is the Maps workbook's VERIFIED ZERO: positive applicability (a source
   that covers this address) and sufficient pipeline verification (that source was read successfully).
3. **What can be proved today, measured 2026-10-02:** nothing yet, for two separate reasons.
   - No development source is cleared for paying customers (`supabase/functions/_shared/report-rights.json`
     `cleared: []`), so every customer report is empty for lack of a cleared input.
   - Even for a cleared source, the inputs the proof needs are not defined. The workbook records the development
     family's freshness standard as `SLA_UNDEFINED` and its freshness field as undefined
     (`docs/development-activity-change-baseline-2026-09-30.md` lines 130–160), and its change control forbids
     inventing them. Several feeds also cover less than the county they are listed for (for example Frisco's
     permits are listed for Collin and Denton counties but carry Frisco only), so "the source covers this
     address" cannot be read off the county.
4. **So, until that proof exists, every report with no projects is "No data ingested" and is free.** The
   charged branch for "No development activity" is built in the one rule and switches on only when the proof
   for an address can be computed; turning it on is a reviewed change with its own tests, not a setting.
5. **A report that shows development is charged even if it also carries a coverage warning** (a source not
   fully read, some sources not included, more records than one report holds), because data for the address is
   coming in. This is this record's reading of "no data feeding … should not be charged"; the founder may
   correct it.
6. **One owner.** The decision lives in one versioned function used by the trial handler (build step 5) and
   tested with every case above. No page, email or other function decides it again.
