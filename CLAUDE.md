# HomeSignal Site — Source of Truth

> Read automatically at the start of every session in the **homesignal-site**
> repo. This is the public static website (GitHub Pages). The data engine is the
> companion repo **`homesignal-ingest`** — you do not edit the engine from here.
> A change that spans both repos = stop and confirm with the founder.

---

## The model — clone `box-elder.html`, do NOT use `community.html`

- **`box-elder.html` is THE live, working per-community page.** It is
  self-contained: the community identity (`COMMUNITY_ID`), the signup pop-ups
  (`cats`), the Supabase wiring, and the alerts/meetings rendering all live in it.
- **To add a community, CLONE `box-elder.html`** to `<slug>.html` and change the
  minimum (see the invariant below).
- **`community.html` is the older generic template — do NOT use it for new
  communities.** It has drifted from `box-elder.html`; cloning it reintroduces
  bugs. If in doubt, diff against `box-elder.html`.

## The two shared registries (single source of truth)

- **`communities.js`** — the community registry: `id`, `slug`, `name`, `page`,
  `zips`, and `governmentTopics` per community. The homepage (`index.html`) and
  dashboard load this; **it is the ONE ZIP + topic registry — never keep a second
  copy in a page** (that drift was just removed from `index.html`).
- **`topics.js`** — the pipeline taxonomy + the **12 universal subtopics**
  (`UNIVERSAL_TOPICS`), shared by News Alerts / Emerging Technology / Global Best
  Practices. These are **global — the same for every community.**

## Preserve-the-wiring invariant (the thing that breaks if you're careless)

When you clone `box-elder.html`, the things that change per community are:
1. **`COMMUNITY_ID` — in BOTH places it is hardcoded.** It appears twice: the
   `const COMMUNITY_ID = '…'` near the top **and** the `p_community_id: '…'`
   literal in the signup RPC (~line 1482, which does NOT reference the const).
   **Change both**, or new signups are tagged to the wrong community. (Grep the
   old UUID to be sure you got every occurrence.)
2. **`cats.meetings.items`** — the community's Government-Notices topic list
   (`cats.notices` is auto-derived from it, so this one edit covers both
   government tiles).
3. **Every display/branding string** — the page is full of "Box Elder" copy that
   must become the new community: `<title>`, `<meta name="description">`,
   `og:title`/`og:description`, `twitter:title`/`twitter:description`,
   `hs:share-text`, the `be-eyebrow`, `<h1 class="comm-title">`, the "In Box
   Elder County" group heading, and the two "following these alerts in Box Elder
   County" save messages. (Grep the old county name to catch them all.)

**Do NOT touch** the WIRING: `SUPABASE_URL` / anon key, the `submit-public-form`
Edge Function call, the shape of the subscription RPC, the alerts/meetings fetch
logic, the analytics (`events.js` / `window.COMMUNITY_ID`), or **`cats.news.items`
/ `cats.emerging.items` / `cats.global.items` (the 12 universal subtopics —
global, identical everywhere)**. Changing those is how signup writes, matching,
and analytics silently break.

## Get `COMMUNITY_ID` from the engine — NEVER invent it

The `COMMUNITY_ID` UUID is the Supabase `communities.id`. Get the real value from
the engine (`homesignal-ingest`: the community's `feeds.csv` rows / adapter
manifest / the Supabase `communities` table). **Never make up a UUID** — a wrong
id means the page shows no alerts and signups tag the wrong community.

## Government topic labels — the engine is the authority

Every string in `cats.meetings.items` (and each community's `governmentTopics` in
`communities.js`) must match **`digest.py::CANONICAL_TOPICS`** in
`homesignal-ingest` **word-for-word**. A label not in that set is silently dropped
by the digest, so the user gets nothing for it. Adding a community's wedge label
(e.g. `<Community> data center project`) therefore requires a matching edit in
`digest.py` in the engine repo — a **cross-repo change; coordinate it.**

## Deploy + verify loop

This is a static GitHub Pages site — a push to the deploy branch publishes it.
After any change:
1. Commit + push (feature branch; open a PR only when asked).
2. Load the **live page** and confirm: it renders, ZIP search routes to the right
   page, and the signup pop-ups show the correct topics.
3. Confirm a test signup actually writes to Supabase (`users` / `subscriptions`) —
   **verify in the data, don't assume the form worked.**
4. The site reflects new engine data only after a deploy — the engine fills
   Supabase continuously, the site lags until published.

## Full per-community checklist

See **`docs/website-community-build.md`** — the exact clone-edit surface, the
"only `cats.meetings.items` varies" rule, and the cross-repo label warning.

**The complete two-repo picture** (ingest + delivery + this site) lives in the
engine repo: **`homesignal-ingest/docs/community-build-source-of-truth.md`** and
**`homesignal-ingest/CLAUDE.md`**. Read those for what the engine side must do
(feeds, `digest.py` edits) alongside this site's clone.
