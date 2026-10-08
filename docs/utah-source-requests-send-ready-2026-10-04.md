# Utah source requests — send-ready pack (2026-10-04)

**Status: DRAFTED, NOT SENT. This file clears nothing and changes no classification.** `supabase/functions/_shared/report-rights.json` stays
`"cleared": []`. Every source below stays **HOLD — TERMS/RIGHTS NOT ESTABLISHED**. No one has been asked for anything. Sending is a human
act: I have no mailbox that reaches these offices as HomeSignal and no standing to represent what the company will agree to.

This pack **replaces the request body in** `docs/corporate-output-utah-clearance-2026-10-02.md` §4 (kept as the dated record). That body was
written before saved reports, client links, Watch, Compare and the subscription existed; sent as it stood, it would have under-described the
use, and a request that misdescribes the use is worse than none.

## 1. What changed since the 2026-10-02 draft

The draft described the report and a saved copy, with sharing marked "confirm". All of this is now merged and live, so each is stated in the new body:

| In the new body | Built in | Was in the 2026-10-02 draft? |
|---|---|---|
| Records within **half a mile**, shown with type, status, stage, latest event date, distance and direction, and a link | step 2 | partly ("a stated radius") |
| A permanent saved copy the customer can reopen | step 6 | yes |
| A **private client link** (six months, withdrawable) and **PDF** by browser print | step 8 | "confirm" |
| **Watch**: a daily re-check that **emails** the customer when a nearby record's status changes (no address in the email) | step 9 | **no** |
| **Compare**: two to five saved reports side by side | step 10 | **no** |
| Sold **by subscription**: $79 a month for 100 new reports, after 20 free | step 11 | **no** |

Also corrected: the 2026-10-02 Provo block cited `https://www.provo.gov/174/Projects-and-Planning`; that address now answers **404** (read 2026-10-04). It is
dropped. The service address, which answers, is kept.

## 2. What was re-read on 2026-10-04 (through the database's HTTP extension; the sandbox has no outbound access)

Requests `net._http_response` ids **34209–34217**, all answered; the publishers' posted wording is **unchanged** from 2026-10-02.

| Source | Posted rights wording, re-read | Item last modified |
|---|---|---|
| UDOT All Projects (`ff0d0dbb…`) | "This data is for informational purposes and must be field verified prior to being used on a project. UDOT makes no warranty with respect to the accuracy, completeness or usefulness of this content … Please contact the UDOT GIS Department at udotgis@utah.gov for more information." | 2026-06-04 |
| Salt Lake City Planning Petition (`74e8ab25…`) | "Open Data" (access information: "Salt Lake City Central GIS") | 2024-10-02 |
| Provo CurrentProjects MapServer (`serviceItemId` `6e051d8f…`) | `copyrightText` empty; description "Current projects for planning and building permits" | — |

**Still HOLD for all three.** A disclaimer, a two-word label and silence grant nothing. The site-wide terms pages of the three publishers were **not**
read (still UNVERIFIED, carried from 2026-10-02): a permissive statement there could change the picture.

Utah development rows the report would draw on, same query as 2026-10-02 (`record_kind = 'development'`, ZIPs 84001–84791):

| `registry_id` | rows | ZIP pages |
|---|---:|---:|
| `udot-active-projects-lines` | 8,842 | 282 |
| `udot-active-projects` | 823 | 97 |
| `slc-planning-petitions` | 570 | 12 |
| `provo-planning-applications` | 191 | 4 |

Total 10,426 development rows; **UDOT is 9,665 (92.7%)**. Controls: 310 Utah ZIP pages in `canonical_zip_registry` for that range; 13,455 `app_projects` rows of
all kinds across 292 ZIP pages. (2026-10-02: 10,419 development rows, UDOT 9,658.) One answer from UDOT would unlock most of Utah; a Utah report would then be mostly
road projects, which is a product question for the founder, not decided here.

**Who to send to.**

