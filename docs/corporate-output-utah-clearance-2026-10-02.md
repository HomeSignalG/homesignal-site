# Utah first launch — what the report draws on, what the publishers say, and drafted requests (2026-10-02)

**Status: DRAFTED, NOT SENT. This file clears nothing and changes no classification.** The audit verdict
(`docs/corporate-output-source-rights-audit-2026-09-27.md`) stays **NOT YET**. `supabase/functions/_shared/report-rights.json`
stays `"cleared": []`. Every source below stays **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. Nothing in this repository should be read
as a request having been made: **no one has been asked for anything.** Sending is a human act (see "What I cannot do").

## 1. Founder scope ruling (2026-10-02)

The founder said Utah launches first, and that **the Utah report is development only, not government notices, upcoming meetings
or local news.** Consequences, stated so they are not re-derived:

- The Utah public-notice feed, the meetings and notices vendors and Local News are **not gates for the Utah launch.** They stay HOLD
  for any other use, and this file does not touch them.
- The report engine reads `public.app_projects` (and the change-ledger views), not `meetings`, `alerts` or `app_changes`
  (`supabase/functions/get-development-activity-report`, `_shared/national-report.ts`, `_shared/change-reads.ts`; relations named
  in them: `app_projects`, `dev_change_event_reportable`, `dev_change_project`, `dev_change_source_health`,
  `dev_change_source_fetch_health`). So the sources that matter for a Utah report are exactly the ones in `app_projects`.

## 2. What a Utah report would draw on today (production, read-only, 2026-10-02 16:03Z)

```sql
select coalesce(registry_id,'(none)') as registry_id, record_kind, count(*) as rows, count(distinct zip) as zips
from public.app_projects where zip >= '84001' and zip <= '84791' group by 1,2 order by rows desc;
```

| `registry_id` | kind | rows | ZIP pages |
|---|---|---:|---:|
| `udot-active-projects-lines` | development | 8,830 | 282 |
| `udot-active-projects` | development | 828 | 97 |
| `slc-planning-petitions` | development | 570 | 12 |
| `provo-planning-applications` | development | 191 | 4 |
| EPA facility registry ids (each its own `registry_id`) | facility | the rest | — |

Controls (same date): 310 Utah ZIP pages in `canonical_zip_registry` for that range; **13,445** `app_projects` rows across **292** ZIP
pages in that range; the registry file has **240** entries in total (parsed with a control after a first parse returned 11, which
was wrong and was discarded), of which exactly these four cover Utah. 8,830 + 828 + 570 + 191 = **10,419** development rows;
13,445 − 10,419 = 3,026 other rows, which in the part of the list read (the top 30 groups) are all EPA facility rows. The remainder
was not itemised.

- **UDOT is 9,658 of the 10,419 development rows (92.7%)** and reaches most Utah ZIP pages. One consent from UDOT would unlock most of
  Utah. **Product consequence, not decided here:** a Utah report would then be mostly road projects.
- Salt Lake City covers 12 ZIP pages and Provo 4 (761 rows between them).
- The facility rows are EPA-registered facilities. The audit holds EPA FRS / ECHO on the strength of ECHO's own "informational
  purposes only" and "not designed for large scale data transfers" text. **That is a separate question, not addressed in this file.**
- The Utah data-centre pins on Map 1 (Compute Atlas, Epoch AI, OpenStreetMap) are in a different plane and are not in
  `app_projects`, so they are not in this report today.

## 3. What each publisher's own record says (read through the database's HTTP extension, 2026-10-02)

The sandbox has no outbound access, so the six requests were fired from the database with `net.http_get` (ids **22692–22697**), all
public ArcGIS REST endpoints, all answered **HTTP 200**. Control: the item ids found by search equal the `serviceItemId` each
service reports itself (`ff0d0dbb65344331ace85118ae993d0e` for UDOT, `74e8ab2506e444d2ac38109fa5fb868d` for Salt Lake City).

| Registry entry | Item / service | Posted rights wording (verbatim) | What it is |
|---|---|---|---|
| `udot-active-projects`, `udot-active-projects-lines` | ArcGIS item "All Projects" (`ff0d0dbb…`, owner `UDOT_Admin`, public); `copyrightText` empty | `licenseInfo`: "This data is for informational purposes and must be field verified prior to being used on a project. UDOT makes no warranty with respect to the accuracy, completeness or usefulness of this content or consequential damages resulting from the use or misuse of the content or any of the information contained herein. Please contact the UDOT GIS Department at udotgis@utah.gov for more information." | A warranty disclaimer plus a contact. **It grants nothing and prohibits nothing.** Both registry entries are layers 0 and 1 of the same item. |
| `slc-planning-petitions` | ArcGIS item "Planning Petition" (`74e8ab25…`, owner `slcgis_slcgov`, public); `copyrightText` and `accessInformation` "Salt Lake City Central GIS" | `licenseInfo`: "Open Data" | **A label, not a license text.** No terms wording and no URL in the item. Not a recorded commercial-use grant. |
| `provo-planning-applications` | ArcGIS Server MapServer "CurrentProjects" (`serviceItemId` `6e051d8f…`); `copyrightText` empty; description "Current projects for planning and building permits" | none found in the service or layer metadata | **Silent.** Empty publisher terms are not permission (audit Appendix A, NDDOT standing answer). |

