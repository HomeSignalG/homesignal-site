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

5. ~~**Free trial sign-up.**~~ Invite link, sign-in, 20 shared reports, "reports remaining". The 20-report limit
   is already enforced in the database (Order L1, applied 2026-10-02).
   *Founder decision first:* does a report with limited coverage use up a free report? (ruling R5)
   **Answered 2026-10-02** (`docs/development-activity-founder-ruling-r5-2026-10-02.md`): a report that shows
   development, or that proves **"No development activity"**, uses one free report; a report that is empty
   because of **"No data ingested"** does not. Until HomeSignal can prove "No development activity" for an
   address, an empty report is "No data ingested" and is free.
   Four pull requests, and a fifth added after 5d:
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
   - ~~**5d. Creating a trial.**~~ An admin way to create a brokerage's trial and its owner invite.
     *(Done: #1588 merged as `dd24753`.*
     - *Two functions deployed from `main` at 2026-10-02 23:22Z, each with the JWT check on:*
       - *`development-activity-trial` went from version 1 to 2 (run `37077195563`).*
       - *`get-development-activity-report` went from version 7 to 8 (run `37077205513`). It imports the changed
         `_shared/evaluation-reads.ts`.*
       - *Follow is unchanged: its files did not change.*
     - *All 18 deployed files (6 + 12) read back byte-identical to `main`, and no imported file is missing.*
     - *Live probe 23:22Z:*
       - *The trial function's capability answer names the `create` action as admin-only.*
       - *A create request with no token is refused by the gateway with 401.*
       - *With only the public key, our own gate refuses with 401: `create`, `status`, and a report request.*
     - *Pages run `37077192771` deployed at 23:23Z. Read back from homesignal.net at 23:24Z, each byte-identical to
       `main` by md5:*
       - *the review page, `4a74693f…` (noindex, with "Start a brokerage trial");*
       - *`robots.txt`, `c6ec81ff…`.*
     - *Production still holds 0 trials. The first one is created by the founder, signed in on the review page.)*
     - The trial function's `create` action is for admins only, refused before a field is read. It checks the name, an
       optional seat limit and an optional length (blank means none; nothing is invented). It then creates the account,
       the trial and the owner invite in the database's one transaction, and returns the owner link once, with no id.
     - The invite link has one form, in `_shared/evaluation-reads.ts`. The customer page reads exactly that form.
     - Open before step 13:
       - an owner cannot yet invite agents (`evaluation_invite_mint`);
       - the free-report rate limit;
       - checking how PostgREST turns the database's refusals into HTTP answers, now possible with a test trial.
   - ~~**5e. Agents join the trial.**~~ *(Added 2026-10-02, after 5d.)* The trial's 20 reports are shared by a
     brokerage's agents, so its owner needs a way to invite them. That is `evaluation_invite_mint` with the owner as
     actor: agent invites only, within the seat limit, through the same invite link and the same customer page.
     Step 5 is struck when 5e is done.
     *(Done: #1592 merged as `4bbf16d`.*
     - *Two functions deployed from `main` at 2026-10-03 13:30Z, each with the JWT check on:*
       - *`development-activity-trial` went from version 2 to 3 (run `37126364726`).*
       - *`get-development-activity-report` went from version 8 to 9 (run `37126366271`). It imports the changed
         `_shared/evaluation-reads.ts`.*
       - *Follow is unchanged: its files did not change.*
     - *All 18 deployed files (6 + 12) read back byte-identical to `main`, and no imported file is missing. Two
       negative controls (one changed character, one removed file) were each caught.*
     - *Live probe 13:32Z:*
       - *The trial function's capability answer is byte-identical to the one `main` defines. It names the `invite`
         action, for an owner of an active trial, and lists the agent invite among what it writes.*
       - *An `invite` request with no token is refused by the gateway with 401.*
       - *With only the public key, our own gate refuses `invite` with 401.*
     - *Pages run `37126362289` deployed the customer page. Read back from homesignal.net at 13:33Z, each
       byte-identical to `main` by md5:*
       - *`development-activity-reports.html`, `9eb315ce…` (noindex, with "Invite an agent");*
       - *`robots.txt`, `c6ec81ff…`.*
     - *Production still holds 0 trials, invites, members and stored reports. The first trial is created by the
       founder on the review page.)*
     - The trial function's `invite` action makes one agent invite link for an owner of an active trial. The database
       checks the person is an owner of that brokerage at the moment the link is made; the function does not decide it.
     - The status answer now carries the person's role (owner, agent, or none), read from the one membership resolver.
     - The customer page shows "Invite an agent" only to an owner of an active trial. Each link is shown once, with
       Copy, and is never stored. Signing out, a different person signing in, or the trial ending takes it away.
     - The seat limit is checked when an agent joins, so an owner may make several links.
     - Open before step 13:
       - an owner cannot yet list, withdraw or see again the links they made, or remove an agent;
       - the free-report rate limit;
       - checking how PostgREST turns the database's refusals into HTTP answers, now including `NOT_ENTITLED` from
         the mint.
