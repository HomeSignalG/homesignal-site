# DRAFT — Option B: request to TCEQ for air-permit data (NOT SENT — for your review)

Status: draft only. It is not sent, and I will not send it. Recipient and delivery route are yours to choose (the TCEQ public-information / air-permits contact, or a public information request through TCEQ's published process). No manual outreach is implied by drafting.

---

**Subject:** Request for a data export (or a documented feed) of Texas air New Source Review permit and registration records

To the TCEQ Air Permits Division / Public Information Office:

HomeSignal publishes public-records maps and reports of development and environmental filings near Texas addresses. Each item we show links to the agency's own public record. We would like to include TCEQ's air-permit records and ask whether TCEQ can provide them in a form we may use with automated tools.

**Records requested.** Air New Source Review permit and registration records, including **standard permits and standard-permit registrations** (for example registration 185303, project 414660, received September 2026), permits by rule where recorded, new permits, amendments, modifications and renewals, and their status. We ask for all counties, or at minimum the Texas Gulf Coast and border counties first.

**Fields requested, per record:**
- permit number, registration number and project number (all identifiers the record carries)
- regulated entity number (RN) and customer reference number (CN), and the regulated entity (facility) name
- applicant / customer name as it appears on the public record
- action type (application, registration, proposed action, issuance, amendment, modification, renewal) and permit or authorization type
- status, with the dates for each action: received, administratively complete, technical review, public notice, comment deadline, action or issuance, effective and expiration
- county
- facility location: street address and, where TCEQ holds them, latitude and longitude, parcel or site-boundary information, and the datum
- the URL of the public record, and of each public document (application, technical review, final action)

**Delivery.** We ask how updates could be delivered: a downloadable file on a published schedule, an open-data dataset, a feed or API, or a recurring export. We would use the delivery on a regular, low-volume schedule and identify ourselves.

**Terms.** Please tell us the terms of use and any attribution you require, whether automated retrieval of TCEQ's Records Online documents is permitted and by which route, and whether the robots.txt restrictions on the NSR project list and Central Registry query pages are intended to bar program access. We will follow whatever route and limits you give us, and we will not access pages that disallow automated access.

**Contact:** [your name / contact details — to be supplied by you]

Thank you for considering this request.

---

Notes for your review (not part of the request):
- Fields in the request match what the SQL expects (`permit_no`, `project_no`, `facility_ref` = RN, `action_kind`, `status`, dates, `county`, location, `record_url`). If TCEQ can supply only some, the ingest records what it receives and states what is missing; it never fills a gap.
- If a file arrives without coordinates or boundaries, the permit is listed as "no mapped location" until a verified location source exists; it is never placed from a city or ZIP.
- This asks for data, not for permission to bypass any restriction.
