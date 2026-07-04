# Community Build — Source of Truth (SITE / front-end side)

> **Purpose:** end the per-community guessing on the **website** side, so a build
> session can onboard a community **end-to-end, unattended, overnight**, without
> stopping to ask. This is the companion the engine repo keeps pointing at as
> *"homesignal-site/CLAUDE.md / the site source-of-truth"* — it now exists.
>
> **Two rules govern this whole document:**
> 1. **Precedence wins.** If this doc disagrees with the **live Supabase DB** or the
>    **actual code**, the DB/code win and this doc is the bug — fix the doc. (Order
>    of authority is `CLAUDE.md` §1.)
> 2. **Never guess, never from memory.** Every instruction here was checked against
>    the live DB (`qwnnmljucajnexpxdgxr`) and the code on the branch it was written
>    from (file:line anchors below). Before you act on any claim, re-verify it the
>    same way. A claim you cannot verify is not a fact — mark it and stop.
>
> This is the **long reference**. `CLAUDE.md` §3 is the short runbook; when they
> overlap, they must say the same thing. The **engine/ingest** half lives in
> `homesignal-ingest/CLAUDE.md` + `homesignal-ingest/docs/community-build-source-of-truth.md`.

---

## STEP 0 — THE FIRST MINUTE: permissions & environment (do this before anything)

**All permission and environment needs are front-loaded here.** Handle them in the
first minute of the session, once — then the rest of the build runs with no prompts
and no stops. Do **not** start editing data or files until Step 0 is green.

Run this self-check first:

```bash
cat .claude/settings.json          # this repo ships bypassPermissions + allow-list
```

Checklist (all must be true before you build):

1. **Permission mode = Bypass permissions.** This repo ships
   `.claude/settings.json` with `defaultMode: bypassPermissions` + an allow-list
   (`mcp__Supabase`, `mcp__github`, `mcp__Claude_Code_Remote`, Bash). A **fresh**
   session that starts with this repo in scope boots clean. If you are already
   mid-session, set the web-UI permission mode to **Bypass permissions** manually —
   a committed file cannot flip a running session.
2. **Both repos in the environment's sources, from the start.** Add **`homesignal-site`
   AND `homesignal-ingest`** to the environment's sources *before* launching, then
   start a **fresh** session so both repos' bypass configs load. Adding a repo
   **mid-session (`add_repo`) does NOT apply that repo's `bypassPermissions`** and the
   "always allow" button often won't appear — this is a known trap from the Eagle
   Mountain build. Site work alone (a DB row + this repo) does **not** need the ingest
   repo; you only need it to wire content feeds (Step 3 of the runbook).
3. **Network egress (only if you must research sources here).** The pure-site path
   (insert a DB row, verify the page) needs only Supabase + this repo and works under
   any policy. If the task also needs to *research* government sources, the environment's
   network policy must allow the government/news hosts (`utah.gov`, county sites,
   CivicPlus/Granicus/CivicClerk, Google News). If it doesn't, that research is an
   **ingest-repo, web-enabled-session** concern — the site build is not blocked by it.

> These are **environment** settings (owner: founder/admin) — a session cannot change
> its own network policy or sources. If they're unset, do the part you can (the DB row
> + page verify) and note precisely what's deferred and why. Never silently skip.

---

## 1. The model: two repos, two layers — what THIS repo owns

Adding a community touches two repos. Keep the boundary crisp:

| Layer | Repo | Owns | Cost to add a community |
|---|---|---|---|
| **SITE / presentation** | `homesignal-site` (here) | the public page a resident sees, the sign-up/follow flow, and the **read** of `alerts`/`meetings`/`communities` from Supabase | **pure data** — one `communities` DB row (+ optional `communities.js` bootstrap entry). Zero new files, zero deploy. |
| **INGEST / content** | `homesignal-ingest` (separate) | how alerts/meetings get **created** (`feeds.csv`, adapters) and **emailed** (`digest.py`) | config + a known code checklist **in that repo** — see its own source-of-truth doc. |

**This repo never creates content and never sends email.** It renders whatever the DB
holds for a `community_id`. So on the site side, "add a community" is genuinely
**one row** — everything else the resident eventually sees (government notices,
meetings, news) arrives because the **ingest** repo was wired (Step 3), not because
this repo changed.

---

## 2. Sources of truth & precedence (site view)

