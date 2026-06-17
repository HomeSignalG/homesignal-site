# Multi-County Plan — HomeSignal

> Status: **DRAFT for founder review.** Nothing here is built yet. No live-site changes.
> Drivers for every decision: (1) user-friendly, (2) user value, (3) acquisition / the data asset.
>
> **Decided 2026-06-15:** fold two acquisition foundations into this build now — a **consent & compliance trail** and **metrics & engagement capture** — because both record history you can't reconstruct after the fact. See §2.3 and §3.

---

## 0. Scalability mandate (NON-NEGOTIABLE)

Everything we build must scale to **all ~3,144 U.S. counties**, with a new county added as **pure data — zero engineering**. Every change is judged against these rules:

1. **No per-county files.** ONE dynamic community page, loaded by id/slug from the DB. (Retire `box-elder.html`.)
2. **No hardcoded registries in the browser.** Communities and ZIP→county come from the `communities` table via query — not a static JS array. (`communities.js` → thin bootstrap/fallback only.)
3. **Config as data.** Feeds / topics / communities live in DB tables the engine and site read. Spreadsheets are an *authoring* surface, not the runtime source.
4. **Normalized, indexed data.** Follows in `user_subscriptions` keyed by `(community_id, category)`; matching stays index-fast, never JSON scans. *(done)*
5. **Shared where possible; per-county only as rows.** Universal topics shared across all counties; per-county specifics (government topics, ZIPs) are rows, never code.
6. **No per-county deploy.** The dynamic page queries Supabase live; onboarding a county never requires a site build.
7. **Graceful coverage.** Any ZIP resolves: covered → community page; not-yet-covered → waitlist capture (also an acquisition signal).
8. **Flexible geographic granularity.** The "community" unit is NOT always a county. The ZIP code is the atom; a community is a named *set of ZIPs* at a `level`, so huge counties can be split for real local momentum.

### 0a. Geographic model (proposed)

Large counties (e.g., Los Angeles, ~10M people) have no shared "community feel" — county-wide is the wrong unit there. So granularity must vary:

- **ZIP = atomic unit.** Alerts and subscribers resolve to ZIP(s).
- **A community = a named set of ZIPs + a `level`** (`county` | `city` | `zip` | …), with optional **`parent_id`** for hierarchy:
  - Rural/small county → one row, `level=county`, all ZIPs.
  - Huge county → many rows (`level=city`/`zip`), each a ZIP subset, `parent_id` → the county.
- **A ZIP resolves to the most specific *live* community** containing it (falls back to county if no sub-community is live yet).
- **Cascade matching:** a county-scoped alert reaches all child communities; a city/ZIP-scoped alert reaches just that one. (`alerts.geographic_reference` carries the scope.)

**Schema impact (additive):** `communities` already has `zip_codes`; add `level` and `parent_id`. No re-architecting.

---

## 1. The problem we're solving

- When a logged-in user is on the homepage, there is **no clear way back to their community** — the nav only shows their email + "Log out". They must re-type a ZIP.
- The current data model assumes **one county per user** (`users` table has a single `community_id` + one `topics` list). We cannot support "follow 2 counties" without changing how follows are stored — and that touches **Supabase and the alert engine**, not just the website.

We want to fix the foundation now so adding county #2 (and #50) is *just data*, not a rebuild.

---

## 2′. Revised data model — CONFIRMED from the live Supabase schema (2026-06-15)

> This section **supersedes the original §2 and §3 below**, which were written before we inspected the real database. Kept for history; do not run the §3 SQL as-is.

**What we found in the live schema (6 users, pre-launch):**
- ✅ `communities` **already exists** (`id, name, county, state, zip_codes, created_at`) — no need to create it.
- ✅ `user_subscriptions` **already exists** and is the purpose-built per-county follow table: `id, user_id, community_id, pipeline_type (text), topic (text), created_at`. It is **empty** — never written to.
- `users` = `id, email, zip_code, created_at, data_licensing_agreed (bool), community_id, topics (jsonb)`.
- The website (`box-elder.html`) currently writes follows into **`users.topics` + `users.community_id`** (denormalized, one county per user). The engine reads `users.topics`. **`user_subscriptions` is unused.**