**Classification after this lookup: unchanged, all four HOLD.** What was *not* read and is therefore UNVERIFIED: each publisher's
site-wide terms (the UDOT UPlan hub, the Salt Lake City open-data portal, provo.gov) and the State of Utah disclaimer as it applies
to UDOT. A permissive statement there could change the picture; its absence in the item metadata does not.

The useful finding is practical: **UDOT's own record names who to ask, `udotgis@utah.gov`.** Neither Salt Lake City's nor Provo's
record names a contact, and none is invented here.

## 4. Drafted requests — for a human to review, address, and decide whether to send

One body, with the dataset block swapped per publisher. The modifications and uses below were taken from how the report is built;
**the sender must confirm the bracketed items are still true before sending**, because a request that misdescribes the use is worse
than none.

> **Subject:** Written confirmation request — commercial use of [PUBLISHER] project data
>
> To [UDOT GIS Department, udotgis@utah.gov (the contact named in the dataset's own license text) / Salt Lake City Central GIS
> (recipient to be found) / Provo, Development Services (recipient to be found)],
>
> I am writing to ask whether, and on what terms, HomeSignal may use [DATASET BLOCK] in a report that we sell.
>
> **What the data says about its own use**
>
> [UDOT: The dataset's license text says the data "is for informational purposes and must be field verified prior to being used on
> a project," disclaims warranty, and asks questions to be sent to udotgis@utah.gov. It does not say whether commercial use or
> redistribution is permitted.]
> [SLC: The dataset's license field reads only "Open Data," with no terms text or link.]
> [Provo: The service publishes no license or copyright statement.]
> Rather than assume a reading that favours us, I am asking.
>
> **The use, stated exactly**
>
> HomeSignal would sell a property-level development report to real-estate professionals. For one address the report would:
>
> - list your published project records located within a stated radius of that address, showing for each the project name, the
>   publisher's date, the status as you publish it, a category and a lifecycle stage that HomeSignal assigns, and a link to your
>   own dataset or record, with your agency credited as the source;
> - be saved as a permanent record of that report so the customer can reopen it later, [and be shared by the customer with its
>   own client by a link, print or PDF — confirm];
> - be accompanied by a recurring retrieval of your dataset, so that HomeSignal keeps a history of what you published and when,
>   and a later report can state what changed. **That history is kept permanently.**
>
> The report would not assign scores, ratings or predictions to a property or a project, would not state or imply your
> endorsement, would not offer your dataset for bulk download, and would not present itself as an authoritative copy of your
> records. Every record is a pointer back to yours.
>
> **What I am asking for**
>
> Written confirmation of one of the following:
>
> 1. The data is published for general reuse, including commercial use and storage of the records in a delivered report, on
>    stated terms and attribution; or
> 2. You grant written consent for the use described above, on whatever terms and attribution you require; or
> 3. You do not consent. A clear no is a useful answer, and I would also like to know whether it applies to all of the datasets
>    named or only some.
>
> Until I hear from you, HomeSignal is treating this data as not cleared for commercial use and is not selling reports that
> contain it.
>
> If another office is the right recipient, I would be grateful for a pointer.
>
> *[Sender name, role, contact details and date to be completed by the sender.]*

**Dataset blocks**

- **UDOT:** "UDOT's All Projects feature service (points and lines), item `ff0d0dbb65344331ace85118ae993d0e` on ArcGIS Online, the data behind
  `https://data-uplan.opendata.arcgis.com/datasets/udot-projects-points`." Name both layers in the answer; a consent that names only
  the points layer would not cover the lines, which are 8,830 of the rows.
- **Salt Lake City:** "the Planning Petition feature service, item `74e8ab2506e444d2ac38109fa5fb868d`, published by Salt Lake City Central
  GIS, listed on `https://gis-slcgov.opendata.arcgis.com/`."
- **Provo:** "the CurrentProjects map service, layer 0 'Planning Application', at
  `https://gispublicweb.provo.gov/ArcGIS/rest/services/DevServ/CurrentProjects/MapServer`, described on
  `https://www.provo.gov/174/Projects-and-Planning`."

## 5. What would close each HOLD

An evidence record in `docs/` containing all of: the name and role of the person who answered; the date and the channel; the verbatim
grant, not a summary; what it covers (which datasets, whether storing records in a delivered report and keeping a history are
included, any term or revocation right, any attribution wording required); and, where the publisher's own pages say something
different, a note reconciling the two. **Silence is not consent, and a drafted request is not a pending one.**

The line that would then be added to `supabase/functions/_shared/report-rights.json`, one per `registry_id`, never a wildcard:

```json
{ "registry_id": "udot-active-projects-lines", "cleared_on": "YYYY-MM-DD", "audit_ref": "docs/<the evidence record>.md §N", "attribution": "<the credit line the publisher requires>" }
```

## 6. What I cannot do

I cannot send these. I have no authority to request or accept a license on HomeSignal's behalf, no mailbox that reaches these
offices as HomeSignal, and no standing to represent what the company will agree to. Two failure modes this file is written to prevent:
reporting a request as pending that was never sent, and treating a non-answer as permission.

## 7. Not done, and not checked

- The EPA facility rows (3,026 other rows) and the question of EPA's terms. Separate review.
- The three publishers' site-wide terms pages (section 3).
- Who at Salt Lake City and Provo is the right recipient.
- Whether a report that is mostly road projects is the product the founder wants for the first Utah customers.
- Whether the lawyer-review items in the audit's §12 (OpenStreetMap, the mix of open-data licenses) matter for a Utah report that
  contains none of those sources. On the evidence here they do not, but that is a reading, not a review.
