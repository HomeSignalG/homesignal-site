# Website Community Build — Checklist

> How to add a community to the **site** (the engine side is
> `homesignal-ingest/docs/community-build-source-of-truth.md`). Clone
> `box-elder.html`; do **not** use `community.html` (see root `CLAUDE.md`).

---

## The clone-edit surface (everything you touch — and nothing else)

### 1. The page — clone `box-elder.html` → `<slug>.html`
Change these (and **only** these):

| What | Where in the page | Value |
|---|---|---|
| **`COMMUNITY_ID` — BOTH occurrences** | `const COMMUNITY_ID = '…'` near the top **AND** `p_community_id: '…'` in the signup RPC (~line 1482, a separate hardcoded literal). **Grep the old UUID — there are 2.** | the Supabase `communities.id` UUID **from the engine — never invented** |
| **`cats.meetings.items`** | the `cats` object (the `meetings` tile's `items: [...]`); `cats.notices` derives from it | this community's Government-Notices topics (see rule below) |
| **All display/branding strings** | `<title>`, `<meta name="description">`, `og:title`/`og:description`, `twitter:title`/`twitter:description`, `hs:share-text`, `be-eyebrow`, `<h1 class="comm-title">`, the "In &lt;County&gt;" heading, the two "following … in &lt;County&gt;" save messages | the new community's name (**grep the old county name — ~13 occurrences**) |

**Leave the WIRING byte-for-byte:** `SUPABASE_URL` + anon key, the
`submit-public-form` call, the *shape* of the subscription RPC, alerts/meetings
fetch, `events.js` analytics, and **`cats.news.items` / `cats.emerging.items` /
`cats.global.items`** (the 12 universal subtopics).

### 2. The registry — add one record to `communities.js`
```js
{
  id: '<COMMUNITY_ID>',            // same UUID as the page — from the engine
  slug: '<slug>',
  name: '<Display Name, State>',
  page: '<slug>.html',
  zips: ['…'],                     // this community's ZIPs
  governmentTopics: [ /* identical to the page's cats.meetings.items */ ]
}
```
`governmentTopics` here MUST equal the page's `cats.meetings.items` — same
strings, same order.

### 3. The homepage — nothing to do
`index.html` now loads `communities.js` and routes ZIPs through
`window.HS.zipToCommunity`. Adding the `communities.js` record above makes the new
community's ZIPs route automatically. **Do not add a second ZIP list to any page.**

---

## The one rule: only `cats.meetings.items` varies

- **`cats.meetings.items`** (Government Notices) is the **only per-community topic
  list.** It tracks the exact government feeds that community actually has in the
  engine.
- **`cats.news.items`** = the **12 universal subtopics** (`topics.js` →
  `UNIVERSAL_TOPICS`). These are **global** and shared by News Alerts, Emerging
  Technology, and Global Best Practices. **Never edit them per community.**

So: per community you change `COMMUNITY_ID` + `cats.meetings.items` + a
`communities.js` record. That's the whole site surface.

---

## ⚠️ Cross-repo wedge-label warning

Every Government-Notices label must match **`digest.py::CANONICAL_TOPICS`** in
`homesignal-ingest` **word-for-word** — that hardcoded set is the authority, and a
label not in it is **silently dropped by the digest** (the user gets nothing).

- A community's wedge label (e.g. `<Community> data center project`) must be added
  to `digest.py::CANONICAL_TOPICS` in the **engine repo** as well as here.
- The engine also needs `COMMUNITY_SHORT/FULL/PAGE` entries and the Local-News
  tier `cats` updated, or the digest won't email that community.
- **This spans both repos — coordinate the change with the founder** (root
  `CLAUDE.md`, and the engine's `docs/community-build-source-of-truth.md` §5).

---

## Deploy + verify (never assume)

1. Commit + push on a feature branch; PR only when asked.
2. Load the **live** `<slug>.html`: it renders, the pop-ups show the right topics.
3. From the homepage, type a covered ZIP → it routes to `<slug>.html`.
4. Do a test signup → confirm the row lands in Supabase (`users` /
   `subscriptions`) with the right `community_id`. Verify in the data.
