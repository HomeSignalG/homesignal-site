# HomeSignal — Acquisition Dashboard (spec)

A login-gated growth dashboard for **investors and internal staff**. It answers
one question at a glance: *is HomeSignal acquiring and keeping people?* It shows
aggregate acquisition, activation, and engagement metrics — never anyone's
personal data.

Status: spec + first implementation. Page: `acquisition.html`. Server objects
(admin allowlist + read-only metrics function) are parked in
`docs/acquisition-dashboard-setup.sql` and must be applied in the Supabase SQL
editor before the page returns data.

---

## 1. Goals & non-goals

**Goals**
- Give investors and staff a single, always-current view of top-line growth:
  users, subscriptions (topic follows), the anonymous visitor → signup funnel,
  email reach, and coverage demand.
- Work at today's low volume (1 user, ~3.6k events) *and* scale to thousands
  without redesign — every number is an aggregate query, not a row dump.
- Reuse the existing site: the shared nav, footer, brand tokens, and the
  email-OTP auth module already used by `dashboard.html`.

**Non-goals**
- No per-user drill-down, no PII (no emails, no ZIPs tied to a person). The
  dashboard is aggregate-only by construction (see §4).
- Not a replacement for `dashboard.html` (the resident-facing "my alerts" page).
- No write actions. Read-only.
- No billing/revenue reporting yet — the `subscriptions` (paid) table is empty;
  a placeholder tile is shown and wired for when Lemon Squeezy data arrives.

---

## 2. Audience & access model

Two roles, one gate:

- **Internal staff** — full HomeSignal team.
- **Investors** — a small, named allowlist.

Both authenticate with the **existing email-OTP flow** (no new login UI). Access
is authorized by an **email allowlist** in a new `dashboard_admins` table. A
logged-in user whose email is *not* on the list sees a friendly "no access"
state; a logged-out visitor sees the login prompt. There is no public data path.

Investors and staff see the **same** aggregate numbers — the allowlist is a yes/no
gate, not a per-role data filter. (If staff-only metrics are ever needed, add a
`role` column to `dashboard_admins` and branch in the function; out of scope now.)

---

## 3. Data sources (existing tables)

All already exist in Supabase project `qwnnmljucajnexpxdgxr`:

| Table | What it gives the dashboard |
|---|---|
| `users` | Total signups, signups over time, unsubscribe rate, per-community split |
| `user_subscriptions` | Topic follows (one row per topic); demand by topic & community |
| `events` | Anonymous funnel: `alert_view` → `alert_read` → `signup_intent` |
| `subscriptions` | Paid subscriptions by status (empty today; placeholder) |
| `email_events` | Email reach: `sent` vs `error` |
| `email_deliveries` | Volume of alert/meeting emails delivered |
| `community_requests` | Demand for not-yet-covered areas (expansion signal) |
| `communities` | Coverage count + names for per-community breakdowns |

`events` is **INSERT-only for anon/authenticated** (see `events-setup.sql`), and
`users`/most tables have RLS scoping reads to a row's owner. Therefore the browser
**cannot** read these aggregates directly — they must come through the function in §4.

---

## 4. Server: one read-only, allowlist-gated function

The static site talks to Supabase with the public **anon key** plus the logged-in
user's JWT. RLS makes direct aggregate reads impossible and, more importantly,
we never want PII on the client. So all numbers come from **one**
`SECURITY DEFINER` function that:

1. Reads the caller's email from `auth.jwt() ->> 'email'`.
2. Rejects the call (`raise exception`) unless that email is in `dashboard_admins`.
3. Returns a single **JSON blob of aggregates only** — counts, rates, and
   time series. No emails, no ZIPs, no free text, nothing per-person.

```
dashboard_admins(email text primary key, note text, added_at timestamptz)
hs_acquisition_metrics() returns jsonb   -- SECURITY DEFINER, gated, aggregates only
```

