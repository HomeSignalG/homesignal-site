# Development Activity report: audit fixes (2026-10-07)

Source: the competitor-CTO audit of 2026-10-07 (trust and accuracy, security, engineering and usability).
Founder instruction: "do them all step by step ... cross off as each step is completed."
Each pull request is squash-merged after CI is green. Steps 3 to 7 (report wording and content) ship together in one pull request, and steps 8 to 11 (page safety) in another, because each pull request takes about 20 minutes of checks. A struck-through step is done and has a receipt.

## Steps I can do in code

1. [x] ~~**Decided is its own label.** A denied or withdrawn application stops reading as "Proposed / Under Review". It gets its own plain label and a warning, in the table, the briefing and the card.~~ DONE (merged as #1702): badge, card warning, review prompt, briefing and "On the record" counts, and the comparison table (its own row) all treat it separately. 224 view checks, 75 compare checks, 291 browser checks pass; reverting the fix fails 6.
2. [x] ~~**Every record shows its filing date, and old ones are flagged.** The engine carries the date and its meaning; the page shows it on the record and says when it is more than a year old.~~ DONE (merged as #1703): the engine carries `record_date`; the card, the review list and the briefing show it; dates before 1990, future dates and plans are never shown.
3. [x] ~~**A coverage line on every report.** It says which kinds of agency records this report drew from and says plainly that other agencies were not checked. "No approved or proposed records" no longer reads as "nothing is planned".~~ DONE (merged as #1704).
4. [x] ~~**Address-match check is word-aware.** `742 Evergreen` no longer matches `1742 Evergreen`.~~ DONE (merged as #1704).
5. [x] ~~**Records with no stage no longer vanish.** They are listed under a visible "Stage not stated" group.~~ DONE (merged as #1704).
6. [x] ~~**Wording honesty.** "Official agency status" becomes what it is (the status HomeSignal recorded). The distance and direction text and the "mapped point" claim are corrected. A fair-housing and no-prediction line is added next to the briefing.~~ DONE (merged as #1704).
7. [x] ~~**Dates in the compare table.** "Report as of" says it is the UTC day. "Limits: None stated" says coverage was not measured.~~ DONE (merged as #1704).
8. [x] ~~**Page safety fixes.** Client link page gets a timeout; sign-in "different email" becomes a real button, Escape closes the dialog; a report that arrives after sign-out is not shown; supabase-js is pinned to an exact version.~~ DONE except the pin (this pull request): the client page gives up after 20 seconds with its "could not load" message; "Use a different email" is a real button; Escape closes the sign-in and Tab stays inside it; a report that arrives after the person signed out (or another signed in) is dropped before anything is shown. **NOT DONE: the supabase-js pin.** This sandbox cannot reach the CDN, so I cannot confirm an exact version exists or get its integrity hash, and a guessed version could break sign-in on all 19 pages that load `@2`. It needs a runner or you: see "Needs you" F.
9. [x] ~~**Logging on the report and billing paths** (fixed text only, never an address).~~ DONE (this pull request): the report, billing-webhook and manage-billing functions write one line per request: function name, status number, milliseconds, and "threw". Nothing from the request or the answer can reach it (25 checks; deleting the name clean-up fails 2).
10. [x] ~~**Mutation tests run in CI** when the report files change.~~ DONE (this pull request): new check `da-report-mutants` runs the four mutation loops (view 153, compare 64, customer page 42, review page 22) when a report file changes, no schedule. **Finding:** 35 of the 300 mutations no longer matched the code (the loops had rotted unnoticed), so they were not testing anything; all 35 are re-anchored and every mutation is now killed.
11. [x] ~~**Admin and trial gates refuse an unconfirmed email.**~~ CODE DONE (this pull request): the gate refuses a person whose email the auth service does not report as confirmed, before the allow-list or a trial is asked (12 checks; removing it fails 3). Not exploitable today (Confirm email is off but all 28 accounts are confirmed). **The edge-function deploy waits for your go**: until it is deployed, production behaves as before.

## Needs you (not mine to do in code)

- A. Supabase: is "confirm email" required for sign-up? (Settings, Authentication.) Decides whether the admin-email finding is real.
- B. The "240 sources cleared" registry against the build-steps doc and ruling R7. A legal call.
- C. Health-monitor checks and a kill switch for the report and billing paths: these live in the ingest repo and the database, so they need your go.
- D. Owner removes an agent / withdraws invites; rate limit on the share-link endpoint; one open checkout at a time: each needs a database change, so they need your go.
- F. Pin supabase-js to an exact version (step 8). Needs a runner that can reach the CDN to read the version and its hash; I can set that up as a one-time workflow when you say go.
- E. Real payments (Lemon Squeezy is in test mode).
