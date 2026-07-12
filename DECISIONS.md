# HomeSignal Phase 1 — Decisions & Assumptions

> Running log of every non-obvious choice, per build prompt v4. Newest at top of each section.
> Items marked **⚠ NEEDS SIGN-OFF** are the review-gate decisions in `PLAN.md` §9 — I have NOT
> acted on them yet.

## Stack & placement
- **Vanilla HTML/CSS/JS in `homesignal-site`, no framework/build step.** Confirmed by build prompt
  v4 (which explicitly supersedes v3's Next.js). Supabase anon key + RLS from the browser;
  ingestion/scoring in the `homesignal-ingest` Python engine. Matches both repos' CLAUDE.md.
- Design tokens + component CSS come **verbatim** from the mockup's `:root`/`<style>`; shipped as
  `app.css`, no Tailwind, no restyle.

## ⚠ NEEDS SIGN-OFF (review gate — see PLAN.md §9)
- **A — Live-page collisions.** `index.html`, `dashboard.html`, `community.html`, `contact.html`,
  `privacy.html` already exist and serve homesignal.net. *Proposed:* build new/colliding
  homepage+dashboard under an `app/` namespace and swap at sign-off; **extend** `community.html`
  in place additively; **update** `contact.html`/`privacy.html` in place. Not yet done.
- **B — Shell injection method.** Runtime `fetch()`-and-inject `partials/shell.html` vs. a
  build-free generator that inlines it per page. *Proposed:* runtime fetch-and-inject.
- **C — Schema reconciliation.** Live DB is keyed by `community_id uuid` + `zip_codes[]`, not the
  prompt's `community_zip`; live `alerts`/`meetings`/`communities`/`user_subscriptions`/
  `contact_messages` already exist. *Proposed:* additive columns on live `communities`; new tables
  for `projects`/`changes`/`properties`/`follows`/`watchlist_items`/`community_requests`/
  `premium_waitlist`; reuse live `contact_messages`; map `topic_prefs` onto `user_subscriptions`.
- **D — Branch/PR.** Develop on `claude/new-session-f6p7jj` in both repos; no PR until asked.

## Product/UX assumptions (from the prompt, will apply once building)
- **Consent checkbox defaults UNCHECKED** — the Privacy page states sharing is off unless chosen,
  and a pre-ticked consent box is invalid under GDPR; policy wins over the mockup's default.
- **Omit** the modal helper line "Try 78657 (covered) or 90025 (not covered yet)." — mockup
  scaffolding, not product copy.
- **Following multiple properties is free** (no gating on property count).
- **Distances are always computed** from the active property's lat/lng (PostGIS), never stored;
  the mockup's printed distances are the computed value for the default home.
- **Reports render on the fly** from existing data — no `reports` table.
- **Map is a schematic SVG behind a swappable `MapProvider`**; Satellite/Street and Flood/Schools
  layers are rendered-but-disabled with the "Available with live map provider" tooltip unless real
  data exists for the community.
- **Del Valle 78617 is community #1 through the shared code path** — never special-cased; the
  mockup's Horseshoe Bay content is sample data and is replaced by sourced Del Valle content.
- **No paid keys to run:** no paid map provider, no paid LLM; plain-language text is templated with
  a seam for a self-hostable LLM later.

## Reconciliation notes (live repo realities discovered while planning)
- `topics.js` taxonomy (`government_notice` + universal News/Emerging/Global Best Practices with a
  fixed 12-topic universal list) **differs** from the mockup's topic-picker categories
  (gov / meetings / news / dev). At build time the topic picker will be wired to the **live**
  taxonomy where a category maps (so email matching keeps firing), and any mockup-only category is
  logged here before shipping. Not yet reconciled — pending Decision C.
- Del Valle 78617 already has `docs/del-valle-78617-development-reports-seed.sql` and Texas
  community rows; Travis County real feeds (Granicus/Legistar/CivicClerk/EPA-ECHO/TCEQ) already
  exist in the engine. The seed step will **reuse/cross-check** these rather than invent parallel data.