Highest authority first (full table in `CLAUDE.md` §1). When two disagree, the
higher wins and the lower is the bug:

1. **Supabase DB** (`qwnnmljucajnexpxdgxr`) — the live runtime truth. `community.html`
   reads it directly with the **public anon key** + RLS. This is what users see.
2. **`homesignal-ingest`** — creates the content; a community has no Government Notices
   until its feeds are wired there.
3. **`docs/*.sql`** — schema/DDL of record (parked, applied by hand in the SQL editor).
4. **`topics.js`** — the canonical Pipeline > Topic taxonomy strings used across the
   front-end.
5. **`communities.js`** — front-end **bootstrap/fallback** only (slug→id, ZIP→community,
   a display copy of `governmentTopics`). Its header comment calls itself the "single
   source of truth" — that is **legacy/aspirational**; #1 outranks it.
6. **`docs/*.md`** — intent/specs (`multi-county-plan.md` is the scaling north star;
   this file is the site build reference).

### The string-matching rule (the one that silently breaks things)
An article reaches a user only when the subscription's topic string equals the alert's
`category` string **word-for-word**. The same strings must match in **four** places:
the community pop-ups, the `user_subscriptions` writes, the tags stamped on content
(Zaps / ingest), and `digest.py::CANONICAL_TOPICS` in `homesignal-ingest`. **Never
rename a topic label casually.** A city's own council still maps to the fixed
`'County Commission & county business'` — do **not** "fix" it to `'City Council'`.
Renaming silently breaks matching for existing subscribers.

### Worked example — why #1 (DB) is truth, even when it's the incomplete copy
Box Elder's copies were drifted; the reconciliation (2026-07) is the lesson:

- **Topic drift — and the DB was the SHORT one.** `communities.js` and
  `box-elder.html` listed **9** government topics (incl. `City government (Brigham City)`
  + `City government (Tremonton)`), but the DB row had only **7** — even though the DB
  already held **45 Brigham City + 13 Tremonton meetings** tagged with those exact
  labels. So the source of truth was *under-populated*: on the dynamic
  `community.html` (which reads `government_topics`), a resident couldn't subscribe to
  town meetings that already existed. **Fix: bring the DB row up to 9** (done) — you fix
  the DB to match reality, not the other way round.
- **ZIP drift.** DB `Box Elder County.zip_codes` had **20** ZIPs; `communities.js` had
  **18** (missing `84308`, `84315`). Reconciled `communities.js` → 20.

`community.html` never trusts `communities.js` for topics or ZIPs — it reads the DB row
(§5). **Lesson: the DB (#1) is truth even when it's the *thinnest* copy; a lower copy is
never the source, and an under-filled DB row is itself the bug to fix.**

---

## 3. How a community is modeled (verified live schema)

`public.communities` columns (checked live, 2026 schema):

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `name` | `text` NOT NULL | |
| `county` | `text` | |
| `state` | `text` | |
| `zip_codes` | `text[]` | every ZIP the community covers |
| `created_at` | `timestamptz` | `default now()` |
| `level` | `text` NOT NULL | `default 'county'` — `county | city | zip | neighborhood` |
| `parent_id` | `uuid` | self-ref, for splitting big counties |
| `government_topics` | `text[]` NOT NULL | `default '{}'` — the only per-community topic list |

- **ZIP is the atomic unit.** A community is a named *set of ZIPs* at a `level`; a ZIP
  resolves to the most specific live community that contains it. **How to choose that
  `level` — town vs county — is the geographic backbone: §13** (it follows where the
  government meetings happen).
- **`government_topics` is `NOT NULL default '{}'`** — so a brand-new row is always
  safe to read (empty is valid; the government tile just shows nothing until feeds
  exist). Populate it with **verbatim canonical labels** matching the ingest feeds.
- **Universal topics are shared** (News / Emerging Tech / Global Best Practices —
  `topics.js::UNIVERSAL_TOPICS`); never configured per community.
- **`slug` is a column** (`text`, case-insensitive unique; see
  `docs/communities-slug-migration.sql`) — so `?community=<slug>` resolves against the
  DB. `communities.js` is only a fallback for rows not yet backfilled. Set `slug` on
  every new row (kebab-case of the name). See §6.

---

## 4. THE CANONICAL-PAGE DECISION — dynamic `community.html` (resolved)

This is the one fork that decides whether "add a community" is *one row* or *a page
clone every time*. It is **resolved in favor of the dynamic page**, and the decision
is not this doc's to reverse — it is already the law of this repo:

- **`CLAUDE.md` §0 (prime directive):** *"No per-community HTML files… `box-elder.html`
  and `eagle-mountain.html` are legacy launch pages, **frozen — do not clone them**."*
- **`docs/multi-county-plan.md` §0 (scaling mandate):** *"No per-county files. ONE
  dynamic community page… (Retire `box-elder.html`.)"*

**Standing decision: a new community is served by the dynamic `community.html` from its
DB row. Do NOT clone `box-elder.html` / `eagle-mountain.html`.**

### Reconciling the contradiction with the ingest docs (read this once)
The engine repo's `docs/community-build-source-of-truth.md` **§5.B leaves this open**
("which page is canonical?") but its **§12 no-stop playbook pre-answers "Clone
`box-elder.html`"** for SEO. That instruction is **superseded on the site side** by the
two authorities above. If you are following the ingest playbook and hit "clone the
page," **stop and use the dynamic page instead**, and (if the ingest repo is in scope)
update its §12 answer so the two repos agree. The clone path was how communities #1–#2
(Box Elder, Eagle Mountain) actually shipped — those pages are **frozen legacy**, kept
live for SEO, not templates for #3+.

### The one real argument for cloning was SEO — here's how to keep it without clones
Cloning gave each community an indexable URL with its own `<title>`/`canonical`/`og:*`
(real acquisition value). A `?id=<uuid>` query-string URL ranks poorly. **The correct
way to get both scale and SEO is NOT to clone 100 HTML files** — it's to make slugs
pure data and give the dynamic page real per-community metadata:
1. ✅ **`slug` column on `communities`** — done (§6); `?community=<slug>` needs no JS entry.
2. Serve a **clean per-community path** (e.g. `/c/<slug>`) that maps to `community.html`,
   and set the page's `<title>`/`canonical`/`og:*` **dynamically from the DB row**. (Still
   to do — the SEO polish.)
