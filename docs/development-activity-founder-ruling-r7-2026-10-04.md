# Development Activity — founder ruling R7, 2026-10-04: every registry source may appear in a paid report

Dated record. It is not edited afterwards. The list in section 2 is generated from the jurisdiction registry by
`scripts/build-report-rights.mjs` and checked against it by `test/report-rights-r7.test.mjs`; a different list is a new ruling (R8), not an edit.

> **Provenance.** The ruling below is the founder's words as typed in the session, with their spelling. The facts the founder was told
> before ruling (section 1.2) and the measurements in section 5 were read from Git and from the production database (read-only) on
> 2026-10-04 and are labelled as such. Nothing here is a publisher's statement unless a quotation says so.

## 1. The ruling

**1.1 The founder's words, 2026-10-04.** Asked why the Development Activity report for `20 N Main St, Brigham City, UT 84302` came back
"No data ingested" while the development map shows records for the same address:

> i do not undertsnd. every zip code she be producinga report with records

and, to the next message that laid out the options:

> just make all 12,722 prodiuce report with records

**What it decides.** Every source in `supabase/functions/get-address-report/jurisdiction-registry.json` may appear in a customer report.
`supabase/functions/_shared/report-rights.json` lists all of them (section 2), each pointing at section 2 of this file.

**1.2 What the founder had been told before ruling** (all read from Git and the database on 2026-10-04):

- The report was empty because the rights file said `"cleared": []`, and that file is closed by default under R4
  (`docs/development-activity-founder-rulings-2026-09-30.md`): *"A HOLD is never reinterpreted as cleared."*
- The rights audit of 2026-09-27 (`docs/corporate-output-source-rights-audit-2026-09-27.md`) has the overall verdict **NOT YET**. For the
  jurisdiction registry's sources it records *"Not recorded as a grant"*, classifies commercial use, redistribution and derived-data use as
  UNCLEAR and the paid outputs as HOLD, and says *"Do not treat 'public record' or an empty copyright field as a commercial license."*
- For UDOT, which supplies the Brigham City records, the dataset's own licence text says the data is for informational purposes and must be
  field verified; it does not say whether commercial use is allowed (`docs/corporate-output-utah-clearance-2026-10-02.md` §3). The drafted
  request to UDOT (`udotgis@utah.gov`) has **not been sent**.
- Switching sources on without a recorded permission is a legal-risk decision; he was advised to take it to counsel, and offered three
  options: ask the publisher first, rule himself, or leave it off. **He ruled himself.**

**1.3 What kind of decision this is.** It is the founder **accepting a risk**, not a publisher's grant.

- Three of the sources have a publisher grant on record (**CLEARED WITH ATTRIBUTION**: `nyc-dob-permit-issuance`,
  `nyc-dobnow-approved-permits`, `seattle-building-permits`, in the documents named in section 2). They carry the credit line that
  publisher requires. The other 237 have **no** recorded grant.
- No classification in the rights audit or in any per-source document is edited by this ruling. A HOLD stays a HOLD finding. This does not
  reinterpret any HOLD as cleared; it puts the sources on the list **despite** the HOLD, on the founder's decision. R4 stays on record as the
  rule that governed from 2026-09-30 until this ruling.

## 2. Sources covered

Every one of these is `cleared_on` 2026-10-04 with `audit_ref` this section. The block is generated; do not edit it by hand.

<!-- BEGIN GENERATED SOURCES (scripts/build-report-rights.mjs) -->

`240` sources, `supabase/functions/_shared/report-rights.json` version 2, cleared on 2026-10-04. Fingerprint: md5 of the ids joined with "," in code-point order = `32af7ab5a9f963a562e9af19eab246bf`.