`execute` on the function is granted to `authenticated` only; the allowlist check
inside is the real gate. Because it is `SECURITY DEFINER`, it bypasses RLS to
compute aggregates but returns nothing that identifies a person. Full DDL lives in
`docs/acquisition-dashboard-setup.sql` (parked; apply manually, matching the
repo's convention for the other `*-setup.sql` files).

**Metrics JSON shape** (keys the page renders):

```jsonc
{
  "generated_at": "…",
  "kpis": {
    "users_total": 1,
    "users_active": 1,          // not unsubscribed
    "unsub_rate_pct": 0,
    "subscriptions_total": 45,  // topic follows
    "communities_live": 2,
    "emails_sent": 46,
    "email_error_rate_pct": 9.8,
    "signup_intents": 1,
    "community_requests": 5
  },
  "signups_by_week": [ { "week": "2026-06-29", "count": 1 }, … ],
  "funnel": {                    // last 30 days, anonymous
    "alert_view": 3641,
    "alert_read": 3,
    "signup_intent": 1,
    "signup": 1                  // users created in window
  },
  "topics_top": [ { "topic": "…", "followers": 9 }, … ],   // top 8
  "communities": [ { "name": "Box Elder County", "users": 1, "subscriptions": 45 }, … ],
  "paid": { "active": 0, "trialing": 0, "canceled": 0 }     // placeholder until billing
}
```

If the caller isn't an admin the function raises; the page maps that to the
"no access" state.

---

## 5. Page layout (`acquisition.html`)

Reuses the shared `<nav>`, `<footer>`, auth modal, and brand tokens verbatim from
`dashboard.html`. Content column, same max width and spacing.

**States**
- **Logged out** → card: "Sign in to view the acquisition dashboard" + Log in
  button (opens the existing OTP modal).
- **Logged in, not an admin** → card: "This dashboard is limited to HomeSignal
  staff and investors." (No numbers rendered.)
- **Logged in + admin** → the dashboard below.
- **Loading / error** → skeleton line, then a retry-able error card on failure.

**Dashboard sections** (top to bottom)
1. **KPI row** — stat tiles (hero numbers), no chart: Users, Topic follows,
   Communities live, Emails sent, Signup intents, Community requests. Each tile is
   label + big number + a one-line caption. (Form: stat tile — the number *is* the
   viz. See dataviz `choosing-a-form`.)
2. **Signups over time** — single-series line/area, weekly. Brand green as a
   sequential single hue. Crosshair + tooltip.
3. **Acquisition funnel** — horizontal bars, `alert_view → alert_read →
   signup_intent → signup`, last 30 days, with step-to-step conversion %. Single
   green hue scaled by magnitude (not categorical).
4. **Topic demand** — top ~8 topics by follower count, horizontal bars.
5. **Community breakdown** — per community: users + topic follows.
6. **Paid subscriptions** — placeholder tile row (active/trialing/canceled),
   labeled "coming online with billing" while `subscriptions` is empty.

**Color / accessibility (per dataviz skill)**
- Everything is a **magnitude** encoding, so it uses the **single brand-green hue**
  (`--green #1f5130`) light→dark — no categorical multi-hue palette, so no CVD
  validation gap. Text uses the ink tokens, never the mark color.
- Bars: thin marks, 4px rounded data-end at the baseline, 2px surface gap.
- Charts are inline SVG (no external chart lib) to satisfy the page CSP
  (`script-src` allows only self + jsDelivr for supabase-js).
- Dark mode is not required (the site is light-only today); tiles/charts inherit
  the site's light surfaces.

---

## 6. Security & privacy checklist
- [ ] Function is `SECURITY DEFINER`, `search_path` pinned, allowlist-checked.
- [ ] `execute` granted to `authenticated` only; `anon` cannot call it.
- [ ] Returns aggregates only — reviewer confirms no column leaks email/ZIP/text.
- [ ] `dashboard_admins` seeded with real staff/investor emails before sharing the URL.
- [ ] Page renders zero numbers until the function authorizes the caller.
- [ ] No service-role key anywhere in the static site (only the public anon key).

## 7. Rollout
1. Review + run `docs/acquisition-dashboard-setup.sql` in Supabase.
2. Insert staff/investor emails into `dashboard_admins`.
3. Ship `acquisition.html`; share the URL with the allowlist.
4. (Later) When billing lands, extend `hs_acquisition_metrics()` with revenue/MRR
   and light up the Paid tiles.