**The tagging model (confirmed from the live page + the Stratos Zap):** content is connected to subscribers by **tags**, in a two-level hierarchy — **Pipeline > Topic**. There are **4 pipelines**; articles are tagged at the pipeline level, with an optional finer `category`:

| `pipeline_type` (canonical key) | Topics (`topic` / article `category`) |
|---|---|
| `government_notice` *(live)* | **Per-county** — tracks the exact government feeds available for that county (Box Elder's list lives in `communities.js`). |
| `news_alert` | Universal shared list (see `topics.js`). |
| `emerging_technology` | Universal shared list. |
| `global_best_practice` | Universal shared list. |

(Decision 2026-06-15: News / Emerging / Global **share one topic list** to keep the site simple; Government Notices is per-county.)

**Follow record = `user_subscriptions`, one row per `(user_id, community_id, pipeline_type[, topic])`.** `topic` is **nullable**:
- `topic IS NULL` → follow the **whole** pipeline.
- `topic = <value>` → follow **only** that topic within the pipeline.

**Match rule the engine should use:** an article reaches a user when
`community_id` matches **and** `pipeline_type` matches **and** (`subscription.topic IS NULL` **or** `subscription.topic = article.category`).
This supports pipeline-level **and** topic-level follows in one model, so granularity can be added later with **no schema change**.

**Canonical taxonomy registry (built 2026-06-15):** `topics.js` (the 4 pipelines + universal topic list + match-rule doc) and `communities.js` (`governmentTopics` per county). This is the single source of truth shared by the pop-ups, the subscription writes, and — as the reference you tag against — your Zaps. **Tag your Zaps with exactly these `pipeline_type` strings.**

**Consent:** `users.data_licensing_agreed` already exists. We can extend with `signup_source` / `consent_at` / `marketing_consent` if desired (low-risk on 6 rows), but it's no longer urgent table-creation.

**Email provider = Resend** (confirmed) — its webhooks feed `email_events` (still to be created; see §5).

### Increment 2 (revised scope)
1. Website writes follows to **`user_subscriptions`** (per `(user_id, community_id, pipeline_type[, topic])`), resolving `user_id` from `users` by email, using the canonical strings from `topics.js`.
2. **Dual-write** `users.topics` during transition so the current engine keeps working untouched.
3. Backfill the existing follows from `users.topics` into `user_subscriptions`.
4. You update the engine to read `user_subscriptions` (match rule above) when ready; then we drop the `users.topics` mirror.
5. Pop-ups driven by `topics.js` so only real pipelines are offered (granular topics opt-in / "coming soon" as tagging catches up).

### ✅ Confirmations (resolved 2026-06-15)
- Canonical pipeline strings: `government_notice` (live), `news_alert`, `emerging_technology`, `global_best_practices` (plural — matches live alert data).
- Universal topic list = Box Elder's 12 pop-up topics, verbatim (in `topics.js`).

### Increment 2 — data layer BUILT (2026-06-15, dormant on branch)
- `box-elder.html` `saveTopics` now **dual-writes**: existing `users.topics` write is unchanged (engine's success path), plus a **best-effort** granular write to `user_subscriptions` (one row per chosen topic, via `syncSubscriptions`). If the subscriptions write fails, the signup still succeeds.
- `docs/user-subscriptions-setup.sql`: uniqueness guard + RLS (scoped to the logged-in user's own rows) + one-time backfill from `users.topics`.
- **To activate:** run `docs/user-subscriptions-setup.sql`, then follow some topics on the page and confirm rows appear (the verify query is in the SQL).

### Increment 3 — dynamic community page BUILT (2026-06-15, dormant on branch)
- `community.html`: one DB-driven page that loads **any** county from the `communities` table via `?id=<uuid>` | `?community=<slug>` | `?zip=<zip>` (defaults to Box Elder). Resolves name, ZIPs, and per-county `government_topics` from the table; universal topics from `topics.js`. Alerts/meetings/follows all keyed to the resolved `community_id`.
- `box-elder.html` left untouched until `community.html` is verified; then it becomes a redirect and `communities.js` drops to a thin slug→id fallback.
- Prereq: `communities` needs **public (anon) SELECT** so the browser can read it. If the page title doesn't update for a non-default county, that policy is missing.
- **To verify:** open `community.html?zip=84302` (or `?community=box-elder`) and confirm it loads as Box Elder; alerts/meetings/follows work as before.

### Near-term tasks
- **Centralize the shared nav/footer + logged-in account bar** into one source (a shared include or JS render) instead of copy-pasting it across ~9 pages. Then **upgrade the logged-in bar to a proper account dropdown** (avatar/initial + email + Log out) — built once, every page inherits it. *(A clean flat version shipped 2026-06-15 as the interim; the dropdown waits for this centralization so we don't duplicate toggle JS across pages.)*
- **Cut over to the dynamic page:** point the dashboard "Manage"/community-name link and the homepage ZIP search at `community.html` (currently `box-elder.html`), once `community.html` is verified live.
- **Operator setup (Supabase):** run `docs/user-subscriptions-setup.sql` and ensure `communities` has public SELECT so `community.html` can read it.
- **Feed provenance guardrail (engine — `homesignal-ingest`, NOT this repo):** `pipeline_type` is stamped by the Python ingestion engine. FIX 1 done (config: `be-stratos-alias-news` → `pipeline_type=news`). Pending **FIX 2** in `homesignal-ingest`: `keyword`/Google-News rows must be `news` (coerce + warn with `feed_id` if mislabeled); `government_notice` only from `rss|html|email` with a government origin; the content classifier sets only `category`, never `pipeline_type`. Plus a one-time data re-tag of already-ingested non-gov-origin `government_notice` rows in `alerts` → `news` (MSN / Brigham City articles).
- **PMN government-notice ingestion (engine — `homesignal-ingest`):** build the HTML parser for `utah.gov/pmn` body pages (reuse the `be-stratos-water-meetings` pattern; confirm that parser exists first). **Confirmed body IDs:** County Commissioners = **2637** (`.../publicbody/2637.html` — feeds `be-public-notices`→alerts and `be-county-commission-agenda`→meetings); Planning Commission = **2337** (`.../publicbody/2337.html` — `be-planning`→alerts). Per notice extract: title, notice_types, tags, event_start/end, body/agency, description, location, link, guid. Derived `is_public_hearing` = "Hearing" in notice_types OR "Hearings" in tags (drives the red "you can speak" banner). **Routing (A):** one canonical record per notice (dedupe on guid/link); surface in `alerts` always, and additionally in `meetings` when notice_types includes Meeting/Hearing AND `event_start` is future — never both. Inactive: `be-redevelopment` (RDA = tag, caught under Commissioners), `be-emergency` (real alerts come from the county mass-notification system, not PMN).

### Ingestion model (from `HomeSignalFeedsConfig.xlsx` — confirmed 2026-06-15)
Alerts/meetings are loaded by a **scheduled ingestion engine** driven by a **Feeds config spreadsheet** (NOT Zapier — Zaps don't scale). One row = one feed; `source_type` ∈ `rss | keyword | html | email`. The engine loops active rows, fetches the source, de-dupes, and upserts items into the `alerts` or `meetings` table with that row's constant fields (`community_id`, `category`, `pipeline_type`, `agency_name`, `geographic_reference`, `impact_level`). **Adding a county = adding rows.**

**The match key is `category`.** Per the config's rule: `category` MUST equal a Topics-sheet value *exactly*, and that is what subscriber matching keys on. `pipeline_type` (`government_notice | news | …`) is a coarser grouping label, not the match key.

**Website ↔ engine contract:** `user_subscriptions.topic` (what the user follows) must equal `alerts.category` (what the engine tags). Both come from the same canonical topic list. Match: `community_id` matches **and** `subscription.topic = alerts.category` (a whole-pipeline follow with `topic IS NULL` matches all of that `pipeline_type`).

**Canonical sync requirement — keep these identical:** the spreadsheet **Topics sheet** ⇄ the website's `topics.js` / `communities.js`.
- ✅ Government topics already match exactly: the Excel Topics sheet's 7 values == Box Elder `governmentTopics` in `communities.js`.
- ⬜ When News / Emerging / Global feeds go live, add their categories (the 12 universal topics in `topics.js`) to the Topics sheet so the strings stay word-for-word identical.

---

## 2. ~~Recommended data model~~ (SUPERSEDED by §2′ — kept for history)

Add a dedicated **follows** table — one row per *person × county* — instead of cramming counties into a single user row.

```
user_communities
  id           uuid   (primary key)
  user_email   text   (who — matches the logged-in user)
  community_id uuid   (which county)
  topics       jsonb  (what they follow in THAT county, e.g. {"meetings":[...],"news":[...]})
  zip_code     text   (the ZIP they used for this county)
  created_at   timestamptz
  updated_at   timestamptz
  UNIQUE (user_email, community_id)   -- one follow-row per person per county
```

The existing **`users`** table stays for account-level info (email, home ZIP). Per-county follows move to `user_communities`.

**Why this shape serves the business:**
- *User value:* different topics per county, no compromise.
- *Acquisition / data asset:* "who follows {county} + {topic}" becomes a clean, fast, indexed lookup — exactly what the alert engine and any future segmentation/growth analytics need. A single JSON blob per user gets slow and messy at scale.
- *Scales with zero rebuild:* new county = new rows, not new code.

### Recommended companion: a `communities` lookup table
So the site/engine can render county names and map ZIP→county dynamically (instead of hardcoding):

```
communities
  id        uuid  (primary key)         -- e.g. the existing Box Elder id
  slug      text  (unique, e.g. 'box-elder')
  name      text  ('Box Elder County, Utah')
  state     text  ('UT')
  zips      text[] (the county's ZIP codes)
  is_live   boolean (true once we cover it)
```

### 2.3 Acquisition foundations (consent trail + metrics) — added per 2026-06-15 decision

These exist to make the business **provable and de-risked to a buyer**. The key insight: this is *history you cannot backfill* — if we don't capture it from day one, it's gone.

**(a) Consent & compliance trail** — added to the account-level `users` table:
```
users  (new columns)
  created_at        timestamptz  -- when the account/email was first captured
  signup_source     text         -- where they came in ('box-elder-page', 'zip-search', 'waitlist', ...)
  consent_at        timestamptz  -- when they agreed to receive emails
  consent_version   text         -- which version of the consent wording they agreed to
  marketing_consent boolean      -- explicit opt-in flag
```
Plus, on the website: a **privacy policy page** and a **working one-click unsubscribe**. A documented, timestamped, versioned consent trail lets a buyer's lawyers clear the email list quickly instead of discounting it. *The exact consent wording should be reviewed by a lawyer — that's outside what I decide.*

**(b) Metrics & engagement** — `signup_source` + `created_at` give growth-over-time and acquisition-channel reporting. Email **open/click/bounce/unsubscribe** events go in a dedicated table:
```
email_events
  id, user_email, community_id, alert_id, event_type, created_at
  -- event_type: 'sent' | 'delivered' | 'open' | 'click' | 'bounce' | 'unsubscribe'
```
> **Division of labor:** the **website** captures `created_at`, `signup_source`, and the consent fields at signup. **Open/click/bounce events come from your email provider's webhooks and are written by the engine** — the website cannot see them. So `email_events` is mostly an *engine + provider* job; we create the table now so history starts accumulating the moment that's wired up.

---

## 3. ~~Exact Supabase SQL~~ (SUPERSEDED — DO NOT RUN AS-IS)

> ⛔ **Superseded by §2′.** This SQL creates `user_communities` and `communities`, but the live DB already has `communities` and `user_subscriptions`. Do **not** run it. The only new table we still likely want is `email_events` (see §5). Kept for history.

```sql
-- 1) FOLLOWS TABLE -------------------------------------------------
create table if not exists public.user_communities (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  community_id uuid not null,
  topics       jsonb not null default '{}'::jsonb,
  zip_code     text,
  source       text,   -- where this follow came from (acquisition-channel tracking)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_email, community_id)
);

create index if not exists idx_user_communities_community
  on public.user_communities (community_id);
create index if not exists idx_user_communities_email
  on public.user_communities (user_email);

-- 2) ROW LEVEL SECURITY: a user can only see/edit their OWN rows ----
alter table public.user_communities enable row level security;

create policy "own rows - select" on public.user_communities
  for select using (user_email = (auth.jwt() ->> 'email'));

create policy "own rows - insert" on public.user_communities
  for insert with check (user_email = (auth.jwt() ->> 'email'));

create policy "own rows - update" on public.user_communities
  for update using (user_email = (auth.jwt() ->> 'email'))
              with check (user_email = (auth.jwt() ->> 'email'));

create policy "own rows - delete" on public.user_communities
  for delete using (user_email = (auth.jwt() ->> 'email'));

-- 3) MIGRATE existing single-county follows into the new table -----
insert into public.user_communities (user_email, community_id, topics, zip_code)
select email, community_id, topics, zip_code
from public.users
where community_id is not null
on conflict (user_email, community_id) do nothing;

-- 4) (OPTIONAL) communities lookup table ---------------------------
create table if not exists public.communities (
  id      uuid primary key,
  slug    text unique not null,
  name    text not null,
  state   text,
  zips    text[] not null default '{}',
  is_live boolean not null default false
);
alter table public.communities enable row level security;
create policy "communities public read" on public.communities
  for select using (true);

-- seed Box Elder (uses the existing community id)
insert into public.communities (id, slug, name, state, zips, is_live)
values (
  'd67c558f-1f04-4811-a565-873ae2afd6f3',
  'box-elder',
  'Box Elder County, Utah',
  'UT',
  array['84301','84302','84306','84307','84309','84311','84312','84313',
        '84314','84316','84324','84329','84330','84331','84334','84336','84337','84340'],
  true
) on conflict (id) do nothing;

-- 5) CONSENT & METRICS columns on the account-level users table ----
--    NOTE: created_at gets default now(), so EXISTING rows will show
--    today's date, not their true signup date (we can't recover that).
--    If users already has a created_at column, drop that line below.
alter table public.users
  add column if not exists created_at        timestamptz not null default now(),
  add column if not exists signup_source     text,
  add column if not exists consent_at        timestamptz,
  add column if not exists consent_version   text,
  add column if not exists marketing_consent boolean not null default true;

-- 6) EMAIL ENGAGEMENT EVENTS (growth/engagement history for a buyer) -
create table if not exists public.email_events (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  community_id uuid,
  alert_id     uuid,
  event_type   text not null,   -- sent | delivered | open | click | bounce | unsubscribe
  created_at   timestamptz not null default now()
);
create index if not exists idx_email_events_email on public.email_events (user_email);
create index if not exists idx_email_events_type  on public.email_events (event_type, created_at);

alter table public.email_events enable row level security;
-- No public policies on purpose: this table is written by the engine /
-- email-provider webhook using the SERVICE ROLE key (which bypasses RLS),
-- and read only via the service role / your dashboards. The public site
-- never touches it.
```

---

## 4. Website changes (the part Claude can build)

1. **Shared community registry** — a single same-origin `communities.js` (allowed by our CSP `script-src 'self'`) holding the ZIP↔county↔page map, so we stop hardcoding it in each page. (Or read it live from the `communities` table.)
2. **"My alerts" in the nav, when logged in** — on every page. Permanent way back. Kills the dead-end.
3. **New dashboard page `my-alerts.html`** — lists each county the user follows (name · # topics · "Manage" → that county's page) and an **"Add a community"** ZIP box. Works fine with just one county today.
4. **Community page "Follow this community" action** — the currently-cosmetic "Save location" heart becomes the real add/remove of a `user_communities` row. Topic selections save per-county into that row.
5. **Acquisition nudges** — after following the first county: "Add another community?"; keep the "request my community" capture for uncovered ZIPs (a per-county waitlist = a growth channel).
6. **Consent capture at signup** (per 2026-06-15 decision) — record `consent_at`, `consent_version`, `marketing_consent`, and `signup_source` whenever someone subscribes, and tag each follow's `source`. Surface a short, explicit consent line at the point of signup.
7. **Privacy policy page + one-click unsubscribe** — required to make the consent trail credible and the list clean for due diligence.

### Bigger structural recommendation (decide now)
Instead of one HTML file per county (`box-elder.html`, `cache.html`, …), move to **one dynamic template** — `community.html?community=box-elder` — that loads the right county's data from `communities` + `alerts` + `meetings`. `box-elder.html` becomes a redirect for existing links/bookmarks. This is the "correct from the beginning" choice that avoids 50 near-duplicate files.

---

## 5. Engine change spec (`homesignal-ingest` — you maintain this repo yourself)

You own and edit this repo, so this section is your implementation checklist. (Claude does not touch it.)

**Recipient matching — the core change:**
- Today: emails recipients by matching `users.community_id` + topic overlap.
- After: for each new alert/meeting in `community_id = X`, find recipients by querying
  **`user_communities` where `community_id = X`** and whose `topics` include the alert's category/topic. Email those `user_email`s.
- Read per-county `topics` from **`user_communities`**, not `users.topics`.
- Respect consent: only email rows where the account has `marketing_consent = true` (join `users` on email).

**Engagement logging (feeds §2.3b):**
- Write one `email_events` row per send (`event_type = 'sent'`, with `user_email`, `community_id`, `alert_id`).
- Wire **Resend's webhook** (events: `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`) to insert matching `email_events` rows. The webhook can land in a Supabase Edge Function or a Zap that writes the row using the **service-role key** (bypasses RLS).
- On an unsubscribe event, set `users.marketing_consent = false` so the matching query above stops including them.

**Sequencing note:** until the engine reads `user_communities`, follows in a *second* county won't trigger emails. So don't advertise multi-county alerts to users until this engine change ships. The website work can land behind it without over-promising.

---

## 6. Recommended rollout order

1. **You** review/approve this plan.
2. **You** run the Supabase SQL (section 3). I'll help verify.
3. **Claude** builds the website: registry → "My alerts" nav → dashboard → per-county follow → (optionally) the dynamic `community.html`.
4. **You / engine owner** update `homesignal-ingest` per section 5.
5. Test end-to-end with a second county before announcing.

---

## 7. Open decisions for the founder

1. **RLS match key:** match follows by **email** (consistent with today) — recommended — or by Supabase user id (`auth.uid()`, more robust long-term)?
2. **`communities` table:** create it now (recommended) or keep a small hardcoded registry in the website for the very short term?
3. **Dynamic `community.html` template** vs one HTML file per county — recommend dynamic.
4. **Who updates the engine repo, and when**, so website + engine stay in sync.
5. **Consent wording:** the exact opt-in text (and `consent_version` value) should be reviewed by a lawyer before launch.
6. ✅ Resolved 2026-06-15: **email provider is Resend.** Its webhooks (`email.delivered/opened/clicked/bounced/complained`) feed `email_events`.

> ✅ Resolved 2026-06-15: include the consent & compliance trail (§2.3a) and metrics/engagement capture (§2.3b) in this foundation.
