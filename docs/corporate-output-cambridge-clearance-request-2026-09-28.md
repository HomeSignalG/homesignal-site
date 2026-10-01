# Cambridge, MA — drafted clearance request (2026-09-28)

**Status: DRAFTED, NOT SENT. Nothing in this file changes any classification.**

Cambridge remains **HOLD — TERMS/RIGHTS NOT ESTABLISHED**
(`docs/corporate-output-cambridge-pilot-attempt-2026-09-28.md`). New York City V1 remains
the only assemblable market. The overall verdict remains **NOT YET**. Signed paid pilots
remain **0**. The audit blob remains `c2cc94524ee2d21af47520254703d4a222344c66`.

## Why this file exists

The Cambridge HOLD does not rest on missing data or on a refusal. It rests on the City
publishing two statements that contradict each other: five Socrata views labelled PDDL,
which permits commercial use, and a site-wide disclaimer headed **"Commercial Use
Prohibited"** that bans reselling or republishing any portion of the site's contents for
commercial use "without the prior written consent of the City of Cambridge."

The disclaimer names the thing that would resolve it: prior written consent. So the HOLD
has an exit, and the exit is a document from the City — not a re-reading of the documents
already fetched, and not a second implementation that reaches the same data by another
route.

Drafting the request is work an agent can do. Sending it is not.

## What I cannot do, stated plainly

I cannot send this. I have no authority to enter into or solicit a licence on HomeSignal's
behalf, no mailbox that reaches the City as HomeSignal, and no standing to represent what
the company will agree to. Nothing in this repository should be read as a request having
been made.

Two failure modes this file is written to prevent:

1. **Treating a drafted request as a pending one.** A draft sitting in Git is not
   outreach. Cambridge has not been asked. If someone later reports Cambridge as "awaiting
   the City's response," that statement is false unless a separate record says the request
   was sent, by whom, on what date, and to which address.
2. **Treating silence as permission.** If this is sent and the City does not reply, the
   classification stays **HOLD**. Non-response is not consent, and the disclaimer asks for
   consent to be *prior* and *written*. A grant can only arrive as an evidence record
   beside the canonical audit, quoting what the City actually granted.

## What would close the HOLD

An evidence record in `docs/` that contains all of:

- The identity of the person at the City who issued the response, and their role.
- The date, and the channel it arrived on.
- The verbatim text of the grant, not a summary of it.
- What it covers: which datasets, whether redistribution of derived records is included,
  whether it is scoped to a term or revocable, and any attribution the City requires.
- A note reconciling it against the disclaimer — specifically whether the City is waiving
  the "Commercial Use Prohibited" clause for these datasets or asserting the clause never
  applied to the open-data portal.

Anything less and the two statements are still unreconciled, which is the actual condition
of the HOLD.

Note the scope gap even if consent arrives: the GIS data dictionary that states PDDL covers
`ADDRESS_AddressPoints` and `ADDRESS_MasterAddressBlocks` only. For the Master Addresses
List `vup6-kpwv` and the three Inspectional Services permit tables, the PDDL claim rests on
the Socrata licence field alone. A consent letter that names only the GIS layers would not
clear the permit tables, and the permit tables are the record the report is for.

The data-quality question recorded in the pilot file would also still be open: the permit
tables publish two coordinate pairs that disagree by miles on recent rows, and which one
the publisher treats as the job site is not established. That is not part of the rights
question and must not be presented as though clearing the rights settled it.

---

## Draft — for a human to review, address, and decide whether to send

> **Subject:** Written consent request — commercial use of City of Cambridge open datasets
>
> To the City of Cambridge Open Data Program,
>
> I am writing to request prior written consent under the "Commercial Use Prohibited"
> clause of the City's website disclaimer (`https://www.cambridgema.gov/disclaimer`), for a
> defined commercial use of five datasets the City publishes on `data.cambridgema.gov`.
>
> **The datasets**
>
> - `vup6-kpwv` — Master Addresses List
> - `4ftb-8ne5` — Cambridge Address Points
> - `9qm7-wbdc` — Building Permits: New Construction
> - `qu2z-8suj` — Building Permits: Addition/Alteration
> - `kcfi-ackv` — Demolition Permits
>
> **The conflict I am asking you to resolve**
>
> All five views carry a Socrata licence object naming the Open Data Commons Public Domain
> Dedication and License v1.0 (`licenseId: PDDL`), whose text states that recipients may
> use the work commercially. The City's GIS data dictionary pages for
> `ADDRESS_AddressPoints` and `ADDRESS_MasterAddressBlocks` repeat that PDDL dedication.
>
> The City's site-wide disclaimer, which by its own terms covers documents and data
> accessible on or through the City's website, states under "Commercial Use Prohibited"
> that no user may resell, republish, print, download or copy any portion of the contents
> for commercial use without the City's prior written consent.
>
> I could not find a City document that reconciles these. `data.cambridgema.gov/terms`
> returns HTTP 404, and the Open Data Program pages do not address licensing, commercial
> use, or attribution. Rather than choose the reading that favours me, I am asking the
> City which statement governs.
>
> **The use I am asking about, stated exactly**
>
> HomeSignal would sell a single-property report to a prospective homebuyer. For one
> address, the report would:
>
> - match the buyer's typed address to one record in the City's address data and show the
>   matched record's identifier and published coordinates;
> - list the City's building and demolition permit records whose published coordinates
>   fall within a stated radius of that address and whose permit date falls within a
>   stated recent window;
> - for each listed record, show the fields the City publishes — permit type, status,
>   date, street address, coordinates, and the City's own record identifier — and link
>   back to the dataset on `data.cambridgema.gov`;
> - credit the City as the source of each dataset, name the dataset version retrieved, and
>   describe the modifications made, which are limited to selecting columns, filtering by
>   distance and date, and sorting.
>
> The report would not assign scores, ratings, rankings, or predictions to any property or
> permit, and would not represent the City as endorsing it. It would not redistribute the
> datasets in bulk, offer them for download, or present itself as an authoritative copy of
> the City's records; every record would be shown as a pointer back to the City's own.
>
> **What I am asking for**
>
> Written confirmation of one of the following:
>
> 1. The PDDL dedication governs these five datasets, and the "Commercial Use Prohibited"
>    clause does not apply to data published on the open data portal; or
> 2. The City grants prior written consent for the use described above, on whatever terms
>    and attribution the City requires; or
> 3. The City does not consent — in which case I would appreciate knowing whether that
>    applies to all five datasets or only some, so the position is recorded accurately.
>
> A clear "no" is a useful answer and I would rather have it than proceed on an assumption.
> Until I hear from you, HomeSignal is treating these datasets as not cleared for
> commercial use and is not building on them.
>
> If another office is the right recipient, I would be grateful for a pointer.
>
> Thank you for your time.
>
> *[Sender name, role, contact details, and date to be completed by the sender.]*

---

## Scope

This file adds no clearance. Cambridge stays **HOLD — TERMS/RIGHTS NOT ESTABLISHED** and no
Cambridge dataset is loaded, cached, or added to any allowlist. Do not start or sell a paid
report on Cambridge inputs.
