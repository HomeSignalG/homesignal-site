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
   **Answered 2026-10-02** (`docs/development-activity-founder-ruling-r5-2026-10-02.md`): a report that shows
   development, or that proves **"No development activity"**, uses one free report; a report that is empty
   because of **"No data ingested"** does not. Until HomeSignal can prove "No development activity" for an
   address, an empty report is "No data ingested" and is free.
   Four pull requests:
   - ~~**5a. The outcome and the one credit rule.**~~ *(Done: #1579 merged as `ba59f16`.*
     - *`get-development-activity-report` was deployed from `main` by run `37051044339`: version 4 → 5 at
       2026-10-02 18:58Z. All 11 deployed files read back byte-identical to `main`, and the JWT check is still on.*
     - *Live probe 19:00Z: the capability answer names `credit-rule-1`. A call with no token, and a call with only
       the public key, are both refused with 401.*
     - *Pages run `37051040628` deployed the page and view at 19:02Z. Read back from homesignal.net, each is
       byte-identical to `main` by md5: the review page `34259cff…` (noindex), and `lib/da-report-view.js?v=2cb756ec`
       `7c04d9a7…`.)*
     - The report engine names every report's outcome: "No development activity" vs "No data ingested" (`report.activity`).
     - One versioned function (`_shared/credit-rule.ts`) says whether a report uses a free report.
     - An empty report says "No data ingested" in plain words.
     - The review page shows the founder whether a customer would be charged.
     - Nothing is charged yet.
   - ~~**5b. Trial reports.**~~ *(Done: #1581 merged as `41ca4b9`.*
     - *`get-development-activity-report` was deployed from `main` by run `37055169415`: version 5 → 6 at
       2026-10-02 19:36Z. All 11 deployed files read back byte-identical to `main`, and the JWT check is still on.*
     - *`follow-development-report` shares two of the changed files (`admin-gate.ts`, `service-rest.ts`), so it was
       redeployed from `main` too, by run `37055431044`: version 1 → 2 at 19:39Z. All 11 of its files read back
       byte-identical to `main`.*
     - *Live probe 19:38Z: the capability answer now names invited trial members (customer view only) and says only a
       charged trial report is stored. A call with no token, and a call with only the public key, are both refused
       with 401. Follow's probe at 19:39Z, after its redeploy, is unchanged: capability 200, the public key refused with 401.*
     - *Production still holds 0 evaluations, 0 credits and 0 stored reports, so nobody can reach the trial path
       yet. `report-rights.json` still clears no source, so every report is "No data ingested": free and not stored.)*
     - The report function serves invited trial members the customer view, and calls the database's
       `evaluation_report_issue` only when the rule says a report uses a free report.
     - Open before step 13: there is no rate limit on free trial reports.
   - ~~**5c. The customer page.**~~ Invite link, sign-in, make a report, "reports remaining".
     *(Done: #1586 merged as `70f6879`.*
     - *Three functions deployed from `main` at 2026-10-02 22:45–22:47Z (runs `37074116333`, `37074118191`,
       `37074252338`), each with the JWT check on:*
       - *`development-activity-trial` is new, at version 1.*
       - *`get-development-activity-report` went from version 6 to 7, because its data layer changed.*
       - *`follow-development-report` went from version 2 to 3. It shares the changed `admin-gate.ts` and
         `service-rest.ts`.*
     - *All 29 deployed files (6 + 12 + 11) read back byte-identical to `main`, and no imported file is missing.*
     - *Live probe 22:45Z:*
       - *Each function's capability answer returns 200. A call with no token is refused by the gateway with 401.*
       - *With only the public key, our own gate refuses with 401: the trial function's `status` and `redeem`,
         and a report request.*
       - *Follow, after its redeploy (22:48Z), is unchanged: capability 200, and the public key is refused with 401.*
     - *Pages run `37074109746` deployed at 22:48Z. Read back from homesignal.net at 22:48Z, each byte-identical
       to `main` by md5:*
       - *the page `development-activity-reports.html`, `f86a6cfe…` (noindex);*
       - *`robots.txt`, `c6ec81ff…`, which disallows the page.*
     - *Production still holds 0 evaluations, invites, credits, events, brokerages, members and stored reports. Nobody
       can join a trial until step 5d creates one.)*
     - The page reads an invite from the link's fragment (never sent to a server) and removes it from the address bar.
       It allows sign-in that creates an account, shows "N free reports left", and asks only for the customer view.
     - The trial function answers only about the signed-in person, and never returns an id.
     - Open before step 13:
       - the free-report rate limit (from 5b);
       - how PostgREST turns the database's refusals into HTTP answers. It is checkable once 5d can make a test trial.
   - **5d. Creating a trial.** An admin way to create a brokerage's trial and its owner invite.
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
| ~~Before step 5~~ | ~~Does a limited-coverage report use up a free report?~~ Answered 2026-10-02: "No development activity" is charged, "No data ingested" is not. |
| Before step 8 | How long share links last; whether the client sees the address |
| Step 11 | Create the Lemon Squeezy product and make one test payment |
| Any time, needed by step 12 | Send the Utah permission requests |
