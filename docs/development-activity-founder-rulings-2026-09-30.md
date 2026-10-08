# Development Activity — founder rulings, 2026-09-30 (Maps workbook reconciliation)

Dated record. It is not edited afterwards. It governs together with
`docs/development-activity-plan-2026-09-30.md` (frozen, sha256 `66257cc7…955c`).
Where this record and the frozen plan disagree, **this record wins** and the plan
text is left as written (a frozen plan is never edited; the disagreement is named here).

> **Provenance.** These are the founder's rulings as given in the session. The Maps
> workbook rows they cite (Instructions rows 489, 497, 592, 593, 619) were **not read in
> this session**; the row numbers are the founder's own citations and are recorded as
> stated, not re-verified. The repo facts cited below were read from Git and are
> marked with file and line.

## R1 — Regulatory is an overlay, never a Type

Regulatory is an OVERLAY / independent membership dimension. It is NEVER a Canonical
Development Type. The later 0087 granular diagnostic contract controls:

- Instructions row 592 — Regulatory Membership is NOT Canonical Type and NOT Canonical Lifecycle.
- Instructions row 593 — Regulatory Status stays separate from Canonical Type, Canonical
  Lifecycle and Regulatory Membership.
- Instructions row 619 — Canonical Type, Canonical Lifecycle and Regulatory Membership
  are independent dimensions.

Older workbook rows 489/497 that describe "Regulated facility" as a legend Type are
retained historical text. They do not override the later contract or current production.

Current Git agrees: `lib/project-type.js` `canonicalProjectType()` excludes `isFacility`
and treats facility identity as a record kind, not a Type (also `CLAUDE.md` §7.1, §7.11a).

**Do not create a Regulatory Development Type in the Development Activity report.**
Regulatory may appear as a separate overlay/signal where appropriate.

*Plan text this overrides:* Dimension A, "Regulated Facility where applicable"
(plan line 827).

## R2 — Canonical Lifecycle is exactly four keys

`proposed` · `approved` · `operating` · `unknown`.

Do not add `permitted`, `under_review`, `under_construction`, `denied`, `withdrawn`,
`completed`, or any other lifecycle key.

More specific publisher statuses and events may be shown to the customer but stay
separate from Canonical Lifecycle:

- "Under Review" — a publisher status shown within a proposed record.
- "Permit Issued" — a publisher event/status shown with an approved record.
- "Under Construction" — stated only when source evidence explicitly supports it; it
  does not create a fifth lifecycle value.

*Plan text this overrides:* Dimension B tiers (plan lines 845–878) are read as display
groupings over the four keys, never as lifecycle keys. The change-event vocabulary in
Step 3A (`denied`, `withdrawn`, `completed`, …) stays valid: those are **events**, not
lifecycle values.

## R3 — "What Exists Today" is removed from Phase 1

Phase 1 is development/change intelligence, not an inventory of existing places.
The current Development Activity plan governs the customer report layout.
Do not restore "What Exists Today".

*Plan text this overrides:* "EXISTS TODAY" (plan lines 847–848).

## R4 — Rights come from the source-rights audit, not the workbook

The Maps workbook is NOT the authority for paid-commercial source rights. Use the
existing audit (`docs/corporate-output-source-rights-audit-2026-09-27.md`). A HOLD is
never reinterpreted as cleared. This is a separate source/content gate and does not
change the national 12,722-ZIP product architecture.

## R5 — "Insufficient quality" has no commercial threshold yet

The workbook defines the technical health vocabulary — HEALTHY, STALE, ERROR,
VERIFIED ZERO, UNKNOWN, N/A, PAUSED — and Zero Proof Eligibility. It does **not** define
whether an evaluation report consumes one of the 20 report credits. That threshold must
not be invented.

**REMAINING FOUNDER / PRODUCT DECISION (open):** the commercial rule for when a report
of insufficient quality does or does not consume an evaluation credit.
(Already fixed by the 2026-09-29 scope correction and unchanged: an unsupported ZIP,
an unresolved address and a failed generation never consume a credit.)

## R6 — Legacy NYC page; product name and eyebrow

NYC V1 is legacy implementation/history and must not define the new product. Do not
architect Development Activity around NYC. Do not delete or rename the legacy technical
route yet unless the new national implementation requires it.

The new customer-facing product name and eyebrow are:

**HOMESIGNAL DEVELOPMENT ACTIVITY**

Target architecture: ADDRESS → resolve address → canonical 12,722-ZIP eligibility →
existing HomeSignal development data → Development Activity report.

*Sequencing note (not a change of the ruling).* The legacy page's eyebrow currently reads
`HOMESIGNAL DEVELOPMENT ACTIVITY · NEW YORK CITY` (`future-surroundings-report.html:42`).
The ruled eyebrow is applied when the page is served by the national path (plan Order G/I).
Changing only the text now would state a national product on a page whose engine answers
NYC addresses only.
