# Data center significance — the bounded improvement (2026-09-06)

Second and final unit on Data Center significance, implementing exactly the four
improvements an adversarial competitor-CTO audit of `96eade0` justified. That audit found
**no correctness defect** — 0 false Major, 0 false Ancillary, no geography, classifier or
dual-identity regression — and two resident-facing weaknesses plus one latent risk.

---

## 1. What the audit proved, and what this unit changes

| audit finding | change |
|---|---|
| `Ancillary work` asserts a MAGNITUDE ("minor") that no evidence establishes | the label is **gone**; the resident now reads the activity the issuing authority named |
| 16 records / 79 rows whose own wording proves work on an EXISTING data centre sat in the unknown bucket | new state **Work on existing data center** |
| `\bshell\b` could read `SHELL TI` as major at national scale | TI added to the major veto (**preventive** — 0 such records exist today) |
| `Significance not stated` reads as HomeSignal's finding | → **Scope not stated by source** |

---

## 2. Gate 1 — the audit's counts reproduced before any rule changed

Measured on production `app_projects`, 2026-09-06, and they close exactly against the
audit: **107 records / 479 rows**, of which Major 5/9, Ancillary 15/46, Unknown 87/424,
and inside that unknown bucket **16 records / 79 rows** carry existing-building evidence.

---

## 3. Final taxonomy — evidence contract per state

