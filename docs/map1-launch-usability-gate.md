# Map 1 launch usability gate — participant script

**Status: NOT RUN. This gate requires 3–5 real non-technical participants and is the one
launch requirement Claude Code cannot execute.** No session should mark it passed from
automated output. Simulating participants, or inferring a PASS from green tests, would be
fabricating the single piece of evidence the gate exists to produce.

What automation *has* established is narrower and is listed under "Already proven mechanically"
below — those are contract checks on the page, not evidence that a homeowner understands it.

---

## Setup

- A participant who has **not** seen the product and does **not** work in software, GIS or civic tech.
- Give them the bare URL `https://homesignal.net/homesignalmap.html?zip=<a measured ZIP>` and nothing else.
- **Do not coach.** If they ask a question, write it down and reply "whatever you think it means."
- Watch for the moment they hesitate; the hesitation is the finding, not the eventual answer.

## The six tasks

| # | Ask them to | Watch for |
|---|---|---|
| 1 | Find all development across a ZIP | Do they believe the page is showing the *whole* ZIP, or assume it is "nearby"? |
| 2 | Search a real address | Do they notice the view changed? |
| 3 | Change the address radius | Do they find the control, and do they see the results change scope? |
| 4 | Say whether they are viewing an entire ZIP or a near-home radius | **The core question.** Ask at both points. |
| 5 | Open a project and find the official source | Do they reach the government record? |
| 6 | Explain what a not-measured state means | Do they read it as "nothing is happening here" (fail) or "not measured yet" (pass)? |

Use `?zip=` on a ZIP with no authoritative measurement for task 6, so the state is real rather than described.

## PASS criteria — all must hold

1. Every participant completes tasks 1–5 **without coaching**.
2. On task 4, every participant correctly names which mode they are in, **both times**.
3. No participant confuses any of these four states:
   - ZIP-wide results
   - near-home (radius) results
   - a measured zero ("we looked across the whole ZIP and found none")
   - not-measured ("we have not measured this ZIP yet")
4. No participant believes the facilities count is a whole-ZIP measurement. It is not — facilities
   come from an EPA query *around* the ZIP, and on 50 ZIPs with authoritative boundaries **44%**
   of the facilities shown sat outside the ZIP whose page showed them.

Any single failure is a FAIL for the gate. Record the wording that caused it — the fix is
usually one sentence.

## Recording sheet

```
participant:            date:
task 1 completed unaided?      Y / N     notes:
task 2 completed unaided?      Y / N     notes:
task 3 completed unaided?      Y / N     notes:
task 4 named the mode right?   Y / N     (asked twice: ZIP __ / address __)
task 5 reached the record?     Y / N     notes:
task 6 read not-measured as "not measured yet"?   Y / N
confused any of the four states?                  Y / N   which:
exact wording that caused any hesitation:
```

## Already proven mechanically (NOT a substitute for the gate)

These are page-contract checks. They prove the page *says* the right thing; only the gate proves
a homeowner *understands* it.

- ZIP mode reads "All development across / ZIP <zip>" plus "The entire ZIP area — not only
  projects near one address." — `test/user-journey.browser.test.mjs` §6, §13f/§13g
- Address mode reads "Showing development within <radius> of / <address>" — §8, §12a
- A visible "← Back to all development in ZIP <zip>" link exists in address mode and is absent in
  ZIP mode — §13a–§13e
- Facilities are never described as a whole-ZIP measurement, and ZIP mode shows no mixed total —
  §10b–§10d, §11a–§11d
- The not-measured sentence is actually rendered, and the development counter shows "—" rather
  than a measured 0 there, while a measured ZIP still shows a real number — §14a–§14f
- A project's dossier carries its official record link — `scripts/map1-ux-gate.mjs` A10/A11

## Known gap the gate should probe hardest

Task 6. The not-measured state is the newest wording and the least exposed to real readers, and
it is the one state where being misread produces a *false reassurance* ("nothing is happening
near my home") rather than mere confusion.