3. Add each live community as one `<url>` line in `sitemap.xml`.

That is a **one-time engineering investment** (not per-community work) that preserves
the zero-touch model. `?id=`/`?zip=`/`?community=<slug>` already make every new row live;
the remaining metadata polish is a follow-up, never a reason to clone.

---

## 5. Verified front-end behavior (anchor edits to code, not memory)

Before editing `community.html`, confirm these still hold (grep, don't trust line
numbers — they rot). Verified on this branch:

- **Resolution** — `resolveCommunity()` (`community.html:1036`): reads URL params
  `id`, `community`/`slug`, `zip` and queries Supabase (DB is source of truth):
  - `?id=<uuid>` → `communities?id=eq.<id>&select=*`
  - `?community=<slug>` → `communities?slug=eq.<slug>&select=*` (falls back to the
    `communities.js` slug→id map only if the DB has no slug match)
  - `?zip=<zip>` → `communities?zip_codes=cs.{<zip>}&select=*` (array containment)
  - defaults to **Box Elder** (`COMMUNITY_ID` seed at `community.html:516`) if nothing
    resolves.
- **Government tile** — `applyCommunity()` (`community.html:1064`) sets
  `cats.meetings.items = COMMUNITY.government_topics` (`1071`). **This is why the
  DB `government_topics` must be canonical** — the tile renders the array verbatim.
- **Content reads** — alerts: `alerts?community_id=eq.<id>` (`community.html:526`);
  meetings: `meetings?community_id=eq.<id>&meeting_date=gte.…` (`community.html:933`).
- **Sign-up write** — the follow RPC uses `p_community_id: COMMUNITY_ID`
  (`community.html:782`), which `resolveCommunity` has already set to the resolved row.

**Consequence you can rely on:** a brand-new DB row is immediately reachable and correct
at `community.html?id=<uuid>` and `community.html?zip=<covered-zip>` with **zero repo
change**. That is the pure-data path.

---

## 6. Known scaling gaps + the fix (so they don't block true zero-touch)

Two of the three original gaps are now closed; the third is fallback hygiene.

1. ✅ **`index.html` homepage ZIP search now queries `communities`** (source of truth)
   via `resolveCoverageUrl`: a covered ZIP routes to its bespoke launch page if one
   exists (Box Elder / Eagle Mountain — SEO), else to `community.html?zip=…`; on a DB/RLS
   error it degrades to the waitlist modal (never a broken link). The inline `COMMUNITIES`
   array is now **only** the legacy bespoke-page map, not the coverage source. New
   communities route from the homepage with no repo change.