| resident-facing state | evidence contract |
|---|---|
| **Major development** | the source states construction of a data-centre building: a new-construction/shell permit class, or "new ground up" / "construct data center" wording. Still subject to its own permit-class veto. |
| **Work on existing data center** | the record's own class or words state alteration · renovation · interior work · tenant improvement · upfit · fit-out. **Claims no magnitude** — not an expansion, not an upgrade, not minor. |
| **the activity itself** — `Sign permit` · `Fire-alarm permit` · `Fire-pump permit` · `Battery-system permit` · `Access-control permit` · `Fire-prevention service request` · `Roof replacement` · `Cooling-tower work` | the issuing authority's own enumerated permit class, normalized to plain English. Normalization, never interpretation. |
| **Supporting work** | supporting activity whose class cannot be safely normalized (neutral fallback; unused on today's corpus). |
| **Scope not stated by source** | identity known, the source establishes nothing further. |

### Explicit precedence — a decision, not regex order
1. **Supporting activity** (most specific — the authority named the exact activity)
2. **Work on existing data center**
3. **Major new construction**, still subject to its class veto
4. **Scope not stated by source**

Ordering (2) before (3) is what makes `SHELL TI` unreachable by the major test and what
lifts the two `ADDITIONS/ALTERATIONS/REPAIRS` records out of silence. Ordering (1) before
(2) is why `IRON MOUNTAIN SC-31 DATA HALL TI` reads **Fire-alarm permit** rather than the
vaguer existing-work state — the more specific truth wins. Verified against all five
production Major records: **none matches (1) or (2)**, so this ordering cannot steal a
major verdict.

---

## 4. Gate 4 — before → after, exact

| state | records before | rows before | records after | rows after |
|---|---:|---:|---:|---:|
| Major development | 5 | 9 | **5** | **9** |
| Ancillary work → *the activity itself* | 15 | 46 | **15** | **46** |
| **Work on existing data center** | 0 | 0 | **16** | **79** |
| Significance not stated → Scope not stated by source | 87 | 424 | **71** | **345** |
| **total (control)** | **107** | **479** | **107** | **479** |

`87 − 16 = 71` and `424 − 79 = 345`. **Major is unchanged. Nothing was reclassified to
reach a number.** Unknown falls from 81% to 66% of records purely by no longer discarding
evidence HomeSignal already held.

⚠️ **Measurement note.** The corpus-scale mirror reaches the corpus through two ILIKEs
(`%data cent%`, `%data hall%`), which covers **104 of 107 records / 475 of 479 rows**. The
three records outside that reach — `ALT All reviews completed under COM-ACC-25-000051 …
Datacente`, `Hewlett Packard- Site 2 EcoPOD`, `Norwood Park, Replat of Lots 2-4 …` — were
classified by running the **shipped JavaScript** on their verbatim text: all three are
`unknown`, before and after. `104 + 3 = 107` and `475 + 4 = 479`.

⚠️ **Postgres has no `\b` word boundary — it is `\y`.** The SQL mirror is written with
`\y`; the shipped JavaScript uses `\b` correctly. Mixing them silently under-matches, which
is how the first version of this measurement reported 3 Major instead of 5.

---

## 5. What a resident sees

| record | before | after |
|---|---|---|
| Mesa 285,282 SF ground-up data hall | `Major development · Approved / permitted` | **unchanged** |
| `ADDITIONS/ALTERATIONS/REPAIRS Construct data center and pump house renovations…` | `Significance not stated` | **`Work on existing data center · Approved / permitted`** |
| `QTS DATA CENTER` (class `SIGN  PERMIT`) | `Ancillary work` | **`Sign permit · Proposed / hearing`** |
| `PHX 05-3 DATA HALL 1B BESS PERMIT` | `Ancillary work` | **`Battery-system permit`** |
| `Data Center 123  GREAT OAKS BL` | `Significance not stated` | **`Scope not stated by source`** |

**The magnitude prohibition is asserted, not assumed.** A stationary-battery installation
or a fire-pump job can be substantial; HomeSignal knows the activity and not its size, and
no label — state or activity — may contain *minor · small · insignificant · unimportant ·
low · trivial · negligible · slight*. Tested across every label the system can emit.

---

## 6. Lifecycle interaction — logged, not fixed

The audit found 8 of 15 supporting records rendering `Ancillary work · Proposed / hearing`
where the record is an ordinary open permit, not a public hearing. **That wording comes
from the pre-existing lifecycle map (`STAGE_WORD`), not from this unit.**

The naming change improves it without touching lifecycle — `Sign permit · Proposed /
hearing` at least tells the resident what the permit is for — but **"Proposed / hearing"
is still wrong for a Phoenix `OPEN` sign permit.** Logged as a separate product issue.
Lifecycle was deliberately not redesigned here.

---

## 7. Frozen systems — proven unchanged

- **Data Center identity classifier.** No vocabulary added, removed or edited. The
  significance-only TI veto lives in the significance layer and is never read by identity.
  `permit_class` remains a significance-only carrier: the ZIP-mode site still emits **no**
  `type_raw` key, and `Hewlett Packard- Site 2 EcoPOD` / `Norwood Park, Replat…` still do
  not become data centres.
- **Dual identity.** EPA data centres keep the octagon, the subordinate purple EPA square,
  both filter memberships and one marker; significance stays pinned
  `significanceApplies: false` — an operating facility is not a development record.
- **Filters.** All significance states share one category membership; type filters untouched.
- **Geography.** Nothing read, written or derived. Four records still make four markers.
- **Every other Map 1 type.** industrial · residential · commercial · civic · other carry
  `significance: null` even when their permit class matches a significance vocabulary.

---

## 8. Verification

| suite | result |
|---|---|
| `test/marker-datacenter-significance.test.mjs` | **84 checks, 0 failed** |
| `test/map1-datacenter-significance.browser.test.mjs` | **16 checks, 0 failed** |
| `test/marker-dual-identity.test.mjs` · `map1-dual-identity.browser` | 0 failed |
| `test/user-journey.browser.test.mjs` · `zip-page-hydration.browser` | **0 failed** |
| full offline suite | **148 files, 0 failed** |

**Mutation-proved load-bearing:** removing the existing-work state reddens **9**; removing
the TI veto term reddens **5**; collapsing the specific supporting labels back to one
bucket reddens **12**.

Two of the new tests failed on first run and both were the test's fault, not the code's —
recorded because they are the kind of error that otherwise ships as a false green:
the old veto proof no longer isolated the veto (the record's own NAME says "renovations",
so it now reaches the existing-work state on the name alone, and the proof was rewritten to
use a class that trips the veto without tripping the existing rule), and a truncation
fixture was 118 characters rather than the real 120.

---

## 9. Deliberately NOT in this unit

- **Entitlement / planning category** (15 records / 32 rows) — broader and more ambiguous.
- **Square-footage extraction** (4 records / 6 rows).
- **Expansion** — still rejected; 2 of 5 candidates genuine.
- Entity resolution · national coverage · Epoch.

## 10. Known limitations

1. **66% of records remain `Scope not stated by source`.** The evidence for more does not exist.
2. **`name` is truncated at ~120 characters** by the connectors — 25 of 107 records, including
   3 of the 5 Major. Wording past the cut is invisible; the rules judge only what survives and
   never treat the absence of a suffix as evidence.
3. **96 of 479 rows carry no permit class**, so supporting activity cannot be named on them.
4. **Significance is per RECORD, not per project.** One campus can legitimately show one
   Major and several supporting records; no entity resolution is performed.
5. `Cooling-tower work` is deliberately vaguer than the source (which says *replacement*),
   because the rule matches the equipment rather than the act.