- **UDOT:** `udotgis@utah.gov`. It is printed in the dataset's own license text (above), so it is the publisher's own instruction, not a guess.
- **Salt Lake City:** **not found.** The open-data page (62,518 bytes fetched) shows no contact address or number in its HTML. The page may be built by script, so this means
  "not found by me", not "none exists". No address is invented here.
- **Provo:** **not found for planning data.** The only contact on the city's site that I read is its **general line, (801) 852-6000**, on `provo.gov/180/Contact-Us`. That is the
  switchboard, not a Development Services contact. No address is invented here.

## 3. What you do — one action at a time

1. **Read one body** (section 4) once. Confirm the points in section 5 are still true. If one is not, tell me and I change it before anything is sent.
2. **UDOT.** Open a new email to the address in the first code block. Paste the subject and then the body. Fill the four bracketed lines at the bottom, and send.
3. **Salt Lake City.** Find the right person first: ask Salt Lake City's Central GIS (the page's publisher) who answers for the Planning Petition dataset. When you have an
   address, use the Salt Lake City subject and body.
4. **Provo.** Call (801) 852-6000 and ask who answers for the Planning Application data in Development Services. When you have an address, use the Provo subject and body.
5. **Tell me each time you send one, and the date.** I record it as *sent on that date to that person*, never as pending before that. When an answer arrives, paste it to me,
   word for word. I will fill `docs/source-clearance-evidence-template.md` from it and add the registry line only if the answer is a grant. A refusal, or no answer, adds nothing.

```
udotgis@utah.gov
```

## 4.1 UDOT — subject and body

To: udotgis@utah.gov

Subject:

```
Written confirmation request — commercial use of UDOT project data (All Projects feature service)
```

Body:

```
Dear UDOT GIS Department,

I am writing to ask whether, and on what terms, HomeSignal may use the following in a report that we sell: UDOT's All Projects feature service, both layers (layer 0, points, and layer 1, lines), item ff0d0dbb65344331ace85118ae993d0e on ArcGIS Online, the data behind https://data-uplan.opendata.arcgis.com/datasets/udot-projects-points.

WHAT THE DATA SAYS ABOUT ITS OWN USE

The dataset's license text says the data "is for informational purposes and must be field verified prior to being used on a project," disclaims warranty, and asks questions to be sent to udotgis@utah.gov. It does not say whether commercial use or redistribution is permitted. Rather than assume a reading that favours us, I am asking.

THE USE, STATED EXACTLY

HomeSignal sells property-level development reports to real-estate brokerages and their agents, by subscription ($79 a month for 100 new reports, after 20 free trial reports). For one address, the report would:

1. List your published project records located within half a mile of that address. For each it shows the project name; the type, status and stage as you publish them; the date of your latest event for it; a category and a stage that HomeSignal assigns from your own words (a project is placed in "Permitted / Under Construction" only when your stage says a permit was issued or construction is under way); its distance and direction from the address; and a link to your own dataset or record, with your agency credited as the source.
2. Be saved as a permanent record of that report, so the customer can reopen it later exactly as it was issued.
3. Be shared by the customer with its own client: by a private, read-only link that lasts six months and that the customer can withdraw at any time, or by printing or saving a PDF through the browser. The client needs no account and sees the report, including your records as listed in point 1.
4. Be set to "Watch" by the customer: once a day HomeSignal checks your published records near that address again and emails the customer when the status of a nearby record has changed since the report. The email lists each change in your own words with a link to your record. It does not contain the address.
5. Be compared by the customer, side by side with two to four of its other saved reports. Nothing new is retrieved for a comparison.

To do this, HomeSignal retrieves your dataset on a recurring schedule and keeps a history of what you published and when, so that a later report can state what changed. THAT HISTORY IS KEPT PERMANENTLY.

The report would not assign scores, ratings or predictions to a property or a project, would not state or imply your endorsement, would not offer your dataset for bulk download, and would not present itself as an authoritative copy of your records. Every record is a pointer back to yours.

WHAT I AM ASKING FOR

Written confirmation of one of the following:

1. The data is published for general reuse, including commercial use and storage of the records in a delivered report, on stated terms and attribution; or
2. You grant written consent for the use described above, on whatever terms and attribution you require; or
3. You do not consent. A clear no is a useful answer, and I would also like to know whether it applies to all of the datasets named or only some.

If your answer covers only part of the use above (for example, the report but not the daily Watch, or the report but not the permanent history), please say which part.

Please name both layers in your answer: a consent that names only the points layer would not cover the lines.

Until I hear from you, HomeSignal is treating this data as not cleared for commercial use and is not selling reports that contain it.

If another office is the right recipient, I would be grateful for a pointer.

[Your name]
[Your role]
HomeSignal
[Your email and phone]
[Date]
```