2. ✅ **`communities` has a `slug` column** (`docs/communities-slug-migration.sql`;
   `text`, case-insensitive unique, backfilled for the two live rows) and
   `resolveCommunity` queries the DB by slug — `communities.js` is fallback-only. Pretty
   URLs are now pure data. **Set `slug` on every new row.**
3. ⚠️ **`communities.js` drifts from the DB** (§2). **Fix (open):** treat it strictly as
   a thin fallback — or generate it from the DB — and never hand-edit topics/ZIPs into it
   as if it were truth. Not a runtime bug (the DB wins), just hygiene.

---

## 7. RUNBOOK — add a community (site side), no stops

Standing authority: do this end-to-end without pausing (Step 0 already cleared prompts).

1. **Insert the DB row** (`mcp__Supabase__apply_migration`, project
   `qwnnmljucajnexpxdgxr`). Idempotent form — **use verbatim canonical topic labels**
   (they must equal the ingest `CANONICAL_TOPICS` word-for-word; `[]` is a valid start):
   ```sql
   insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
   values (
     'Tremonton, Utah', 'Box Elder', 'Utah',
     array['84337'],                 -- every ZIP the community covers
     'city',                         -- county | city | zip | neighborhood
     array[]::text[],                -- fill once feeds exist (step 3); [] is valid
     'tremonton'                     -- kebab-case slug -> enables ?community=<slug> as pure data
   )
   on conflict do nothing;
   ```
   For a sub-community of an existing county, also set `parent_id` to the parent's `id`.
   Capture the returned `id`.
2. **Verify it resolves** (this is "verify" on a static site — there is no test suite):
   `select id, name, level, zip_codes, government_topics from public.communities order
   by name;` then load `community.html?zip=<a-covered-zip>` **and** `?id=<uuid>` and
   confirm the header names the community and the government tile lists exactly the DB
   `government_topics`. No alerts/meetings yet is expected — content comes from Step 3.
3. **Wire the content feeds** in `homesignal-ingest` (separate repo). Add the community's
   government feed rows to `feeds.csv` keyed by `community_id`, and make its government
   labels match the DB `government_topics` **word-for-word** (§2 string-matching rule).
   Universal-topic content flows automatically. *If that repo isn't in the session, add
   it and do it there; if you can't, state explicitly that Government Notices stay empty
   until feeds are configured — don't leave it implied.*
4. **(Optional)** the `slug` from step 1 already makes `?community=<slug>` work from the
   DB. Add a `communities.js` bootstrap entry (`slug`, `id`, `name`,
   `page: 'community.html'`, `zips`, `governmentTopics`) only if you want the dashboard
   registry / offline fallback to know it too. **Point `page` at `community.html`, never
   a per-community file.** Not required for the community to be live.

**Do NOT** create a new `<community>.html`, and **do NOT** edit the frozen
`box-elder.html` / `eagle-mountain.html`.

---

## 8. Cross-repo contract (site ↔ ingest) — keep the four copies in sync

The same government-topic list can live in up to four places; they must agree, and the
engine's copy is authority for *whether email fires*:

| Copy | Where | Role |
|---|---|---|
| `digest.py::CANONICAL_TOPICS` | ingest repo | **engine authority** — a `category` not in it is silently dropped (never emails) |
| `communities.government_topics` | Supabase | **site authority** — drives the `community.html` government tile |
| `communities.js` `governmentTopics` | this repo | bootstrap/fallback display copy |
| `cats.meetings.items` | `community.html` (rendered from the DB row) | runtime display |