- `adams-county-building-permits`
- `adot-tip-fy2026-2030`
- `akdot-stip-24-27`
- `albuquerque-building-permits`
- `aldot-atrip-ii-projects`
- `aldot-rebuild-alabama-grant-projects`
- `allegheny-county-asbestos-permits`
- `allentown-energov-building-permits`
- `anaheim-land-use-cases`
- `ann-arbor-energov-permits`
- `anne-arundel-commercial-site-plans`
- `anne-arundel-subdivision-activity`
- `ar-ardot-job-status-lines`
- `ar-ardot-job-status-points`
- `arlington-issued-permits`
- `arlington-permit-applications`
- `arlington-planning-cases`
- `asheville-accela-permits`
- `aurora-building-permits`
- `austin-issued-construction-permits`
- `austin-site-plan-cases`
- `austin-subdivision-cases`
- `austin-zoning-cases`
- `baltimore-city-housing-permits`
- `baltimore-county-permits`
- `bellevue-permits`
- `bend-or-permit-applications`
- `bentonville-catalyst-permits`
- `bismarck-building-permits`
- `boone-county-ky-planning-board-actions`
- `boston-approved-building-permits`
- `boulder-construction-permits`
- `bozeman-building-permits`
- `brunswick-county-permits`
- `buffalo-building-permits`
- `burlington-vt-building-permits`
- `burlington-vt-zoning-permits`
- `butler-county-ks-permits`
- `cabarrus-county-plan-reviews`
- `caltrans-sb1-projects`
- `cambridge-building-permits-addition-alteration`
- `cambridge-building-permits-new-construction`
- `cambridge-demolition-permits`
- `canyon-county-building-permits`
- `casa-grande-active-development-sites`
- `centre-county-pa-building-permits`
- `champaign-il-special-use-permits`
- `charleston-county-permits`
- `charlotte-land-dev-commercial-projects`
- `chattanooga-building-permits`
- `chattanooga-permits-archive`
- `chester-county-pa-act247-plans`
- `chicago-building-permits`
- `cincinnati-building-permits`
- `city-of-orange-active-planning-projects`
- `clark-county-active-dev-permits`
- `clark-county-active-projects`
- `clarksville-montgomery-final-subdivisions`
- `clarksville-montgomery-preliminary-subdivisions`
- `cleveland-issued-building-permits`
- `clv-planning-cases`
- `coconino-county-permits`
- `colorado-springs-planning-applications`
- `columbia-mo-capital-projects`
- `columbia-mo-permits`
- `columbus-building-permits`
- `cook-county-il-highway-construction-program`
- `ctdot-project-work-areas`
- `dallas-specific-use-permits`
- `dekalb-county-building-permits`
- `delaware-county-pa-subdivisions-land-developments`
- `denton-county-dev-permits`
- `denver-commercial-construction-permits`
- `denver-residential-construction-permits`
- `desoto-county-permits`
- `detroit-building-permits`
- `detroit-demolition-permits`
- `detroit-trades-permits`
- `durham-building-permits`
- `east-baton-rouge-building-permits`
- `el-paso-new-residential-permits`
- `fairfax-active-site-construction`
- `fairfax-recent-building-permits`
- `fdot-active-construction-projects`
- `flathead-county-building-permits`
- `forsyth-county-ga-building-permits`
- `fort-collins-building-permits`
- `fort-worth-development-permits`
- `fort-worth-zoning-cases`
- `frisco-active-building-permits`
- `georgia-dot-gpas-projects`
- `gilbert-energov-permits`
- `harris-county-permits`
- `harris-county-plats`
- `hartford-building-permits`
- `hdot-active-design-projects`
- `henderson-commercial-permits`
- `henderson-residential-permits`
- `houston-plat-applications`
- `huntsville-building-permits`
- `idot-annual-program-bridges`
- `idot-annual-program-construction`
- `independence-twp-construction-permits`
- `indot-spms-active-projects`
- `iowa-dot-bid-projects`
- `iowa-dot-bid-projects-lines`
- `iowa-dot-five-year-program`
- `irving-development-permits`
- `itd-itip-projects`
- `itd-itip-projects-lines`
- `jackson-county-or-building-permits`
- `jackson-county-or-land-use-permits`
- `johns-creek-building-permits`
- `kcmo-building-permits`
- `kcmo-development-cases`
- `kdot-wincpms-project-locations`
- `kent-county-de-building-permits`
- `kenton-county-devtracking-permits`
- `knoxville-building-permits`
- `kytc-syp-highway-plan`
- `lake-county-il-construction-program`
- `lee-county-fl-development-orders`
- `lexington-row-permits`
- `lincoln-residential-new-construction-permits`
- `little-rock-permits`
- `loudoun-county-residential-permits`
- `louisville-active-construction-permits`
- `madison-planning-projects`
- `maine-dot-public-projects`
- `maine-dot-public-projects-lines`
- `marin-county-building-permits`
- `massdot-highway-projects`
- `mdot-sha-project-portal`
- `mdot-stip-projects`
- `memphis-dpd-building-permits`
- `mesa-building-permits`
- `miami-building-permits`
- `minneapolis-ccs-permits`
- `missoula-addresses-with-permits`
- `mndot-chip-roadway-projects`
- `mndot-stip-roadway-projects`
- `modot-stip-locations-accepted`
- `montgomery-county-commercial-permits`
- `montgomery-county-demolition-permits`
- `montgomery-county-pa-act247-proposals`
- `montgomery-county-residential-permits`
- `mt-mdt-stip-lines`
- `murfreesboro-building-permits`
- `naperville-building-permits`
- `nashville-building-permits-issued`
- `ncdot-stip-projects-lines`
- `ncdot-stip-projects-points`
- `nddot-special-road-fund-projects`
- `ndot-program-book-points`
- `ndot-program-book-segments`
- `new-castle-county-permits`
- `new-hanover-county-building-permits`
- `new-orleans-permits`
- `nhdot-ten-year-plan-projects`
- `nj-stip-projects`
- `nvdot-project-boundaries`
- `nyc-dob-permit-issuance` — a publisher credit is required and carried: "New York City Department of Buildings, via NYC Open Data (dataset ipu4-2q9a). HomeSignal selected and renamed fields." (docs/corporate-output-nyc-dob-permits-2026-09-27.md)
- `nyc-dobnow-approved-permits` — a publisher credit is required and carried: "New York City Department of Buildings, via NYC Open Data (dataset rbx6-tga4). HomeSignal selected and renamed fields." (docs/corporate-output-nyc-dob-permits-2026-09-27.md)
- `nysdot-capital-program-projects`
- `nysdot-capital-program-projects-2`
- `nysdot-capital-program-projects-3`
- `odot-current-projects`
- `odot-current-projects-lines`
- `okdot-workplan-roadways`
- `oregon-dot-stip-projects`
- `oregon-dot-stip-projects-lines`
- `overland-park-building-permits`
- `penndot-transportation-projects`
- `peoria-az-building-permits`
- `philadelphia-li-permits`
- `phoenix-building-permits`
- `pierce-county-pals-permits`
- `pittsburgh-pli-permits`
- `portland-building-permits`
- `prince-georges-county-permits`
- `provo-planning-applications`
- `raleigh-building-permits`
- `reno-ldc-projects`
- `ridot-rhode-restore-projects`
- `round-rock-large-development-projects`
- `salem-structure-permits`
- `san-antonio-permits-issued`
- `san-antonio-prelim-plan-review`
- `san-diego-approved-permits`
- `san-jose-permits`
- `san-marcos-planning-cases`
- `savannah-commercial-building-permits`
- `scdot-project-viewer-lines`
- `scottsdale-building-permits`
- `sd-stip-construction-reconstruction`
- `sd-stip-pavement-preservation`
- `sd-stip-railroad-crossings`
- `sd-stip-resurfacing`
- `sd-stip-safety-lines`
- `sd-stip-safety-points`
- `sd-stip-structures`
- `seattle-building-permits` — a publisher credit is required and carried: "City of Seattle, Seattle Department of Construction & Inspections (data.seattle.gov, dataset 76t5-zqzr)." (docs/corporate-output-seattle-building-permits-2026-09-27.md)
- `seattle-land-use-permits`
- `shelby-county-building-permits`
- `sheridan-county-building-permits`
- `sioux-falls-building-permits`
- `slc-planning-petitions`
- `slo-county-planning-permits`
- `sonoma-county-fire-rebuild-permits`
- `spokane-county-building-planning-permits`
- `stamford-major-developments`
- `stlouis-county-mo-subdivisions`
- `summit-county-oh-planning-commission-items`
- `sussex-county-de-conditional-use`
- `tacoma-accela-permits`
- `tempe-building-permits`
- `tennessee-dot-projects`
- `thurston-county-residential-permits`
- `topeka-building-permits`
- `tucson-commercial-building-permits`
- `tucson-residential-building-permits`
- `txdot-projects-info-all`
- `udot-active-projects`
- `udot-active-projects-lines`
- `vdot-syip-approved-projects`
- `vdot-syip-approved-projects-lines`
- `virginia-beach-building-permits`
- `vtrans-project-locations`
- `vtrans-project-locations-lines`
- `wake-county-building-permits`
- `weld-county-site-plan-review`
- `wisdot-highway-program-6yr`
- `worcester-building-permits`
- `wsdot-project-delivery-plan-complete`
- `wsdot-project-delivery-plan-proposed`
- `wsdot-project-delivery-plan-under-construction`
- `wvdoh-active-projects`
- `wydot-stip-projects`
- `wydot-stip-projects-lines`
- `york-county-pa-planning-subdivisions`

