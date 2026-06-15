# Multi-County Plan — HomeSignal

> Status: **DRAFT for founder review.** Nothing here is built yet. No live-site changes.
> Drivers for every decision: (1) user-friendly, (2) user value, (3) acquisition / the data asset.
>
> **Decided 2026-06-15:** fold two acquisition foundations into this build now — a **consent & compliance trail** and **metrics & engagement capture** — because both record history you can't reconstruct after the fact. See §2.3 and §3.

---

## 1. The problem we're solving

- When a logged-in user is on the homepage, there is **no clear way back to their community** — the nav only shows their email + "Log out". They must re-type a ZIP.
- The current data model assumes **one county per user** (`users` table has a single `community_id` + one `topics` list). We cannot support "follow 2 counties" without changing how follows are stored — and that touches **Supabase and the alert engine**, not just the website.

We want to fix the foundation now so adding county #2 (and #50) is *just data*, not a rebuild.

---

## 2. Recommended data model

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

## 3. Exact Supabase SQL (founder pastes into Supabase → SQL Editor)

> Safe to run: schema + Row-Level-Security only. No secrets. Review before running.

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
- Wire your email provider's webhook (delivered/open/click/bounce/unsubscribe) to insert matching `email_events` rows. Use the **service-role key** (bypasses RLS).
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
6. **Email-event source:** which provider's webhooks feed `email_events` (e.g., Resend/Postmark/SES) — needed so the engine can write open/click events.

> ✅ Resolved 2026-06-15: include the consent & compliance trail (§2.3a) and metrics/engagement capture (§2.3b) in this foundation.