**Rules:**
- Create the DB row with the **canonical strings** — never hand-enter city-friendly
  variants (`"City Council & city business"`, `"Water & utilities"`). The engine drops
  them and those subscribers silently never get email. (This was the Eagle Mountain
  "label drift" bug; EM's row is now canonical.)
- A change that spans **both repos** is fine to do *within an approved community build*
  (that's the whole workflow), but keep the two sides consistent in the same pass.

---

## 9. No-stop standing answers (site side)

Pre-approved defaults from the Box Elder + Eagle Mountain builds — **apply without
asking.** (Only §10 warrants a pause.)

| Recurring question | STANDING ANSWER |
|---|---|
| Clone a page or use the dynamic one? | **Dynamic `community.html`.** Never clone. (§4) |
| For a **city**, rename topic #1 to "City Council"? "Water & utilities"? | **NO.** Verbatim canonical strings: `County Commission & county business`, `Water companies`, etc. The engine matches exact strings. |
| How to create the `communities.government_topics` value? | **Canonical strings only** — never city-friendly variants (they get dropped by the digest). |
| Is a new row immediately live? | **Yes**, at `?id=`/`?zip=` — no repo change, no deploy. (§5) |
| Empty government tile on a fresh community? | **Expected** until ingest feeds exist (Step 3). `government_topics` may start `[]`. |
| Global Best Practices / Emerging tiles empty? | **Already solved, one-time** — those tiers are community-agnostic on both pages (Eagle Mountain build). Zero per-community work. |
| Homepage ZIP search doesn't find the new community? | **Fixed (§6.1)** — the homepage now queries `communities` and routes covered ZIPs to `community.html?zip=…` (or a bespoke launch page if one exists). A new row is found with no repo change. |
| Add to `sitemap.xml`? | Yes — one `<url>` line per live community (cheap, SEO). |
| Open a PR? | Only if asked. Data changes (the DB row) go live via Supabase, **not** a repo push. |

---

## 10. STILL STOP AND ASK — the only real exceptions

Everything else above is pre-approved. Pause only for:

- **A ZIP already belongs to a different live community** — an overlap/policy call.
  *(Single-community/manual mode only. In the batch runbook this does NOT stop: a
  county/city overlap is expected and resolves by `level`+`parent_id`; a same-level
  collision quarantines the row and the run continues — §12.4.)*
- **The schema genuinely doesn't support what's needed** (a new column/table beyond §6's
  known ones) — surface it, write the DDL into `docs/*.sql`, don't improvise on live data.
- **Anything touching secrets, money, PII, or the subscriber list** — never expose a
  service-role key in a shipping file (anon key only); never print or relocate a secret.
- **A destructive DB change** (deleting/retiring a needed row).
- **A legal/consent change.**
- **A genuinely new architectural fork** not covered here — decide with the founder, then
  record the answer in this doc so #N+1 doesn't re-ask.

---

## 11. Why these rules earn their keep (user value + investor value)

- **User value:** a resident anywhere gets a working community page the moment their row
  exists — correct name, correct topics, real local notices once feeds are wired. No
  half-built clones, no wrong labels silently eating their subscription.
- **Investor / data-asset value:** the model scales to all ~3,144 counties as **data,
  not code**. Onboarding cost stays flat as coverage grows; the `communities` +
  `events` + subscription tables become the compounding asset. Every rule here (DB as
  truth, no per-community files, canonical labels, SEO-without-clones) exists to keep
  that curve flat and the data clean.

> **This document is instructions for building *correctly*, not fast.** If speed and
> correctness ever conflict, correctness wins — and if you cannot verify a fact, you
> stop and check it, you do not guess.

---

## 12. Onboarding at scale (100 → 3,144) — the unattended batch runbook

> **Why this section exists:** §7 onboards ONE community by hand. To stand up
> **1,100+ communities and run overnight without pausing**, you drive the *same*
> data model in bulk. **Nothing about the model changes** — a community is still one
> `communities` row; a batch is just many rows, inserted idempotently, validated, and
> verified programmatically. There is no new page, no per-community code, no deploy —
> that is the whole point of §0's "communities are DATA." Executed via the Supabase
> MCP (generate `INSERT`s from the seed) — no app code, consistent with "no build step."

### 12.0 The one thing that must never be guessed: the community master dataset
Everything else here is procedure; **this is the rule that makes scale *correct*.** The
identity data — name, state, county, FIPS, **ZIPs**, slug — must trace to **one
authoritative public dataset**. Never hand-type or infer a ZIP.

- **Pin the dataset at Step 0** (then treat it like source #3 seed data — reproducible):
  - **ZIP ↔ county mapping:** an authoritative crosswalk — e.g. the U.S. Census
    **ZCTA–county relationship file**, or a maintained **HUD–USPS ZIP crosswalk**.
    ⚠️ **Confirm the exact file + vintage before the run** (do not assert it from
    memory). **ZCTA ≠ USPS ZIP** exactly — pick **one** crosswalk and pin it; two runs
    on different vintages can drift ZIP membership.
  - **County / place identity + FIPS:** a Census gazetteer / county list (same vintage).
- **Freeze the chosen seed in the repo** (`docs/seeds/communities-seed.csv`) with its
  source + vintage in a header comment, so any run is reproducible and auditable.
- If the dataset can't be confirmed/pinned, **that is a Step-0 stop** (§12.6) — a
  guessed ZIP is the one error this whole doc exists to prevent.

### 12.1 The seed format (what the batch consumes)
One row per community, columns mapping straight to the DB (§3):

```
name, state, county, level, parent_slug, zip_codes, slug, government_topics, fips
```
- `slug` = **deterministic** kebab-case: lowercase → non-alphanumeric runs to a single
  `-` → trim `-`. Disambiguate collisions by appending state then county
  (`springfield` → `springfield-il` → `springfield-sangamon-il`). The rule must be
  stable so re-runs produce identical slugs.
- `level` defaults to `county` for the initial national county pass. City/ZIP
  subdivisions come later as **child** rows (`parent_slug` → the parent county) — see
  **§13.5** for the rule on when to split a town out of its county.
- `government_topics` is normally `[]` at seed time — content is wired later (§12.7).

### 12.2 Validation gates — quarantine, don't stop
Validate every seed row **before** insert. A failing row is written to a **quarantine
log and SKIPPED**; the batch continues (no pause). Checks:
- `name` + `state` present; `state` a valid 2-letter code.
- `level` ∈ {`county`,`city`,`zip`,`neighborhood`}.
- every ZIP matches `^\d{5}$`; ZIP list non-empty; no in-row duplicates.
- `slug` matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is unique **within the batch**.
- `parent_slug` (if set) resolves to a row in this batch or an existing DB community.

Emit a report: *N valid, M quarantined (with reasons)*. **A run with quarantined rows
is still a success** — the quarantine set is the only human follow-up.

### 12.3 Idempotent, resumable load
- Insert in chunks (e.g. 200 rows/statement) with **`on conflict do nothing`** keyed on
  the natural unique key — **`slug`** (now case-insensitive-unique, §6). Re-running skips
  existing rows, so a batch is **safe to resume** after any timeout/failure.
- **Insert-new-only. Never blind-UPDATE** existing rows in a bulk pass — it could clobber
  a hand-tuned `government_topics`. Updates go through a separate, explicit path.
- Log per chunk: inserted / skipped-existing / quarantined + running totals. **The log
  is the resume state.**

### 12.4 Overlap policy at scale — so it never pauses
At national scale ZIP overlaps are normal, and the model already resolves the common one:
- **County + city/ZIP overlap → EXPECTED, not a stop.** A ZIP resolves to the *most
  specific LIVE* community (`level` + `parent_id`, §2–§3). Set the child's `parent_id`
  to the county and continue.
- **The only genuine collision is two SAME-LEVEL live communities claiming one ZIP.**
  Standing rule for batch mode: **quarantine the later row + log it** — do not overwrite,
  do not hard-stop. Resolve the quarantined set afterward. (This converts §10's
  "stop on ZIP overlap" into a non-blocking quarantine at scale; only a *state-wide*
  systematic collision warrants a real pause.)

### 12.5 Verify at scale — programmatic, not 1,100 page loads
- **Count reconciliation:** rows inserted == valid seed rows − skipped-existing.
- **Resolution probe:** for a random sample **and** every parent/child ZIP boundary,
  query `communities?id=eq…`, `?slug=eq…`, `?zip_codes=cs.{zip}` and assert exactly one
  *most-specific* hit.
- **Render probe:** load `community.html?zip=…` / `?community=<slug>` for the sample;
  assert the header names the community and the government tile renders (empty is valid).
- **Homepage probe:** `resolveCoverageUrl(sampleZip)` returns a routing URL (the §6.1 fix
  means new rows route from the homepage with no repo change).

Log a scale-verification summary. A failed probe quarantines that community for review;
the run result still stands.

### 12.6 The overnight operating contract (batch no-pause policy)
- **Step 0 done once:** permissions + both repos (§Step 0) **and** the dataset pinned (§12.0).
- **The batch:** validate → load idempotently → verify → log. It runs to completion
  unattended and its **deliverable is the DB rows + a run log** (inserted / skipped /
  quarantined / verified). The quarantine list is the only human follow-up.
- **NEVER pauses for:** ordinary county/city overlaps (§12.4), empty `government_topics`,
  missing feeds (content is decoupled, §12.7), or any individual bad row (quarantine).
- **STOPS only for** (extends §10, kept deliberately tiny): the master dataset is
  unavailable or its vintage unverified (§12.0); a schema/DDL need beyond the known
  columns; anything touching secrets/PII/subscriber data; or a *systematic, state-wide*
  same-level collision policy question (a single-row collision quarantines, it does not
  stop). Everything else logs and continues.

### 12.7 Content & delivery are decoupled — never block the batch on them
A community is **live on the site the moment its row exists** (empty tiles are valid).
Government Notices / News arrive later via `homesignal-ingest` feeds (§8, §7 step 3);
Universal topics flow automatically. **Do not hold the site batch waiting on feeds** —
wiring feeds for 1,100 communities is an ingest-side scale problem with its own runbook
in `homesignal-ingest`. The site batch's job is only to make the **rows and pages** exist.

---

## 13. The geographic backbone — a community's LEVEL follows where the meetings happen

> **The rule that decides town vs county.** A community's `level` is set by **the unit
> of government whose public meetings a resident would physically show up to** in order
> to act. Meetings drive civic action — so the model's one job here is to always route a
> resident to *the specific meeting where their lever is* (city council for a city
> matter, county commission for a county matter). Get the level wrong and you send
> someone to the wrong room. The schema already supports all of this (`level`,
> `parent_id`, `zip_codes`, `government_topics`, §3) — what was missing is this rule.

### 13.1 The granularity ceiling is set by the STATE'S notice system
You can only split as fine as that state actually **publishes** meetings/notices:
- **Centralized state portal with per-body IDs** (e.g. Utah **PMN**) → per-city is easy;
  each council/planning body is a distinct source. (Eagle Mountain = one city, one
  council body, one ZIP.)
- **Per-municipality platforms** (CivicPlus / Granicus / Legistar / CivicClerk) →
  per-city is natural but assembled city by city.
- **County-only / newspaper-of-record** (many rural areas) → the **county** is the
  finest unit you can build; towns have no separately-published meeting.

**Determine this per state at research time — never assume.** The state's architecture
is the ceiling; the governance structure below is the floor.

### 13.2 The decision variables (the "when to expand" checklist, in order)
1. **Incorporation status.** An **incorporated municipality** (own elected council) is a
   candidate for its own `level=city` community. An **unincorporated** area has *no*
   separate meeting — the **county** governs it — so it stays part of the county
   community. This is the hard floor: never mint a community for a place that has no
   government of its own to attend.
2. **A distinct meeting/notice source exists** for that place in the state system
   (§13.1). If a town's council meetings aren't published anywhere findable, you
   physically cannot route residents to a town meeting → keep them at county. **Verify
   the source returns real notices first** (§8; the ingest rule 4).
3. **State notice architecture** — the ceiling (§13.1).
4. **Salience / demand** — population, local identity, subscriber interest. This decides
   *packaging* (own page vs topic), **not** whether the meeting is reachable.

### 13.3 Two structural patterns — same rule, different packaging
| Pattern | Shape | Use when | Example |
|---|---|---|---|
| **City = its own community row** | `level=city`, `parent_id`=county (if the county is a live community) | incorporated, has its own meeting source, salient enough to warrant a dedicated page + signup | **Eagle Mountain** (one city, one ZIP `84005`, one council body) |
| **City = a government topic inside the county community** | a `City government (X)` label in the county row's `government_topics` | the town is small / demand is low, but you still want its council meetings reachable on the county page | **Box Elder County** → `City government (Brigham City)`, `City government (Tremonton)` |

Both satisfy the prime rule — the resident can reach the town meeting. The only
difference is a **dedicated page** vs a **topic on the county page**, chosen by salience
(#4). Promote a topic-town to its own row when demand justifies a page; never before it
has a verified source.

### 13.4 Impact is DIRECTIONAL — the cascade is the whole product
Government impact flows **one way, downward, through the hierarchy** — and *unifying that
fragmented flow into one place per resident is what HomeSignal is*:

- **DOWN — county → town: INCLUDE.** A county decision (county commission, county-wide
  zoning/roads, county elections, county-scoped meetings) **impacts every town inside
  it**, so it **must appear** in each town resident's feed. "A citizen should always be
  aware of what their county is doing when it impacts their town." This is non-negotiable.
- **UP — town → county: EXCLUDE.** A town's own local business (its city council budget,
  its municipal utility) does **not** impact the rest of the county → it does **not**
  bubble up to the county view or to other towns.
- **SIDEWAYS — town → sibling town: EXCLUDE.** A Tremonton council item is **noise** to a
  Brigham City resident. Siblings never cross.

**A resident's "one unified place" = their most-specific community + everything that
cascades DOWN from its ancestors (county, and later state), MINUS sibling towns.** That
is the fragmented-government problem solved: one feed that merges *my town + my county
(as it affects me)*, and nothing that doesn't.

Mechanically this is: resolve the resident to the **most-specific live** community, then
show content whose scope **covers** them — their own community's items **plus** every
ancestor's (walk `parent_id` up the chain). `multi-county-plan.md` §0a specifies exactly
this ("a county-scoped alert reaches all child communities… `alerts.geographic_reference`
carries the scope").

> ⚠️ **TWO code gaps — both DESIGNED but NOT BUILT; both block the first county→town split.**
> Harmless today only because Box Elder is a *single* county community (county content
> trivially reaches everyone in it) and no live communities share a ZIP. The moment a town
> becomes its own child community, both must ship or the town page is **wrong**:
>
> 1. **Cascade content query is missing.** `community.html` pulls content with
>    `alerts?community_id=eq.<self>` (`:526`) and `meetings?community_id=eq.<self>`
>    (`:933`) — a **single** community_id, no ancestor walk. So a Brigham City page
>    (community_id = Brigham City) would show **zero county-commission meetings** — the
>    exact county-impacts-town content that MUST appear. **Fix before splitting:** resolve
>    the `parent_id` chain and query `community_id IN (self + ancestors)` (or scope-match
>    on `geographic_reference`), filtered by the resident's subscribed topics.
> 2. **Most-specific resolution is missing.** `resolveCommunity()` resolves `?zip=` with
>    `zip_codes=cs.{zip}` and takes **`rows[0]` unordered** — it does not prefer the town
>    over its parent county. **Fix:** rank matches by level (`neighborhood` > `zip` >
>    `city` > `county`), tie-break deterministically (smaller `zip_codes` length, then
>    `id`). The homepage `resolveCoverageUrl` (`index.html`) needs the same ordering.
>
> **Until both land, keep towns as `government_topics` on the county row (pattern B) — do
> NOT split a town into its own community**, or its residents lose the county cascade.

### 13.5 The backbone default for scale (§12)
"Expand from town to county" is really **start at county, split *down* to town where
justified**:
1. **Seed every place at `level=county` first** — always correct (every ZIP has a
   county; unincorporated land has *only* county government).
2. **Promote an incorporated place to its own `level=city` row** (with `parent_id` → the
   county) when §13.2 is satisfied *and* salience (#4) justifies a page. Its ZIP(s) then
   resolve to the city by §13.4.
3. **Or add it as a `City government (X)` topic** on the county row when the source
   exists but demand doesn't yet justify a page.
Record the choice in the seed (`level`, `parent_slug`) so the batch (§12.1) stamps it.

### 13.6 Worked contrast
- **Box Elder County** (`level=county`, `parent_id=null`, 20 ZIPs): a county community
  covering many towns; the incorporated towns (Brigham City, Tremonton) surface as
  `City government (X)` **topics**, not separate rows — pattern B, low-salience towns.
- **Eagle Mountain** (`level=city`, one ZIP `84005`, one council body): a single
  incorporated city salient enough for its **own page** — pattern A. (Its `parent_id`
  is null because Utah County is not itself a live community; a city with no live parent
  is valid — most-specific-live simply has nothing broader to fall back to.)

---

### Provenance
Every schema/behavior claim here was verified against the live DB
(`qwnnmljucajnexpxdgxr`) and the code on the authoring branch: `community.html`
resolution (`1036`), government tile (`1064`, `1071`), content reads (`526`, `933`),
sign-up RPC (`782`); `index.html` homepage routing (`resolveCoverageUrl`/`runZip`);
`topics.js`; and the `communities`/`alerts` schema + RLS state. Re-verify before relying
on any line number — the anchors rot; the DB and code are the truth.
**§12 exception:** the external master dataset (the ZIP↔county crosswalk file + vintage)
is **not** verified in this doc by design — it is a Step-0 confirm before each batch run
(§12.0). Everything else in §12 is procedure/policy over the already-verified schema.
