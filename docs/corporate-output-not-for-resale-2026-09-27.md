# `"Not for resale"` — origin of the address-report note (2026-09-27)

This resolves one blocker: the `"Not for resale"` sentence on `get-address-report`. It is HomeSignal product copy. It is not a source or legal restriction. It does not hold the cleared New York City or Seattle publisher datasets.

The other registry entries were not reclassified. Property placement through the geocoder, OpenAddresses, or ZCTA stays **HOLD**. The audit verdict remains **NOT YET**. A paid Future Surroundings Report was not started. No product or runtime file changes. The sentence is still in the function.

Measured on `homesignal-site` `e5ef5ec1cececaaa4cce2e0724373c9ac7644c75`.

Canonical audit blob `docs/corporate-output-source-rights-audit-2026-09-27.md` is `c2cc94524ee2d21af47520254703d4a222344c66` on this SHA.

## Decision

| Item | What it is | Effect on cleared publisher rows | Paid property report |
|---|---|---|---|
| `get-address-report` success `note` ending `"Not for resale."` | HomeSignal product copy | Does not hold `nyc-dob-permit-issuance`, `nyc-dobnow-approved-permits`, or `seattle-building-permits` | **HOLD** for geocoder / OpenAddresses / ZCTA |

## Where the words were written

The sentence first appears in `homesignal-ingest` commit `ac1dd1319d23a48b8b5496a56b18deac32d060ee` (2026-06-30, PR #34), in the new file `supabase/functions/get-address-report/index.ts`. That commit is the first revision of the file. A search of the parent tree finds no `resale`. A search of that commit finds the words in one place only, the success `note`:

"Development items are jurisdiction-level (scope=area); facilities are precise (scope=point). Violations link to the EPA ECHO record. Not for resale."

The file header in that commit says: "HomeSignal — get-address-report (live per-address map data for the paid map page)." The same PR's `docs/map-page-plan.md` says the page "is a paid product — $9.99/year, with a free trial." The function bullet in the commit message describes a Census geocode, Supabase development items, EPA FRS facilities, and a subscriber-versus-teaser gate. It does not mention resale, a license, or a publisher.

`homesignal-site` commit `56a82ff8cb0d613c46942077ee843d07d0651963` (2026-07-04, PR #113) copies the function in and adds a ZIP success return with the same four words. PR #113 says address mode is unchanged from the deployed function. Its body describes anti-fabrication and EPA links. It does not mention resale, a license, or a publisher. There are no review comments on that PR.

`a439b2fa8f5b7a4e0784438144fa860c1e4619a7` (2026-07-11, PR #186) rewrites the environmental clause of the ZIP note and leaves `"Not for resale."` in place. The commit message does not explain the sentence.

No later commit in `git log -S 'Not for resale'` on site `main` adds a reason. The evidence documents that quote the sentence record the absence of a reason. They are not the origin.

## What the sentence attaches to

On this SHA the words are the last clause of `note` on both success returns in `supabase/functions/get-address-report/index.ts`:

- ZIP mode, the return that includes jurisdiction-registry reports
- Address mode, the return that includes `sites`

The clause is not a field on one `sites[]` row. It is not limited to EPA, TCEQ, or one `registry_id`. At birth the payload was a Census-geocoded address, jurisdiction development items, and filtered EPA FRS facilities. Permit connectors, including the New York and Seattle views, were added later. The four words were not rewritten when those sources were added. They sit on the whole success JSON because the note string was copied forward.

## What it is not

No publisher terms, statute, or license is cited next to the sentence. The EPA ECHO link in the same note is a pointer to the facility record. The commit does not quote an EPA resale ban, and it does not limit the four words to EPA rows. The Census geocoder is named in the file header as the coordinate step. The commit does not quote a Census resale term as the reason for the note.

`privacy.html` later says: "Use HomeSignal for your own personal, non-commercial purpose of understanding and participating in your community. Don't scrape, resell, or misrepresent our intelligence." That sentence arrives in `112c11f373208d59773181c1c6a33270458acc5e` (2026-07-13, PR #194), a layout promotion. The PR does not mention the API note. It is HomeSignal's consumer acceptable-use rule for the website. It is not the origin of the API sentence, and it is not a City of New York or City of Seattle license.

## Publisher-data rights

`nyc-dob-permit-issuance`, `nyc-dobnow-approved-permits`, and `seattle-building-permits` stay **CLEARED WITH ATTRIBUTION** as publisher datasets, where #1410 and #1416 left them. This sentence does not take that clearance away. It is not a restriction those publishers imposed.

## Paid property-report eligibility

Those datasets stay **HOLD** inside a paid property-proximity report because a pin, a distance, or "near this property" still uses the Census geocoder or OpenAddresses and a ZCTA test. Those inputs stay **HOLD**. This file does not clear them.

The consumer sentence in `privacy.html` remains the website's own acceptable-use rule. It is not a reason to keep the API note as a source hold, and this pass does not rewrite the website.

## Scope of this file

The `"Not for resale"` sentence is product copy, not a source or legal restriction. The other registry entries were not reclassified. The overall verdict remains **NOT YET**. Nothing in this file is **CLEARED FOR PAID REPORT**. The paid Future Surroundings Report was not started. The canonical audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.
