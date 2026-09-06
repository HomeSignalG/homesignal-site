# Map 1 — first-launch usability gate

**Status: the MECHANICAL half is automated and green. The HUMAN half has NOT been run.**

This document is deliberately split in two, because those halves prove different things and
only one of them can be run from a build session.

| half | what it proves | who runs it | state |
|---|---|---|---|
| **Mechanical** — `test/map1-two-modes.browser.test.mjs` (offline, CI) and section C of `scripts/map1-ux-gate.mjs` (live) | that the page *presents* the two modes distinguishably, and that the round trip works | CI / a runner | **green** |
| **Human** — the moderator script below | that ordinary homeowners *actually understand* it | the founder, with 3–5 non-technical participants | **NOT RUN** |

⚠️ **No participant has been recruited, moderated, or observed.** Nothing in this repo can do
that, and a scripted browser walkthrough is not a substitute: it proves what the page *says*,
never what a person *concludes*. Do not record a PASS on the human half from automation output.

---

## The two modes, as the product defines them

**Entire ZIP.** Every development record inside the actual ZIP/ZCTA geography. There is no
centre, no centroid, no representative point and no radius. Where that geography does not
exist yet the page says *"not measured yet"* and offers the address view — it never
substitutes a circle. (`lib/zip-authoritative.js` holds the invariant and its four rules.)

**Near home.** A street address → the production geocoder → the real returned point → the
radius the resident picked (½ / 1 / 2 / 5 miles). The whole answer is radius-shaped, and the
page says so.

These are two geographies, not two views of one dataset. The gate exists because a resident
who confuses them reads a half-mile answer as a whole-ZIP answer, or the reverse.

---

## What the page now says in each mode

| surface | Entire ZIP | Near home |
|---|---|---|
| kicker | `Development overview` | `Near-home view` |
| H1 | `<Town> (<ZIP>)` | `Development around this address` |
| results heading | `All development across ZIP <ZIP>` | `Showing development within <radius> of` |
| line under it | `ZIP <ZIP> · the whole ZIP boundary, not a radius around its centre` | the matched address |
| map caption | `All development across <place> · nearby facilities for context` | `Development within <radius> of this address · nearby facilities for context` |
| development counter | `New projects proposed across this ZIP` | `New projects proposed nearby` |
| facility counter | `Nearby regulated facilities` | `Regulated facilities nearby` |
| radius control | **absent** | present |
| 3D "From home" camera | **absent** | present |
| HOME pin | **absent** | one, at the geocoded point |
| way back | — | `← Back to all development in ZIP <ZIP>` |

The facility counter never says "across this ZIP" in either mode: EPA FRS facilities are a
nearby contextual layer, not a whole-ZIP measurement. That distinction predates this work and
is asserted by the live gate (A9c).

### The three ZIP states, which must never look like each other

A resident has to be able to tell "we measured and found none" from "nobody has measured this
yet". They are different facts, and `null` is not `[]` (rule 1 of `lib/zip-authoritative.js`).

| authoritative read | development counter | the sentence beneath it |
|---|---|---|
| `boundary_complete`, projects found | the real number | `N projects across the whole of ZIP <ZIP>.` |
| `boundary_complete`, genuinely empty | **`0`** — a real, authoritative zero | `No qualifying development records across ZIP <ZIP>. This is a measurement of the whole ZIP, not an empty search.` |
| `not_measured` / `unknown` / unreadable | **`—`**, never `0` | `Development coverage for ZIP <ZIP> is not measured yet — we will not estimate it from a circle around the ZIP centre. Enter your street address for the live view around your home.` |

The em dash exists because an unmeasured ZIP has its radius-derived development **discarded**
rather than passed off as whole-ZIP — so the surviving count is `0` because it was thrown away,
not because the ZIP is quiet. Printing `0` there would state a measured zero the data cannot
support. *(Finding originally made in PR #1070 and preserved under the single-owner
consolidation.)*

---

## The moderator script — run this with 3–5 non-technical participants

Recruit people who do **not** work in software, planning or real estate. Give no coaching. If
a participant asks what something means, answer only *"what do you think it means?"* and
record the answer. Screen-share or sit beside them; record what they say, not what they click.