6. ~~**Saved reports.**~~ Each report gets a permanent ID; reopening, sharing or printing never uses another report.
   *(Done: #1594 merged as `a5e5d0c`. Sharing and printing are step 8; this step covers listing and reopening.*
   - *Database, applied to production 2026-10-03 as migration `saved_reports_20261003` from `docs/saved-reports.sql`. It
     is additive and read-only: two functions, no table, column, trigger or schedule.*
     - *Read back: each function body's md5 equals the committed file's (`evaluation_reports_of` `56b5dc46…`,
       `evaluation_report_open` `a25cd553…`). Both are STABLE and SECURITY DEFINER, owned by `postgres`, and executable
       by `service_role` only; `anon` and `authenticated` cannot run them.*
     - *Production still holds 0 stored reports and 0 evaluations, so nothing was written.*
   - *Three functions deployed from `main` on 2026-10-03, each with the JWT check on: `get-development-activity-report`
     version 9 to 10 (run `37129613308`), `development-activity-trial` 3 to 4 (run `37129615065`), `follow-development-report`
     3 to 4 (run `37129616660`). The last two have no behaviour change; they were redeployed because they import the
     changed shared files.*
   - *Deployed source of the report function read back by quoting the lines that matter, not byte-for-byte: both database
     calls, the `list`/`open` branch, `charged: false`, the gate's `complete` flag, and the complete-trial refusal placed
     after the saved-report branch.*
   - *Live probe: a request with no token is refused by the gateway with 401; with only the public key, our own gate
     refuses with 401.*
   - *Pages deployed the customer page. Read back from homesignal.net, `development-activity-reports.html` is
     byte-identical to `main` by md5 (`27759f35…`, 34,785 characters) and carries the Saved reports card.*
   - *Not exercised live: the signed-in list and open path. No trial member exists in production yet, and none was created.
     It is proven by the deployed source, the database fingerprints and the tests: 74 checks against a real Postgres, 60 on
     the report function, 73 in a browser, and 43 deliberate breakages all caught.)*
   - A trial member sees a "Saved reports" card listing their brokerage's stored reports, newest first, and can open one
     again exactly as it was saved. Opening never uses a free report and writes nothing.
   - A foreign, unknown or malformed report id gives the same "not found". A trial whose 20 reports are used can still
     reopen them but cannot make a new one. A revoked or expired trial sees nothing.
   - The address shows beside a saved report only while the private layer still keeps it; once purged, the report still opens.
   - Defaults taken, the founder may change any: every member of a brokerage sees all of its reports (the ledger holds no
     user id by design); reopening reads the stored text and never recomputes it.
   - Open before step 13 (unchanged): the free-report rate limit; an owner cannot list or withdraw invite links or remove an
     agent; how PostgREST turns the database's refusals into HTTP answers is unchecked against production.
