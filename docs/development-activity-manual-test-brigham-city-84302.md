# Manual test — Development Activity, Brigham City, Utah 84302

The launch / manual test location is **Brigham City, Utah 84302** (founder, 2026-10-04). Use it everywhere a test address is needed. Do not use Bingham Canyon or ZIP 84006.

**What this test is.** A person typing a real address into the report, to see that the whole journey (address, then ZIP, then coverage, then report) works somewhere real.

**What this test is not.** Brigham City is a *place*. It is **not a data source and not a clearance.** 84302 being covered means a report can be *asked for* there. It does not mean any publisher's records may be shown to a customer. No source is cleared today (build step 12 is open: the Utah requests have not been sent), so **a real report for this address is "No data ingested", and that is the correct answer, not a failure.** Do not expect to see projects. The database holds 41 stored UDOT records for this ZIP; they are stored, not cleared, and must not appear.

The address to use (copy this one):

```
20 N Main St, Brigham City, UT 84302
```

A second address in the same place, for "another property":

```
22 N Main St, Brigham City, UT 84302
```

> The automated tests use these same two addresses with a stand-in for the address lookup (`test/lib/launch-test-location.mjs`). They cannot tell whether the **live** address lookup finds this address. Part A below is the only thing that checks that.

---

## Part A — the live address lookup and the empty-source state (no cost, no trial needed)

You need to be signed in as an admin. An admin report is never charged and nothing is stored.

> The new "No data ingested" status line (below) goes live when the change that carries it is merged. Before that, the line under the button still says "Report ready: 0 official records within 0.5 miles." for this address. That wording is the defect this change fixes, so if you see it, the change has not been merged yet.

1. Open the admin review page: `https://homesignal.net/development-activity-review.html`
2. Choose **Customer view** (the customer view is what a paying customer sees).
3. Paste the address into the address box:

   ```
   20 N Main St, Brigham City, UT 84302
   ```

4. Press **Make report** and wait for it to finish.

**What you should see (this is the correct, finished state):**

- The big heading **"No data ingested"**.
- Under it: *"HomeSignal cannot yet confirm it receives official development records for this address, so this report cannot say whether there is development nearby. It is not a finding that there is no development."*
- No project cards.
- The line under the button reads: **"Report ready: No data ingested for this address. It is not a finding that there is no development nearby."** It is **not red.**
- The note about credit says this report **would not use a free report: No data ingested.**

**What you should NOT see:** "0 official records", "No development activity" (that is the other outcome and means something else), a red error, or any project from the UDOT list.

**If you see this instead, tell me which:**

| You see | It means |
|---|---|
| "That address could not be found" | the live address lookup did not find `20 N Main St`. The test location needs a different street number. Send me what you see. |
| "…is in ZIP … which HomeSignal does not cover yet" | the lookup returned a ZIP other than 84302. Send me the ZIP it names. |
| "The address lookup service could not be reached" | the Census service was down. Try again in a minute. |
| A red message of any other kind | send me a screenshot. |

5. (Optional) Try one that cannot exist, to see the "not found" answer is plain and free:

   ```
   99999 Nowhere Road, Brigham City, UT 84302
   ```

   Expected: *"That address could not be found. Check the street number, city and state."* and that it used no report.

## Part B — the customer page as the invited owner (optional; creates a real test brokerage)

**Read this before doing it.** Creating a trial makes a real brokerage and a real 20-report trial in the production database. The page has no way to remove or revoke it yet (`evaluation_revoke` has no caller). It costs nothing and, with no source cleared, every report it makes is "No data ingested" (free, never stored). If you do not want a leftover test brokerage, skip Part B.

1. On the admin review page, create a trial for a test brokerage named:

   ```
   Brigham City Test Realty
   ```

2. Open the owner invite link it gives you in a private window, sign in, and accept the invite.
3. On `https://homesignal.net/development-activity-reports.html`, paste the Brigham City address and press **Make report**.
4. Expected: the same "No data ingested" page as Part A, and the panel still says **20 free reports left** (a "No data ingested" report uses none).

## Part C — the rate limit (only after it has been applied and deployed)

Not live yet. It is live only after (1) `docs/report-rate-limit.sql` is applied and (2) `get-development-activity-report` is deployed. If you do this before then, nothing is limited and nothing breaks.

As the invited owner from Part B (an admin is never limited):

1. Make **eleven** reports in under a minute. Change the house number each time so each one is a new address, for example `20`, `22`, `24` … `40` followed by ` N Main St, Brigham City, UT 84302`.
2. Expected: the first ten each show "No data ingested". The eleventh does not make a report; the line under the button says: **"You have asked for a lot of reports in a short time. Try again in N seconds. This did not use a free report."** (N is under a minute). It is not an account error and the free count has not moved.
3. Wait the number of seconds it gave you and press **Make report** again: it works.

## What to send back

For Part A, one line: which of the "What you should see" items you saw, and a screenshot if anything differed. That one result is what turns "the journey works in tests" into "the journey works against the live address lookup".

## What this does not change

- **Step 12 stays open.** This test does not replace sending the Utah source requests or clearing a source.
- **Step 13 stays open.** Nothing here touches Lemon Squeezy; no payment is made; the buttons stay hidden.
