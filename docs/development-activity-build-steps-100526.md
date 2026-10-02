# Development Activity — build steps to finish the report (living checklist)

Plan: `docs/development-activity-plan-100526.md` (the founder's upload, saved unchanged, sha256
`82491934c1b2ff3d8f5e2f34753fe69f6e1f35603b1b7bce09f914c61a230e22`). Status of the earlier orders (A–P):
`docs/development-activity-status-2026-09-30.md`.

**How to read it.** ~~Struck through~~ = the step is done: merged to `main`, and deployed where the step has
something to deploy. A step is never struck on the strength of a branch, a draft pull request or a dry run.
Each step is one pull request. The founder approved this order on 2026-10-02 ("start step 1 ... do a strike
through once each step is complete").

## Part A — the report itself

1. ~~**Save the 100526 plan in Git.**~~ It is the plan the remaining build follows; the 2026-09-30 plan stays
   as a dated record. *(Done in the pull request that adds this file.)*
2. ~~**Report engine: fixed 0.5-mile radius, the Permitted / Under Construction rule, and map positions.**~~
   *(Done: #1569 merged as `d453d5b`; `get-development-activity-report` deployed from `main` by run
   `37040242758`, version 3 → 4 at 2026-10-02 17:22Z. All 10 deployed files read back byte-identical to
   `main`, JWT check still on, and an unsigned call returns 401.)*
   - Radius: 0.5 mile is the default and the only radius a report uses (plan ruling 7). Today the engine
     defaults to 1 mile and also accepts 2 and 5.
   - Permitted / Under Construction: a project goes there only when the publisher's own stage says a permit
     was issued or construction is under way. Words seen in a 3% sample of production records on 2026-10-02:
     "Issued", "Permit Issued", "Under Construction", "Construction", "Construction Started". Not counted:
     plans ("Construction Work Program", "Design and Construct") and finished work ("CO Issued"). The list is
     written down and versioned; a stage the list does not name stays in Approved / Coming.
   - Map positions: distance and direction from the property, in the response only and never stored (they
     would locate the client's address).
   - The deployed `get-development-activity-report` function is redeployed.
3. ~~**Report layout in the plan's order.**~~ Header (address, slot for brokerage and agent); What Changed /
   Recent Official Activity; Type and Stage filters; Development Activity Map (a plain diagram: property in
   the centre, a 0.5-mile ring, shaped markers, no street map because no basemap is cleared); Things to
   Review With Your Client (the nearest projects, with the plan's review wording); Approved / Coming;
   Proposed / Under Review; Permitted / Under Construction; Change History; Official Evidence & Coverage;
   action bar (Compare, Watch, Share, PDF marked "coming soon" until Part B). Checked at phone width.
   *(Done: #1575 merged as `a48f380`. Nothing to deploy on its own: no page loaded the view until step 4.
   The action bar says "Available soon", because "coming" is kept for the Approved / Coming stage.
   Tests: behaviour 148, structure 59, browser 47; 144 of 144 prohibited mutations caught.)*
4. ~~**Private review page for the founder.**~~ Signed in, type any address, see the full report. First check:
   20 N Main St, Brigham City, UT 84302.
   *(Done: #1576 merged as `5ba0643`; Pages run `37045997546` deployed it at 2026-10-02 18:18Z. Read back from
   homesignal.net at 18:19Z, each byte-identical to `main` by md5: the page `095ce855…`, noindex; `robots.txt`
   `b84f0e80…`, with its Disallow line; and `lib/da-report-view.js?v=dbfe52f9` `41b1eeb8…`. The browser's
   preflight is not a risk: production logs show the gateway passing browser `OPTIONS` to another
   JWT-checked function (`geocode-address`, 9 of 9 answered 200 in 24 hours), and the report function allows
   the headers the page sends. Not yet done: a real signed-in report. Only the founder can sign in.)*
   - Page: `development-activity-review.html` (admin only: noindex, disallowed in robots.txt, linked from
     nowhere, not in the sitemap). Sign-in by emailed code; it never creates an account.
   - It calls `get-development-activity-report` with the signed-in user's own token. The function still
     refuses anyone not on `dashboard_admins` (one admin today, the founder).
   - A choice between every record (internal) and what a paying customer sees today.
   - Client label, brokerage and agent can be typed to preview the header; they stay on the page.
   - The single-generation-path test now admits exactly this page for the report engine, and pins that it
     stays an operator tool (P5).

## Part B — the customer page

5. **Free trial sign-up.** Invite link, sign-in, 20 shared reports, "reports remaining". The 20-report limit
   is already enforced in the database (Order L1, applied 2026-10-02).
   *Founder decision first:* does a report with limited coverage use up a free report? (ruling R5)
6. **Saved reports.** Each report gets a permanent ID; reopening, sharing or printing never uses another report.
7. **Brokerage and agent header**, filled from the account (brokerage name, agent name, optional client label).
8. **Share and PDF.** Private read-only link for the client that the agent can revoke; PDF through the
   browser's print. *Founder decisions first:* how long a share link lasts; whether the client sees the
   street address.
9. **Watch.** Daily check of the property; email to the agent when a nearby project's official status changes.
10. **Compare.** Two to five addresses side by side, same report rules.
11. **$79/month checkout** on the existing Lemon Squeezy connection: 100 reports a month, Billing tab.
    *Founder action:* create the $79 product in Lemon Squeezy and make one test payment.

## Part C — before the buttons go live

12. **Source permissions.** No source is cleared for paying customers yet, so a customer report shows no
    projects. *Founder action:* send the drafted Utah requests (UDOT, Salt Lake City, Provo;
    `docs/corporate-output-utah-clearance-2026-10-02.md`). Each source is added to
    `supabase/functions/_shared/report-rights.json` as its answer arrives.
13. **End-to-end launch test, then the Enterprise page buttons go live.** A test brokerage runs sign-up,
    20 reports, the end of the trial, payment and a 100-report month.

## Founder actions, and when

| When | What |
|---|---|
| After step 4 | Review the layout with 84302 |
| Before step 5 | Does a limited-coverage report use up a free report? |
| Before step 8 | How long share links last; whether the client sees the address |
| Step 11 | Create the Lemon Squeezy product and make one test payment |
| Any time, needed by step 12 | Send the Utah permission requests |
