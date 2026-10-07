# Development Activity report: audit fixes (2026-10-07)

Source: the competitor-CTO audit of 2026-10-07 (trust and accuracy, security, engineering and usability).
Founder instruction: "do them all step by step ... cross off as each step is completed."
Each step is one small change, squash-merged after CI is green. A struck-through step is done and has a receipt.

## Steps I can do in code

1. [x] ~~**Decided is its own label.** A denied or withdrawn application stops reading as "Proposed / Under Review". It gets its own plain label and a warning, in the table, the briefing and the card.~~ DONE (merged as #1702): badge, card warning, review prompt, briefing and "On the record" counts, and the comparison table (its own row) all treat it separately. 224 view checks, 75 compare checks, 291 browser checks pass; reverting the fix fails 6.
2. [ ] **Every record shows its filing date, and old ones are flagged.** The engine carries the date and its meaning; the page shows it on the record and says when it is more than a year old.
3. [ ] **A coverage line on every report.** It says which kinds of agency records this report drew from and says plainly that other agencies were not checked. "No approved or proposed records" no longer reads as "nothing is planned".
4. [ ] **Address-match check is word-aware.** `742 Evergreen` no longer matches `1742 Evergreen`.
5. [ ] **Records with no stage no longer vanish.** They are listed under a visible "Stage not stated" group.
6. [ ] **Wording honesty.** "Official agency status" becomes what it is (the status HomeSignal recorded). The distance and direction text and the "mapped point" claim are corrected. A fair-housing and no-prediction line is added next to the briefing.
7. [ ] **Dates in the compare table.** "Report as of" says it is the UTC day. "Limits: None stated" says coverage was not measured.
8. [ ] **Page safety fixes.** Client link page gets a timeout; sign-in "different email" becomes a real button, Escape closes the dialog; a report that arrives after sign-out is not shown; supabase-js is pinned to an exact version.
9. [ ] **Logging on the report and billing paths** (fixed text only, never an address).
10. [ ] **Mutation tests run in CI** when the report files change.

## Needs you (not mine to do in code)

- A. Supabase: is "confirm email" required for sign-up? (Settings, Authentication.) Decides whether the admin-email finding is real.
- B. The "240 sources cleared" registry against the build-steps doc and ruling R7. A legal call.
- C. Health-monitor checks and a kill switch for the report and billing paths: these live in the ingest repo and the database, so they need your go.
- D. Owner removes an agent / withdraws invites; rate limit on the share-link endpoint; one open checkout at a time: each needs a database change, so they need your go.
- E. Real payments (Lemon Squeezy is in test mode).
