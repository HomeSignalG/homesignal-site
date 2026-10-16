# HomeSignal Engineering Project Charter

**Version:** 1.0
**Status:** Governing Document
**Applies To:** Every engineering session, investigation, recommendation, implementation, and deployment.

> Source of record: `docs/HomeSignal-Engineering-Project-Charter.docx` (original, founder-authored).
> This markdown is a faithful transcript for in-session reading. If the two ever disagree, the `.docx` wins — flag it and ask.

---

## Mission

Populate every existing HomeSignal ZIP page with the maximum amount of legitimate, first-party development information available while preserving data integrity and geographic accuracy.

The objective is to launch the highest-quality nationwide ZIP-level development intelligence platform.

## Current Scope

The production inventory consists of **12,722 existing ZIP pages**.

- This inventory is fixed for the current launch phase.
- The objective is to maximize the completeness of these existing pages.
- **Expanding the modeled ZIP inventory is outside the scope of this phase unless explicitly approved.**

## Primary Success Metric

The only primary success metric is:

> Previously development-empty existing ZIP pages that now display verified first-party development markers.

Every engineering decision should be evaluated against this metric.

## Secondary Success Metrics

- Verified development records added
- First-party sources integrated
- Data quality
- Geographic accuracy
- System stability
- Maintainability
- Engineering efficiency

## Explicit Non-Goals

The following are **not** measures of success during this phase:

- Number of counties completed
- Number of states completed
- Number of reports written
- Number of candidate services discovered
- Number of repositories changed
- Number of connectors written
- Number of new ZIP pages created

These activities are valuable only if they increase populated existing ZIP pages.

## Engineering Priority Order

### P0 — Never fabricate

Never fabricate:

- addresses
- ZIPs
- coordinates
- dates
- titles
- project names
- statuses
- record URLs
- jurisdictions
- ownership
- source freshness

Missing evidence must always be reported.

### P1 — Populate existing ZIP pages

Every recommendation should maximize the number of existing development-empty ZIP pages that become legitimately populated.

### P2 — Prefer reusable engineering

When two approaches provide similar data quality: prefer the reusable solution that unlocks the greatest number of existing ZIP pages. Examples:

- reusable connectors
- reusable parsers
- reusable ArcGIS enhancements

Avoid repeating identical engineering work.

### P3 — Preserve ZIP integrity

ZIP pages represent developments legitimately relevant to that ZIP. Do not increase page counts by:

- expanding geographic scope
- reducing geographic precision
- relaxing routing rules

Coverage metrics must never improve at the expense of relevance.

### P4 — Improve existing pages

After increasing coverage, improve:

- freshness
- completeness
- metadata quality
- record URLs
- routing
- marker quality

### P5 — Geographic expansion

Only after explicit approval. Examples:

- new ZIP pages
- new modeled counties
- new communities
- international support

Expansion is never automatic.

## Required Decision Process

Before beginning any engineering work, answer:

### Objective Check

Current objective:

> Populate the existing 12,722 ZIP pages.

Does this work directly increase populated existing ZIP pages? **YES / NO**

If NO:

- Stop.
- Explain why the work is outside the objective.
- Wait for approval.

## Recommendation Format

Every recommendation must include:

### Problem
What limits ZIP coverage?

### Proposed work
Exactly what engineering will be performed?

### Expected benefit
Estimated additional populated ZIP pages.

### Evidence
Evidence supporting the estimate.

### Confidence
High / Medium / Low.

### Risks
Any impact to:

- accuracy
- relevance
- performance
- maintainability

## Approval Required Before

Do not proceed automatically with:

- creating new ZIP pages
- changing the modeled ZIP inventory
- changing routing philosophy
- broadening geographic radius
- changing what qualifies for a ZIP page
- lowering evidence standards
- changing primary project objectives
- introducing heuristics that reduce accuracy

## Source Acceptance Rules

Every source must satisfy:

- first-party government ownership or authoritative publication
- legitimate development, permit, planning, or construction records
- sufficient freshness
- deterministic ZIP assignment
- usable titles
- usable dates
- understandable statuses
- resolving record URLs
- coordinates or deterministic geocoding
- no fabricated values

## Work Ordering

Always rank work by: **newly populated existing ZIP pages per engineering week.**

Not by:

- county completion
- state completion
- engineering elegance
- research interest

## Progress Reports

Every completed batch must report:

| County | Source | Gate Result | ZIPs Added | Records Added | Production Verified |
|---|---|---|---|---|---|

Also report:

- Current populated ZIP pages
- Current development markers
- Regression status
- Known blockers
- Next highest-value engineering task

## Drift Prevention

If a proposed task improves any lower-priority objective while delaying a higher-priority objective:

- Reject the task.
- Explain why it conflicts with this charter.
- Request approval before proceeding.

## Definition of Done

This launch phase is complete when:

- The existing 12,722 ZIP pages contain the maximum legitimate first-party development information practically obtainable.
- Remaining gaps are documented as having no viable public source or requiring future platform expansion.
- Production data quality, routing, and integrity meet HomeSignal standards.

Until then, engineering effort should remain focused on increasing legitimate coverage of the existing ZIP inventory.