<!-- END GENERATED SOURCES -->

## 3. What this does not do

- **It does not make every ZIP show records.** Of the 12,722 canonical ZIPs, 8,215 have at least one development record anywhere in
  HomeSignal's data (section 5). The other 4,507 correctly keep saying "No data ingested", because for them that is true. And a report covers
  half a mile around the address: a ZIP that has records can still have an address with none within that distance. A completed (operating)
  record also appears only if it has an official event in the recent window (R3, the "standing inventory" rule), so some of the records a map
  shows are still not in a report.
- **It clears only registry sources.** Not EPA or other facility records (the report is development only), not the 5 development rows that
  carry no registry id, not scores, outlooks or predictions (the audit EXCLUDEs them), not Local News, meetings or government notices.
- **It does not clear the property-placement inputs.** A report still places the typed address with the Census geocoder and judges ZIP
  membership with Census ZCTA polygons. The audit records their terms as not established (HOLD). This ruling accepts that risk only because
  the report cannot be made without them; it does not change their classification.
- **It does not change the Terms of Use.** `privacy.html` still says HomeSignal is for a visitor's own personal, non-commercial purpose;
  replacing it with a commercial licence is for counsel (`docs/development-activity-paid-continuation-2026-10-01.md`, item 3).
- **It does not open billing.** Checkout stays closed; nothing here is a public offer.