## 4.2 Salt Lake City — subject and body

To: (recipient to be found, see step 3)

Subject:

```
Written confirmation request — commercial use of Salt Lake City planning petition data
```

Body:

```
Dear Salt Lake City Central GIS,

I am writing to ask whether, and on what terms, HomeSignal may use the following in a report that we sell: the Planning Petition feature service, item 74e8ab2506e444d2ac38109fa5fb868d, published by Salt Lake City Central GIS and listed on https://gis-slcgov.opendata.arcgis.com/.

WHAT THE DATA SAYS ABOUT ITS OWN USE

The dataset's license field reads only "Open Data," with no terms text or link. Rather than assume a reading that favours us, I am asking.

THE USE, STATED EXACTLY

HomeSignal sells property-level development reports to real-estate brokerages and their agents, by subscription ($79 a month for 100 new reports, after 20 free trial reports). For one address, the report would:

1. List your published project records located within half a mile of that address. For each it shows the project name; the type, status and stage as you publish them; the date of your latest event for it; a category and a stage that HomeSignal assigns from your own words (a project is placed in "Permitted / Under Construction" only when your stage says a permit was issued or construction is under way); its distance and direction from the address; and a link to your own dataset or record, with your agency credited as the source.
2. Be saved as a permanent record of that report, so the customer can reopen it later exactly as it was issued.
3. Be shared by the customer with its own client: by a private, read-only link that lasts six months and that the customer can withdraw at any time, or by printing or saving a PDF through the browser. The client needs no account and sees the report, including your records as listed in point 1.
4. Be set to "Watch" by the customer: once a day HomeSignal checks your published records near that address again and emails the customer when the status of a nearby record has changed since the report. The email lists each change in your own words with a link to your record. It does not contain the address.
5. Be compared by the customer, side by side with two to four of its other saved reports. Nothing new is retrieved for a comparison.

To do this, HomeSignal retrieves your dataset on a recurring schedule and keeps a history of what you published and when, so that a later report can state what changed. THAT HISTORY IS KEPT PERMANENTLY.

The report would not assign scores, ratings or predictions to a property or a project, would not state or imply your endorsement, would not offer your dataset for bulk download, and would not present itself as an authoritative copy of your records. Every record is a pointer back to yours.

WHAT I AM ASKING FOR

Written confirmation of one of the following:

1. The data is published for general reuse, including commercial use and storage of the records in a delivered report, on stated terms and attribution; or
2. You grant written consent for the use described above, on whatever terms and attribution you require; or
3. You do not consent. A clear no is a useful answer, and I would also like to know whether it applies to all of the datasets named or only some.

If your answer covers only part of the use above (for example, the report but not the daily Watch, or the report but not the permanent history), please say which part.

Until I hear from you, HomeSignal is treating this data as not cleared for commercial use and is not selling reports that contain it.

If another office is the right recipient, I would be grateful for a pointer.

[Your name]
[Your role]
HomeSignal
[Your email and phone]
[Date]
```

## 4.3 Provo — subject and body

To: (recipient to be found, see step 4)

Subject:

```
Written confirmation request — commercial use of Provo planning application data
```

Body:

```
Dear Provo Development Services,

I am writing to ask whether, and on what terms, HomeSignal may use the following in a report that we sell: the CurrentProjects map service, layer 0 "Planning Application", at https://gispublicweb.provo.gov/ArcGIS/rest/services/DevServ/CurrentProjects/MapServer.

WHAT THE DATA SAYS ABOUT ITS OWN USE

The service publishes no license or copyright statement. Rather than assume a reading that favours us, I am asking.

THE USE, STATED EXACTLY

HomeSignal sells property-level development reports to real-estate brokerages and their agents, by subscription ($79 a month for 100 new reports, after 20 free trial reports). For one address, the report would:

1. List your published project records located within half a mile of that address. For each it shows the project name; the type, status and stage as you publish them; the date of your latest event for it; a category and a stage that HomeSignal assigns from your own words (a project is placed in "Permitted / Under Construction" only when your stage says a permit was issued or construction is under way); its distance and direction from the address; and a link to your own dataset or record, with your agency credited as the source.
2. Be saved as a permanent record of that report, so the customer can reopen it later exactly as it was issued.
3. Be shared by the customer with its own client: by a private, read-only link that lasts six months and that the customer can withdraw at any time, or by printing or saving a PDF through the browser. The client needs no account and sees the report, including your records as listed in point 1.
4. Be set to "Watch" by the customer: once a day HomeSignal checks your published records near that address again and emails the customer when the status of a nearby record has changed since the report. The email lists each change in your own words with a link to your record. It does not contain the address.
5. Be compared by the customer, side by side with two to four of its other saved reports. Nothing new is retrieved for a comparison.

To do this, HomeSignal retrieves your dataset on a recurring schedule and keeps a history of what you published and when, so that a later report can state what changed. THAT HISTORY IS KEPT PERMANENTLY.

The report would not assign scores, ratings or predictions to a property or a project, would not state or imply your endorsement, would not offer your dataset for bulk download, and would not present itself as an authoritative copy of your records. Every record is a pointer back to yours.

WHAT I AM ASKING FOR

Written confirmation of one of the following:

1. The data is published for general reuse, including commercial use and storage of the records in a delivered report, on stated terms and attribution; or
2. You grant written consent for the use described above, on whatever terms and attribution you require; or
3. You do not consent. A clear no is a useful answer, and I would also like to know whether it applies to all of the datasets named or only some.

If your answer covers only part of the use above (for example, the report but not the daily Watch, or the report but not the permanent history), please say which part.

Until I hear from you, HomeSignal is treating this data as not cleared for commercial use and is not selling reports that contain it.

If another office is the right recipient, I would be grateful for a pointer.

[Your name]
[Your role]
HomeSignal
[Your email and phone]
[Date]
```

## 5. Check these before sending (a request that misdescribes the use is worse than none)

- The customers are brokerages and their agents; the price is $79 a month for 100 new reports after 20 free ones (plan ruling 8; the checkout is built but its product does not exist yet).
- The radius is half a mile and is the only one used.
- A client link lasts six months, is read-only, needs no account, and the agent can withdraw it.
- Watch emails the customer once a day when a nearby record's status has changed; the email names the changes in the publisher's words with a link and carries no address.
- The report assigns no score, rating or prediction. (It shows a "Things to Review With Your Client" prompt per project; that is wording, not a score. Confirm that is how you describe it.)
- HomeSignal keeps the history of what each publisher posted permanently (the company's standing rule for development history).
- Nothing is offered for bulk download.

## 6. What this pack does not do, and did not check

- It does not send, and it does not say any request is pending.
- Two of the three recipients are unknown. None is invented.
- The publishers' site-wide terms pages, and the State of Utah's disclaimer as it applies to UDOT, were not read.
- The EPA facility rows (about 3,000 in Utah) and EPA's terms are a separate question.
- Whether a report that is 93% road projects is the product wanted for the first Utah customers.
- Lawyer-review items in the audit's §12 are not addressed here; on the evidence they do not touch these three sources, but that is a reading, not a review.

## 7. When an answer comes

`test/report-rights-evidence.test.mjs` will refuse a registry entry that is not backed by a filled-in evidence record. The change that adds the first entry also edits the structure pin
`test/national-report-structure.test.mjs` 6a ("no source family is cleared") so the decision is visible twice, and it switches on charging and storing real reports; the private-context contract
(`docs/report-private-context-contract-2026-09-30.md` §6) is re-read first.