Start each participant on `https://homesignal.net/development/<their own ZIP>` if they have
one in coverage, otherwise `https://homesignal.net/homesignalmap.html?zip=78617`.

### Task 1 — find all development across a ZIP
> "Show me everything being built or proposed in this whole ZIP code."

PASS when: they stay on the ZIP view and point at the map or the rails, unprompted.
FAIL when: they type an address first, or ask whether this is "just nearby".

### Task 2 — search a real address
> "Now show me what's happening near this address." *(give them a real street address)*

PASS when: they use the address box and reach a result without help.

### Task 3 — change the radius
> "Show me a wider area around that address."

PASS when: they find the radius control and the heading they read back names the new distance.

### Task 4 — the critical comprehension question
> "Right now, are you looking at the whole ZIP code, or an area around that one address? How
> do you know?"

PASS when: they answer correctly **and** can name at least one thing on screen that told them.
**This is the task the whole gate is for.** Ask it again after Task 6.

### Task 5 — open a project and find the official source
> "Pick something on the map. Where did this information come from? Can you get to the
> original record?"

PASS when: they open a marker and reach the official record link.

### Task 6 — the not-measured state
Send them to a ZIP whose coverage is not measured yet.
> "What is this page telling you here? Is it saying nothing is happening?"

PASS when: they distinguish *"nobody has measured this yet"* from *"there is nothing here"*.
FAIL when: they read it as "no development in my area" — that is the misunderstanding the
wording exists to prevent.

### Also record, unprompted
- Did anyone read a near-home count as a whole-ZIP count, or the reverse?
- Did anyone believe the ZIP view was drawn around a centre point?
- Did anyone get stuck in address mode and not find the way back?
- Did anyone read `0` and `not measured` as the same thing?

### Scoring

| participant | T1 | T2 | T3 | T4 | T5 | T6 | confused ZIP-wide vs near-home? |
|---|---|---|---|---|---|---|---|
| P1 | | | | | | | |
| P2 | | | | | | | |
| P3 | | | | | | | |
| P4 | | | | | | | |
| P5 | | | | | | | |

**The gate PASSES only when every participant completes Tasks 1–3 and 5 without coaching, and
no participant confuses ZIP-wide results, near-home results, `0`, and `not measured`.**
One participant failing Task 4 or Task 6 fails the gate — those two are comprehension, not
discoverability, and a wording problem that fools one homeowner fools many.

If it fails, the fix is wording on the surfaces in the table above. Change one, re-run
`node test/map1-two-modes.browser.test.mjs`, and re-test with fresh participants.

---

## A trap in the mechanical half, so the next suite avoids it

**Do not serve Leaflet from a hardcoded `node_modules/leaflet/...` path.** The repo has no
`package.json`, and `unit-tests.yml` installs **playwright alone** into a scratch directory
*outside* the checkout — so `node_modules/leaflet` exists on a dev machine and never on a
runner. A hardcoded `readFile` throws `ENOENT` inside the Playwright route handler and kills
the suite **before a single assertion prints**.

Use the shape `test/map1-dual-identity.browser.test.mjs` already uses: `require.resolve(
'leaflet/dist/leaflet…')`, and `route.continue()` to the CDN the page already names when that
fails. A missing map then shows up as red assertions rather than as a crash.

🔑 **The wider lesson: a crash and a clean pass both print zero failure lines.** Searching CI
output for `FAIL` will not find a suite that died before it could report. Attribute a red job
by the runner's non-zero exit count, never by the absence of failure text.

## Running the mechanical half

```
# offline, deterministic, no production service touched
node test/map1-two-modes.browser.test.mjs

# against the live site (needs egress)
BASE=https://homesignal.net ZIP=78617 node scripts/map1-ux-gate.mjs
```

## Known, deliberately NOT changed

- **The ZIP-mode `Proposed` tile can read lower than the "N projects across the whole of ZIP"
  line.** They count different things — the tile is the Proposed rail, the line is every
  qualifying project regardless of stage — and the live gate asserts the tile equals the set
  actually drawn (A8). Reconciling the two wordings is a copy decision, not a defect, and was
  left alone rather than bundled into a clarity pass.
- **Facilities are still radius-derived in ZIP mode.** That is Session B's geography and is
  labelled honestly as "nearby" everywhere it appears; it is not a whole-ZIP claim.