## 4. How to undo it

Set `cleared` back to `[]` in `supabase/functions/_shared/report-rights.json` (revert the commit that adds this file), then redeploy the three
functions that import that file: `get-development-activity-report`, `follow-development-report` and `run-property-watch`. New reports then
return "No data ingested" again. **Reports already stored are permanent snapshots and are not recalled**; the daily property-watch check reads
the list at the time it runs, so it follows the list in both directions.

## 5. Measured when this was written (read-only, production, 2026-10-04)

- `public.canonical_zip_registry`: **12,722** ZIPs. `geo.n5_serving_membership`: **913,120** rows, all `record_kind = 'development'`; **8,215**
  of the 12,722 ZIPs have at least one.
- `public.app_projects`, `record_kind = 'development'`: **231** groups by `registry_id`, which are **230** registry sources plus **5** rows
  with no registry id (**2,911,123** rows in all). The registry file holds **240** ids (md5 of the sorted ids `32af7ab5a9f963a562e9af19eab246bf`,
  checked in the database against the same array); 10 of them have no development rows today.
- `20 N Main St, Brigham City, UT 84302`: `n5_projects_within_radius` at the point, half a mile, returns **9** rows, all
  `udot-active-projects-lines`, record kind development; the map for the same address reports "9 canonical projects within ½ mile".
