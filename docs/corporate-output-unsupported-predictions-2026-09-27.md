# Unsupported prediction claims — Step 3 (2026-09-27)

This removes unsupported prediction claims from any report that would be sold. It does not remove them from the consumer site. Audit §12 item 7 said those fields stay on the consumer site and must not enter a corporate template. There is still no corporate template. This file is that template rule.

The paid Future Surroundings Report was not started. No product or runtime file changes.

Measured on `homesignal-site` `d1c5a1edf1d1685cd50fbe43ef18031256cb7697`.

Canonical audit blob `docs/corporate-output-source-rights-audit-2026-09-27.md` is `c2cc94524ee2d21af47520254703d4a222344c66` on this SHA.

NYC V1 allowlist: `docs/corporate-output-nyc-pilot-assembly-2026-09-27.md`.

## Decision

| Claim family | What it is today | Consumer site | Sold Future Surroundings Report |
|---|---|---|---|
| Property `score`, `score_trend`, `HS.tpl.scoreRing` | Display number with no method in Git | Stays | **EXCLUDE** |
| `value_outlook` | Seeded percent, painted as a 12-month value forecast | Stays | **EXCLUDE** |
| `insurance_outlook` and the `"Stable"` default | Empty field rendered as an insurance fact | Stays | **EXCLUDE** |
| Quality of Life Impact Score™ / `impact_score` / High·Medium·Low | Status constant presented as a score (`Proposed≈72`, `Approved≈55`, `Operating≈45`, facility≈30) | Stays | **EXCLUDE** |
| `HS.projectImpact` | Heuristic sentences: "may feel", "could see", "If approved", "possible lift" | Stays | **EXCLUDE** |
| Stored `sowhat` narratives | Seed and pipeline interpretive copy | Stays | **EXCLUDE** |
| "Effect at this address" / "How it impacts you" / "What it means for you" | Labels that turn a line into an effect | Stay | **EXCLUDE** |
| `impact_dimensions` chips as effects | Heuristic pressure / amenity labels | Stay | **EXCLUDE** |
| Ingest `Scorer._plain` sentences | Templated "adds pressure on…", "with a lift to…" | Stay where they already render | **EXCLUDE** |
| Community `community_score` averaged from `component_scores` | Defined average; component method not established | Stays | **EXCLUDE** |
| Engineering, traffic, utility-capacity, insurance-loss, and property-value forecasts | Unsupported predictions named in the product freeze | Stay where already written | **EXCLUDE** |

Nothing in this table is **CLEARED FOR PAID REPORT**. `get-address-report` is not a sold report. `reports.html` still generates nothing.

## Where the claims sit

Measured on this SHA. These files are the consumer site. They were not edited.

| Location | Claim |
|---|---|
| `property.html` | `"Effect at this address"` on `pr.sowhat`; vitals paint `score` / `score_trend`, `value_outlook`, and `insurance_outlook\|\|'Stable'` |
| `properties.html` | `value_outlook` percent on the list card |
| `lib/templates.js` | `Quality of Life Impact Score™`; `"How it impacts you:"` when `sowhat_factual` is false; `HS.projectImpact`; `scoreRing` |
| `lib/impact.js` | `HS.projectImpact` future-tense branches; `impactRating` High / Medium / Low over the status constant |
| `lib/community-page.js` | `"How it impacts you:"` / `"On the record:"`; `"Value outlook · 12 mo"` |
| `lib/data.js` `community()` | `community_score` as the mean of `component_scores[].pct` |
| `development.html` | QoL brand copy; sort by `impact_score`; `sowhat` / verdict lines |
| `alerts.html` | `"Your value outlook, next 12 mo"` from `value_trend` |
| `seed/delvalle.js` | Demo `value_outlook`, `insurance_outlook:'Stable'`, narrative `sowhat`, `impact_score` |
| `docs/homesignalphase1_13.html` | Retired prototype. Not a shipped report. |

`test/fix9-ownership-language.test.mjs` pins `"Effect at this address"` on `property.html`. `test/impact.test.mjs` pins the QoL brand and `HS.projectImpact`. Those pins keep the consumer copy. They are not a commercial grant.

## What is not a sold report

`reports.html` is the Premium waitlist. It says reports are coming soon. It does not generate, preview, or sell a report. Its explainer, "nearby changes that may affect the property," is waitlist marketing. It is not rewritten here. Changing that sentence is a product-copy change, not Step 3.

`get-address-report` success JSON has no `sowhat`, `value_outlook`, `insurance_outlook`, `impact_score`, or `"Effect at this address"` field. Its `note` still ends `"Not for resale."` That payload stays out of the allowlist.

No file in this tree is a corporate Future Surroundings Report template.

## What a sold NYC V1 report may say

Only the NYC V1 allowlist, plus HomeSignal-authored investigation text that does not forecast an effect:

- The buyer-supplied address and ZIP.
- The matching AddressPoint record, with attribution.
- DOB issuance and DOB NOW publisher fields whose mapped coordinates are present, copied as the publisher wrote them (type, status, dates, address, job / filing number, ZIP).
- HomeSignal distance, pin, and "near this property" from AddressPoint and those publisher coordinates.
- A prompt to open the official record and investigate. That prompt does not say the work will change traffic, utilities, insurance, or value.
- Source, version, and modification notices.
- A list of what this report excludes.

A deterministic join of allowlisted publisher fields (type, status, applicant as published) may be labeled **"On the record."** It may not be labeled **"Effect at this address"**, **"How it impacts you"**, or **"What it means for you."** Today's `factualSowhat` joins `app_projects` fields that are HOLD. That function is not the sold-report line.

## What a sold report may not say

- Any row in the Decision table.
- That a permit will, may, or could change daily life, traffic, water, power, noise, tax base, insurance, or property value.
- A score, outlook, trend, or High / Medium / Low impact rating.
- `HS.projectImpact` or ingest `Scorer._plain` prose.
- A `"Stable"` insurance default.
- `get-address-report` as a payload, cache, or embed.

HomeSignal may identify a condition that warrants investigation. It may not predict the outcome of that investigation.

## Step 3 status

The Step 3 close condition was: unsupported prediction claims cannot enter a report that would be sold.

That condition is met. The claims are listed. They are **EXCLUDE** from any sold Future Surroundings Report, including NYC V1. They remain on the consumer site. No corporate template emits them.

Step 4 (build the report from the NYC V1 allowlist) has not started. The overall commercial verdict remains **NOT YET**.
