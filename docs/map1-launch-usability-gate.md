# Map 1 first-launch usability gate

**Status: NOT RUN. It cannot be run by Claude Code — it needs human participants.**
Everything below is the pack to run it with. The gate's verdict is the launch decision;
nothing in this repo can substitute for it, and no automated check here should ever be
reported as having passed it.

---

## What the gate is for

Map 1 shows development in exactly two geographies, and the whole launch standard rests on
an ordinary homeowner being able to tell, unprompted, which one is on screen:

| mode | geography | how it is reached |
|---|---|---|
| **Entire ZIP** | the whole ZIP/ZCTA boundary — authoritative membership, **no** centre point, **no** centroid, **no** radius | `homesignalmap.html?zip=<zip>` |
| **Near home** | a radius the resident picked (½ / 1 / 2 / 5 mi) around a **geocoded street address** | the address box |

Automated checks can prove the page *says* the right thing (see
`test/map1-two-modes.browser.test.mjs`, 31 assertions). They cannot prove a homeowner
*understands* it. That is the only question this gate asks.

## Participants

**3–5 people, none of whom work on HomeSignal** and none of whom have seen the page before.
Recruit for "owns or rents a home and has never used a permit or planning website", not for
technical skill. One session each, ~20 minutes, screen shared, thinking aloud.

**Do not recruit a sixth to break a tie.** If the results are ambiguous at five, the design
is ambiguous — fix it and re-run.

## Setup

Give each participant a **real ZIP with real records** — one where a Commercial or
Residential source is wired, so the map is not empty for reasons unrelated to the test.
Start them at `https://homesignal.net/homesignalmap.html?zip=<zip>` with nothing explained.

Have a **second ZIP that is genuinely not measured** ready for task 6. Do not fake one; the
whole point of task 6 is that the honest state is understandable.

## The moderator's rule

**Say nothing that names the thing being tested.** Never say "ZIP", "radius", "whole",
"entire", "nearby", "address mode", or "map mode" unless the participant says it first. If
they stall, the only permitted prompts are:

- "What are you looking at?"
- "What would you do next?"
- "What do you think that means?"

A task completed after you used any other prompt is a **FAIL** for that task. Write down the
exact words you used.

---

## The six tasks

Read each aloud, verbatim. Do not paraphrase.

**1. Find all development across a ZIP.**
> "You've just landed on this page. Show me everything being built or planned in this area."

*Pass:* they stay on the page and read the list/map as the answer. They do **not** first type
an address believing they must, and they do not conclude the page is showing only a few
nearby items.

**2. Search a real address.**
> "Now show me what's happening near this specific address." *(hand them one on paper)*

*Pass:* they find the address box and search without help.

**3. Change the radius.**
> "Show me a smaller area around that address."

*Pass:* they find the radius control and use it. *Also record:* did they notice the numbers
on screen changed?

**4. Say which view they are in.** *(ask twice — once after task 1, once after task 3)*
> "In your own words, what area is this showing you right now?"

*Pass:* after task 1 they say something meaning **the whole ZIP / the whole area**, and after
task 3 something meaning **a set distance around that one address**. Their words, not ours —
"everything in this postcode" and "half a mile from that house" both pass.

**5. Open a project and find the official source.**
> "Pick anything on this page and show me where the official record for it is."

*Pass:* they reach the government record link without help.

**6. Explain a not-measured state.** *(load the not-measured ZIP)*
> "What's this page telling you about this area?"

*Pass:* they say something meaning **we haven't checked / no information yet** — NOT
"there's nothing being built here".
**This is the most important task on the list.** A participant who reads "not measured" as
"nothing here" has been actively misinformed, which is worse than a page that confused them.

---

## Scoring

Critical tasks: **1, 2, 4, 6.** Supporting: **3, 5.**

**PASS requires all of:**
- every participant completes **1, 2, 4 and 6** with no coaching beyond the three permitted
  prompts;
- **no participant confuses any pair** of: ZIP-wide · near-home · a real zero · not-measured;
- tasks 3 and 5 completed by at least 4 of 5 (or 3 of 3 / 3 of 4).

**Any single participant reading not-measured as "nothing is happening here" FAILS the gate
outright**, regardless of every other score. That is a false claim about the world, and the
page must not be able to produce it.

### Sheet

| # | task | P1 | P2 | P3 | P4 | P5 | notes / exact words used |
|---|---|---|---|---|---|---|---|
| 1 | all development across a ZIP | | | | | | |
| 2 | search an address | | | | | | |
| 3 | change the radius | | | | | | |
| 4a | which view? (after 1) | | | | | | |
| 4b | which view? (after 3) | | | | | | |
| 5 | open a project → official source | | | | | | |
| 6 | explain not-measured | | | | | | |

Record for each: **pass / pass-with-prompt / fail**, plus the participant's own words for
task 4 and task 6. Their phrasing is the finding; a tick is not.

---

## What was already fixed, and what the gate is therefore testing

The four defects below were measured in the browser on 2026-09-06 and are fixed on
`claude/commercial-type-maps-cqa8ev`. The gate tests whether fixing them was **enough** —
it is not a re-check of them.

1. **No way back to the whole-ZIP view** — a resident who searched an address could return
   only by editing the URL. Now: "← Back to all development in ZIP `<zip>`".
2. **The hero kept claiming the whole ZIP while a circle was on screen** — H1 "Herndon
   (20171)" and "…proposed across ZIP 20171" sat directly above "Within 2 miles of 2400
   MONROE ST". Now the hero is rewritten per mode.
3. **"Across ZIP 20171"** read as "projects around here". Now "All development across ZIP
   20171", with "All" shown only when the whole-ZIP read actually came back complete.
4. **"Within 2 miles of"** never said what was being counted. Now "Showing development
   within 2 miles of", with a plain-words line naming the circle and saying it is not the
   whole ZIP.

## Known gaps this gate may surface, deliberately not pre-fixed

- **The cold page with no ZIP context** still shows Box-Elder-only static copy ("Box Elder
  County addresses only, for now"). It is unreachable from any normal entry point, since
  `boot()` restores the last viewed ZIP, but a first-ever visitor with no ZIP in the URL
  lands there. Not changed here because it is a hero-copy question, not a mode question.
- **`test/map1-address-radius.browser.mjs` fails on the unmodified tree too** — it clicks
  the radius button while still in ZIP mode, where the control is correctly hidden. Pre-existing.