7. ~~**Brokerage and agent header**~~, filled from the account (brokerage name, agent name, optional client label).
   *(Done: #1599 merged as `03c7332`.*
   - *Database, applied to production 2026-10-03 as migration `report_header_of_step7` from `docs/report-header.sql`. It is
     additive and read-only: one function, no table, column, trigger or schedule.*
     - *Read back: the function body's md5 equals the committed file's (`d28de102…`). It is STABLE and SECURITY DEFINER,
       owned by `postgres`, and executable by `service_role` only; `anon` and `authenticated` cannot run it. For an unknown
       user it returns no rows.*
     - *Production holds 0 brokerage accounts, so nothing was written and no real header exists to read.*
   - *Two functions redeployed from `main` on 2026-10-03, each with the JWT check on: `get-development-activity-report`
     version 10 to 11 and `development-activity-trial` 4 to 5 (runs `37137714632`, `37137737042`, `37137738496`).*
     - *`follow-development-report` stays at version 4, correctly. It does not import the changed shared module (checked: no
       import of `evaluation-reads` in its sources or in the shared files it uses, and #1599 changed none of its inputs), so
       its bundle hash `9d8b52a3…` is the same before and after and the deploy changed nothing. The PR text that said all
       three functions import the changed file was wrong for this one.*
   - *Deployed source read back by searching the returned bundles: the shared module carries `report_header_of`,
     `cleanDisplayName` and both name limits in both functions; the report function's handler carries `headerOf` and
     `client_label`, and its data layer wires `headerOf`.*
   - *Live probe: a request with no token is refused by the gateway with 401.*
   - *Pages deployed the customer page. Read back from homesignal.net, `development-activity-reports.html` is
     byte-identical to `main` by md5 (`eee99e78…`) and carries the "Your name on reports" card. A read one minute after the
     merge still returned the previous page; the deploy had not landed yet.*
   - *Not exercised live: the signed-in header path. No trial member exists in production yet, and none was created. It is
     proven by the deployed source, the database fingerprint and the tests: 94 checks against a real Postgres, 171 on the
     report function, 99 in a browser, and 39 deliberate breakages all caught.)*
   - Every report shows "brokerage · agent" above it, and an optional client label the agent typed. The brokerage name comes
     from the account; the agent name is the one the person typed in the "Your name on reports" card.
   - The header is read when a report is shown and kept nowhere, so a report always names whoever is looking at it now. A
     header that cannot be read shows no report and costs nothing.
   - The client label is kept only beside the address in the private layer, only for a report that was stored, and goes with
     the address when that is purged.
   - Defaults taken, the founder may change any: the agent name is self-declared and not verified; a name over its limit
     (agent 80, brokerage 120, label 80 characters) is shown as no name rather than cut short.
   - Open before step 13 (unchanged): the free-report rate limit; an owner cannot list or withdraw invite links or remove an
     agent; how PostgREST turns the database's refusals into HTTP answers is unchecked against production; the signed-in
     paths are not exercised live. Also carried: several older mutation harnesses have stale anchors that predate step 7
     (`national_report`, `follow_report`, `evaluation_entitlement`, `single_customer_generation_path`,
     `development_activity_review`); none guards step 7.
8. ~~**Share and PDF.**~~ Private read-only link for the client that the agent can revoke; PDF through the
   browser's print. *Founder decisions first:* how long a share link lasts; whether the client sees the
   street address. *Answered 2026-10-03: 6 months; yes.*
   *(Done: #1602 merged as `1230849`.*
   - *Database, applied to production 2026-10-03 as migration `report_share_delivery` from `docs/report-share-delivery.sql`.
     It is additive: four functions and two constants, no table, column, trigger or schedule.*
     - *Read back: all six function bodies' md5 equal the committed file's (`evaluation_report_share_create` `7c8b0c8e…`,
       `evaluation_report_shares_of` `e4feb9dd…`, `evaluation_report_share_revoke` `48f3c852…`, `report_share_open`
       `baa5e602…`, `report_share_lifetime` `e9b3b24c…`, `report_share_limit` `f6370dce…`), and the stored migration text
       equals the file by md5 (`68211ef5…`, 17,128 characters). The two reads are STABLE, the four with logic are SECURITY
       DEFINER, all six are owned by `postgres` and executable by `service_role` only; `anon` and `authenticated` cannot run
       any of them (0 of 6). The lifetime reads `6 mons`, the cap 25.*
     - *Control: the share primitive's resolver answers `UNKNOWN` for a made-up hash and `report_share_open` returns no rows
       for it. Production holds 0 share rows, so nothing was written.*
   - *Three functions deployed from `main` on 2026-10-03: `view-shared-report` new, version 1, JWT check OFF (run
     `37144580320`); `manage-shared-report` new, version 1, JWT check on (run `37144606366`); `get-development-activity-report`
     version 11 to 12 (run `37144608162`), JWT check on. `deploy-edge-functions.yml` now turns the JWT check off for exactly
     two functions (the report engine and `view-shared-report`), and `supabase/config.toml` records one `verify_jwt = false`.*
   - *Deployed source of the report function read back by searching the returned bundle: it carries the shared reader
     `_shared/private-subject.ts` and the `subjectOf` wiring.*
   - *Live probes, no token of any kind sent, through the database's HTTP client: `view-shared-report` answers a well-formed
     unknown token and an empty body with its own `404 {"error":"not_found"}` (`no-store`), and a body with an extra field
     with `400 bad_request`. Control: `manage-shared-report` with no token is refused by the gateway with `401
     UNAUTHORIZED_NO_AUTH_HEADER`.*
   - *Pages deployed (run `37144477378`). Read back from homesignal.net, `shared-report.html` (`e092515a…`, 9,901 bytes),
     `development-activity-reports.html` (`a086e9cf…`), `lib/da-report-view.js` (`5344e835…`) and `robots.txt` (`d4ae529f…`)
     are byte-identical to `main` by md5 and size.*
   - *Not exercised live: making, opening and withdrawing a real link. No brokerage member and no stored report exist in
     production, and none was created. It is proven by the database fingerprints and the tests: 43 checks against a real
     Postgres (including two real sessions racing for a report's last place), 85 on the two functions, 51 on the structure,
     36 and 32 on the client's page (the second in Chromium against the real handler), 125 on the agent's page in
     Chromium, and 81 deliberate breakages all caught (30 in the database, 51 in the functions, pages and wiring).)*
   - On a saved report the agent gets "Share this report with your client": make a link (shown once, with Copy), see the
     report's links with their status (Working, Expired, Withdrawn), withdraw one, and Download PDF.
   - The client opens the link with no account and sees the report, the brokerage's name and the street address (while it
     is kept). The client sees no agent name, no client label and no other report. A link that is unknown, withdrawn or
     expired gets one and the same message, so nothing says whether a link ever existed.
   - A link lasts 6 months and cannot be extended; a lapsed one is replaced. A report may have at most 25 links. The agent can
     withdraw a link at any time, even after the trial has ended.
   - Download PDF is the browser's print window ("Save as PDF"); no PDF is made on a server.
   - Defaults taken, the founder may change any: a link does not remember which agent made it, so any member of the
     brokerage may see and withdraw it and the client's view names the brokerage, not a person; opens are not recorded, so
     there is no "viewed" mark; a link keeps working if the trial later ends, and stops if HomeSignal withdraws the account.
   - Open before step 13 (unchanged, plus one): the free-report rate limit; **the public link endpoint is not rate-limited**;
     an owner cannot list or withdraw invite links or remove an agent; how PostgREST turns the database's refusals into
     HTTP answers is unchecked against production; the signed-in paths are not exercised live. Also carried: several older
     mutation harnesses have stale anchors that predate step 7; none guards step 8.
9. ~~**Watch.**~~ Daily check of the property; email to the agent when a nearby project's official status changes.
   *(Done: #1606 merged as `fc0d700`.*
   - *Database, applied to production 2026-10-03 21:20:52Z as migration `property_watch` from `docs/property-watch.sql`
     (file md5 `53191b93…`), run through the committed-file runner `db-sql.yml` (run `37154775387`) because the migration tool
     timed out twice at its 60-second limit with no effect on the database (checked). It is additive: two tables, sixteen
     functions, three triggers; no existing table, column or schedule was changed.*
     - *Read back: the sixteen function bodies fingerprint `83851d0a…`, the constraints `dd40e118…` and the triggers `3fdca4b2…`,
       each equal to the same fingerprint computed from a fresh build of the committed file. All objects are owned by `postgres`
       and executable by `service_role` only. The ledger row `property_watch` (version `20261003212052`) was written by hand
       with its statements left empty, because the runner writes no ledger row.*
   - *Four functions deployed from `main` on 2026-10-03 (runs `37154837397`, `37154838946`, `37154840674`, `37154842203`):
     `manage-property-watch` new, version 1; `run-property-watch` new, version 1; `get-development-activity-report` version 12
     to 13; `follow-development-report` to version 5. Both new functions have the JWT check ON (the scheduler sends the public
     key); `run-property-watch` also needs the project's private secret. Read back: all four ACTIVE at those versions.*
   - *Pages deployed. Read back from homesignal.net by md5 and size, byte-identical to `main`: `development-activity-reports.html`
     (`13c97236…`, 59,418 bytes), `lib/da-report-view.js` (`77714f0a…`, 52,921), `development-activity-review.html`
     (`e6e4ee31…`, 26,349) and `shared-report.html` (`f8990467…`, 9,901).*
   - *Dry run, through the database's HTTP client, against the deployed function: with the secret `200 {"status":"OK","dry_run":true,
     "due":0,"email_configured":true}`. Controls: no secret `401 unauthorized`; a wrong secret `401 unauthorized`; a GET with no
     secret returns only the function's description (`secret_configured: true`, `email_configured: true`).*
   - *Schedule applied 2026-10-03 21:24Z from `docs/property-watch-schedule.sql` (file md5 `7b8c0232…`, run `37155011464`;
     ledger row `property_watch_schedule`, statements empty). Read back: job `property-watch-run` (id 84) is active on
     `3,13,23,33,43,53 * * * *` and runs `select public.property_watch_run_scheduled()`. The wrapper and the health read fingerprint
     `0ad623b3…` and `0d71ffaf…`, equal to the file's. Only `postgres` can run the wrapper; the health read is `service_role`
     only; `anon` and `authenticated` can run neither. The first scheduled fire, 21:33:00Z, succeeded, and the function answered
     `200 {"status":"OK","dry_run":false,"claimed":0,"checked":0,"notified":0,"ended":0,"failed":0,"not_reached":0}`.*
   - *Monitor read back at the first hourly health tick after the schedule (22:10:00Z): check `property_watch_run` is alertable
     and ok, "check job active; 0 watch(es); none more than 6 hours overdue; none failing; no watch invariant broken"; the monitor
     now holds 22 checks, none failing and alertable, and no alert was sent. Four scheduled fires (21:33 to 22:03Z) all succeeded.*
   - *Not exercised live: starting, listing or stopping a real watch, a real check of a real property, and a real email. No
     brokerage member and no stored report exist in production (`report_snapshot` holds 0 rows) and none was created, so the
     job claims nothing today. It is proven by the fingerprints above and the tests: 64 checks against a real Postgres (66
     deliberate breakages of the SQL, all caught), 44 checks on the schedule (38 breakages caught), 43 on the change rule, 140
     on the two functions, 35 on the email (address, label, coordinate, distance and agent proved absent), 64 on the structure,
     153 on the agent's page in Chromium, and 98 breakages of the functions, pages and wiring, all caught.)*
   - On a saved report the agent presses Watch. HomeSignal then checks the property once a day, on the time of day the watch
     was started, and emails the agent when something near it has had an official status change since the report. The agent can
     see the watch (report number, when it was last checked, when it is next due) and stop it at any time, even after a trial ends.
   - The email carries no street address, client label, coordinate or distance: it gives the report's number and date, each
     change in the publisher's own words with its official source link, and an "Open the report" button to HomeSignal's
     reports page. It lists exactly what is recorded as told, and records it only after the email provider accepts the
     message, so nothing is announced twice and nothing is announced and lost.
   - Defaults taken, the founder may change any (full list D-9-1 to D-9-8 in `docs/development-activity-watch-2026-10-03.md`):
     once a day on the start time; 25 watches per brokerage at once; "changes" means what Changes Since Report means, so the first
     email can list everything recorded since the report was made; a watch is the agent's own, not the brokerage's; the recipient
     is the agent's sign-in email, read at send time and stored nowhere; the agent is not emailed when a watch ends (standing lost,
     address purged) or when a check keeps failing, an alarm reports failures instead.
   - Open before step 13 (unchanged, plus three): the free-report rate limit; the public link endpoint is not rate-limited; an
     owner cannot list or withdraw invite links or remove an agent; how PostgREST turns the database's refusals into HTTP answers is
     unchecked against production; the signed-in paths are not exercised live; **`run-property-watch` has no rate limit beyond its
     private secret and its per-call limit of 5**; **an ended or failing watch is not emailed to the agent (D-9-5, D-9-7)**; **the
     ledger rows for runner applies (`property_watch`, `property_watch_schedule`) are hand-written backfills with empty statements**.
     Also carried: several older mutation harnesses have stale anchors that predate step 7; none guards step 9.
10. ~~**Compare.**~~ Two to five addresses side by side, same report rules.
   *(Done: #1612 merged as `cf7aba5`.*
   - *No SQL and no edge function in this step: nothing was applied to the database and nothing was deployed to the edge. It ships with
     the site (Pages), and the saved-report calls from step 6 are unchanged.*
   - *Pages deployed (run `37165714825`, success). Read back from homesignal.net by md5 and size, byte-identical to `main`:
     `development-activity-reports.html` (`a3b58820…`, 67,779 bytes), `lib/da-report-view.js?v=09e9661a` (`b86cec10…`, 56,840),
     `lib/da-report-compare.js?v=e0b8a59d` (`52ec98a4…`, 18,587), `development-activity-review.html` (`da2e4058…`, 26,349) and
     `shared-report.html` (`f78ba5f3…`, 9,901).*
   - *Not exercised live: opening or comparing a real saved report. No brokerage member and no stored report exist in production, and
     none was created. It is proven by the tests: 74 checks on the comparison, 50 on the structure, 40 in Chromium against the real
     handlers, and 64 deliberate breakages, all caught (16 of 18 page breakages by Chromium alone; the two others are explained in the
     record).)*
   - On the agent's reports page a **Compare properties** card lists the saved reports with a checkbox each. The agent ticks two to
     five and the page opens exactly those (the same open call that reopens a saved report) and sets them side by side: what changed,
     by stage, by type, the latest timeline facts, and coverage and freshness in the engine's own words. A comparison does not use a
     free report, and it is rebuilt from the saved reports each time.
   - Defaults taken, the founder may change any (full list D-10-1 to D-10-7 in `docs/development-activity-compare-2026-10-03.md`):
     Compare works on saved reports, so an address is added by making its report first (a report is charged by the one rule);
     distance is not compared, because a saved report does not keep it; columns follow the saved list's order, newest first, and
     nothing is ranked; reports of different distances are refused; the comparison is not printed or shared; "published timelines"
     are the publisher's latest event and the newest change HomeSignal detected; a count is of source records, not of proven
     separate projects.
   - Open before step 13 (unchanged): the free-report rate limit; the public link endpoint is not rate-limited; an owner cannot list or
     withdraw invite links or remove an agent; how PostgREST turns the database's refusals into HTTP answers is unchecked against
     production; the signed-in paths are not exercised live; `run-property-watch` has no rate limit beyond its private secret; an ended or
     failing watch is not emailed to the agent. Also carried: several older mutation harnesses have stale anchors that predate step 7;
     none guards step 10.
11. ~~**$79/month checkout**~~ on the existing Lemon Squeezy connection: 100 reports a month, Billing tab.
    *Founder action:* create the $79 product in Lemon Squeezy and make one test payment.
   *(Done: #1614 merged as `8dafe51`. **The build is done. The founder actions are NOT done, no payment has been made, and nothing has been
   exercised against Lemon Squeezy.***
   - *SQL applied (`docs/brokerage-billing.sql`, db-sql run `37171141594`; the migration-ledger row `brokerage_billing` is a hand-written
     backfill with empty statements, like the two watch rows). Read back from production: two tables, one view and 11 functions; **all 11 function
     bodies are md5-identical to the committed file**; both tables have row level security on and no grant to `anon`, `authenticated` or
     `service_role` (the view likewise); 8 functions are executable by `service_role` alone and 3 (the two triggers and the charging helper) by
     nobody; the six ownership readers now read the one view and their attributes are unchanged (md5 `e1e95ccb…` before and after);
     `billing_report_limit()` is 100; the table constraints carry the cap (primary key `(binding_id, period_index, ordinal)`, ordinal 1 to the
     limit). Controls: `postgres` holds 12 table privileges, `service_role` executes 8 billing functions and still executes the free evaluation
     function. Production held 0 payment events, 0 stored reports and 0 free credits before and after. `billing_check()` reads 0 on all 8
     invariants, but beside **controls of 0**, because production's tables are empty: that proves nothing is broken, not that the rules work. The
     rules are proved on a disposable database (below).*
   - *Functions deployed from `main` (runs `37171227622`, `37171230489`, `37171231495`, all success): `get-development-activity-report` v14 and
     `manage-billing` v1 with JWT on, `development-activity-billing-webhook` v2 with JWT off. The map product's `lemonsqueezy-webhook` (v4) is
     untouched. **Read back live with the secrets unset:** the webhook's GET answers 200 with `configured: false`; an unsigned POST answers 503
     `not_set_up`; `manage-billing` with no token answers 401 at the gateway, and with the anon key (no signed-in person) its own 401
     `unauthorized`, as does the report function.*
   - *Pages deployed (run `37171204410`, success). `development-activity-reports.html` read back from homesignal.net by md5 and size,
     byte-identical to `main` (`0e2c21c7…`, 79,185 bytes), with the Billing card and its Subscribe button.*
   - *Not exercised live: **every signed-in path** (a member's plan, an owner's checkout answering 503 `billing_not_set_up`), because no signed-in
     session and no Lemon account were available; **payment**, which cannot be tested without the founder's product and test card; and any real
     Lemon payload, none of which was captured, so **every field name read from the processor is unverified** and the code refuses what it does
     not recognise. Proved by tests instead: 72 checks of the SQL on a disposable Postgres with real concurrent sessions (two callers racing for
     the 100th report, the same key sent twice, two events binding one subscription to two brokerages), the rollback run with 315 paid
     reports stored, 38 deliberate SQL breakages and 96 edge breakages all caught, and 232 checks in Chromium against the real handlers. The
     CI run on the first push caught one gap the local run did not: the trial suite had neither the billing file nor the two database calls the
     handler now makes (fixed and pinned).*
   - *Founder decision needed (D-11-1): **a cancelled subscription ends access at once**, because the ledger holds no period-end date, so a
     member who cancels loses the month they paid for. A later change can honour the paid-to date once the first real event shows where the
     processor puts it. Other defaults taken are D-11-2 to D-11-12 in `docs/development-activity-billing-2026-10-04.md` (a second webhook with
     its own address and secret, billing-specific secret names, free reports never counting toward the plan).)*
   - A brokerage owner opens the **Billing** card, starts a $79/month checkout, and once a signed webhook records an `active` subscription the
     brokerage gets **100 new reports a month**, separate from its 20 free reports. Reopening, sharing, printing, Watch and Compare never use a
     report. Test payments never grant reports (the card says "Test subscription only"). The cap is a database constraint, not a count.
   - **Founder actions, none done** (exact steps and the read-only ledger queries are in section 5 of the record): create the $79 product (test
     mode first) · create a **second** webhook with its own signing secret · set `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`,
     `LEMONSQUEEZY_BILLING_VARIANT_ID`, `LEMONSQUEEZY_BILLING_WEBHOOK_SECRET` and `LEMONSQUEEZY_TEST_MODE=true` · make one test payment · check
     the ledger rows before anything goes live. Until the four secrets are set, everything fails closed.
   - Open before step 13 (unchanged, plus three): the free-report rate limit; the public link endpoint is not rate-limited; an owner cannot list
     or withdraw invite links or remove an agent; how PostgREST turns the database's refusals into HTTP answers is unchecked against production;
     `run-property-watch` has no rate limit beyond its private secret; an ended or failing watch is not emailed to the agent; **there is no
     billing-portal link, so a customer cannot change a card or cancel from the page**; **`docs/payment-event-ledger.sql`'s header still says
     "NOT APPLIED" though it was applied on 2026-10-02**; **the ledger row for this runner apply is a hand-written backfill**. The landing page's
     buttons stay inert (step 13). Also carried: several older mutation harnesses have stale anchors that predate step 7; none guards step 11.

## Part C — before the buttons go live

12. **Source permissions.** No source is cleared for paying customers yet, so a customer report shows no
    projects. *Founder action:* send the drafted Utah requests (UDOT, Salt Lake City, Provo;
    `docs/corporate-output-utah-clearance-2026-10-02.md`). Each source is added to
    `supabase/functions/_shared/report-rights.json` as its answer arrives.
   *(**NOT done, and not struck.** This step is complete when sources are cleared, and none is: `report-rights.json` still says
   `"cleared": []`. **No request has been sent and none is pending.** State on 2026-10-04:*
   - *The requests are re-drafted and send-ready in `docs/utah-source-requests-send-ready-2026-10-04.md`, replacing the body in the
     2026-10-02 file (kept as the dated record). The old body predated saved reports, client links, Watch, Compare and the
     subscription; sent as it stood it would have under-described the use. The new body states each of them, and the three requests
     differ only in the dataset they name (checked when generated).*
   - *Re-read on 2026-10-04 through the database's HTTP extension: the three publishers' posted wording is unchanged (UDOT a warranty
     disclaimer plus a contact, Salt Lake City the label "Open Data", Provo silent). All three stay HOLD. The Utah development rows are 10,426,
     of which UDOT is 9,665 (92.7%). The Provo page cited in the old draft now answers 404 and is dropped.*
   - *Recipients: UDOT's is `udotgis@utah.gov`, printed in its own license text. **Salt Lake City's and Provo's were not found** (Provo's city
     site shows only its general line); none is invented. The pack says how to find them.*
   - *A control now exists for the day an answer arrives: `docs/source-clearance-evidence-template.md` and `test/report-rights-evidence.test.mjs`
     (28 checks; 16 deliberate breakages of its rules, all caught). A registry entry is refused unless it points at a real, filled-in
     evidence section that names the source, quotes the publisher's own words and carries the attribution the publisher required.*
   - *Consequence for step 13: until one source is cleared, every report is "No data ingested" (free, never stored), so the 20 free reports
     and the paid month cannot be exercised on real data. They can be exercised on test data.)*
13. **End-to-end launch test, then the Enterprise page buttons go live.** A test brokerage runs sign-up,
    20 reports, the end of the trial, payment and a 100-report month.

## Founder actions, and when

| When | What |
|---|---|
| After step 4 | Review the layout with 84302 |
| ~~Before step 5~~ | ~~Does a limited-coverage report use up a free report?~~ Answered 2026-10-02: "No development activity" is charged, "No data ingested" is not. |
| ~~Before step 8~~ | ~~How long share links last; whether the client sees the address~~ Answered 2026-10-03: 6 months; yes. |
| Step 11 (build done, still yours) | Create the Lemon Squeezy product and a second webhook, set the four secrets and test mode, make one test payment, check the ledger rows before going live. Steps: section 5 of `docs/development-activity-billing-2026-10-04.md`. Also decide D-11-1 (a cancelled subscription ends access at once) |
| Any time, needed by step 12 | Send the three Utah permission requests (UDOT, Salt Lake City, Provo). Ready to send, with the steps: `docs/utah-source-requests-send-ready-2026-10-04.md`. Two recipients still have to be found. Tell me each date you send one |
