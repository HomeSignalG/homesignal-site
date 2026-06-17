# Engine spec — Notices/Meetings tile split (homesignal-ingest)

**Status:** ready to apply in `HomeSignalG/homesignal-ingest`. Fold into the
**unmerged** email-delivery branch — **do not** create a second migration and
**do not** merge or apply the migration until the dry-run in §4 passes.

**Why this doc lives in homesignal-site:** the engine repo isn't in this
session's scope, so the site half (done — commit `d3cde8a`) and this spec for
the engine half live together here until someone with ingest access applies it.

> **Reconcile-against-real-code flags** are marked **⚠︎**. This spec is written
> against the documented schema (`docs/multi-county-plan.md`,
> `docs/user-subscriptions-setup.sql`) and the locked decisions in the task.
> Where the unmerged branch already names things differently, keep the branch's
> names and apply the *intent* below.

---

## 0. What the site now writes (the contract)

After commit `d3cde8a`, `box-elder.html` and `community.html` write the
logged-in user's follows to **`public.users.topics`** (jsonb) with **two
independent keys** under the one `government_notice` pipeline:

```jsonc
// public.users.topics
{
  "notices":  ["County Commission & county business", "Water companies", ...],
  "meetings": ["Planning, zoning & development", ...],
  "news":     [...],   // parked in v1 — do NOT deliver
  "emerging": [...],   // parked in v1 — do NOT deliver
  "global":   [...]    // parked in v1 — do NOT deliver
}
```

- `topics.notices`  = **notice-topics** → governs which **Government notices** the user gets.
- `topics.meetings` = **meeting-topics** → governs which **Upcoming meetings** the user gets.
- Both arrays contain values drawn from the **same 7 canonical category strings**
  (verbatim — these must equal `alerts.category` / `meetings.category` exactly):
  - `County Commission & county business`
  - `Planning, zoning & development`
  - `Property taxes & assessments`
  - `Public safety & emergencies`
  - `Water companies`
  - `Elections & voting`
  - `Stratos data center project`
- `community_id` on the row is Box Elder: `d67c558f-1f04-4811-a565-873ae2afd6f3`.
- The site does **not** mirror the `meetings` key into `user_subscriptions`
  (that table is keyed on `pipeline_type`, and both tiles are
  `government_notice`, so it can't hold the two sets independently without
  clobbering). **`users.topics` is the authoritative source for the split.**

### Legacy key semantics ⚠︎
Before the split, the single tile wrote its selection to `topics.meetings` with
the *combined* meaning "notices & meetings". Post-split, `topics.meetings` means
**meetings only** and `topics.notices` is new. For any pre-existing test user
that has `topics.meetings` but no `topics.notices`, decide one of:
- **(recommended)** treat a missing `topics.notices` as empty (they simply
  re-pick notice-topics next visit — test users only), **or**
- backfill `notices := meetings` once for legacy rows.

Do **not** modify existing test users as part of this change unless you
deliberately choose the backfill option above.

---

## 1. Storage (task item 6) — jsonb keys, no new columns (LOCKED — Option A)

**Decision (locked 2026-06-17):** read the two jsonb keys; **add no columns.**

The split needs **no schema change**: `users.topics` is already jsonb and the
site writes both keys. Reading `topics->'notices'` and `topics->'meetings'`
satisfies "store each user's notice-topics and meeting-topics independently,"
and adding zero columns is the safest way to honor "no second migration." Keep
the existing unmerged migration exactly as-is.

**Why jsonb, not typed columns:** News / Emerging technologies / Global best
practices are parked now and get added later. jsonb absorbs each new pipeline as
another key with **no schema change**; typed columns would force a fresh
migration every time a pipeline ships. So the engine reads `users.topics`
key-by-key and the site half is **final** on this basis.

### Rejected — typed columns (Option B)
Do **not** add `notice_topics` / `meeting_topics` columns. Rejected for the
reason above (schema churn on every future pipeline). The shipped site writes
jsonb keys and will not be changed to write typed columns.

---

## 2. digest.py (task item 7)

Each recipient gets, in one daily email, **two distinct sections**:

1. **Government notices** — `alerts` rows where
   `pipeline_type = 'government_notice'` and `category ∈ notice_topics`.
   v1 delivers **government_notice only** — exclude `news_alert`,
   `emerging_technology`, `global_best_practices`.
2. **Upcoming meetings** — `meetings` rows where `category ∈ meeting_topics`
   and the meeting is in the **future** (`meeting_date >= now()`).
   ⚠︎ match the future-event column the engine actually uses
   (`meeting_date` / `event_start`).

Group each section **by topic** (category). Render the two sections separately
even when a topic appears in both. Send nothing if both sections are empty.

### Drop-in logic (adapt names to the real digest.py) ⚠︎

```python
GOV_PIPELINE = "government_notice"
BOX_ELDER = "d67c558f-1f04-4811-a565-873ae2afd6f3"

def topics_for(user, key):
    # users.topics is jsonb: {"notices":[...], "meetings":[...], ...}
    t = user.get("topics") or {}
    vals = t.get(key) or []
    return [v for v in vals if isinstance(v, str)]

def build_digest_for_user(db, user):
    if not user.get("marketing_consent", True):      # consent gate (doc §5)
        return None
    cid = user.get("community_id")
    if not cid:
        return None

    notice_topics  = topics_for(user, "notices")
    meeting_topics = topics_for(user, "meetings")
    if not notice_topics and not meeting_topics:
        return None

    notices = []
    if notice_topics:
        notices = db.fetch_alerts(
            community_id=cid,
            pipeline_type=GOV_PIPELINE,            # gov-notice ONLY in v1
            categories=notice_topics,
            # no-backfill + dedup, see §3:
            not_in_email_deliveries=(user["id"],),
            created_after=FIRST_SEND_CUTOFF,
        )

    meetings = []
    if meeting_topics:
        meetings = db.fetch_meetings(
            community_id=cid,
            categories=meeting_topics,
            future_only=True,                      # meeting_date >= now()
            not_in_email_deliveries=(user["id"],),
        )

    if not notices and not meetings:
        return None

    return {
        "user": user,
        "notices":  group_by_category(notices),    # {category: [items]}
        "meetings": group_by_category(meetings),
        "items":    notices + meetings,            # for email_deliveries write
    }
```

Email body: render `Government notices` then `Upcoming meetings`, each as
`topic → bullet list`. Keep the signed/random unsubscribe token in the footer
(item 8). On a real send, write one `email_deliveries` row per item and one
`email_events` row (`event_type='sent'`) per the existing pattern.

---

## 3. Locked decisions (task item 8) — keep all four

- **Daily digest at 5 PM ET.** ⚠︎ leave the existing schedule/cron untouched.
- **No backfill of the existing ~260 alerts on the first send.** Use whatever
  the unmerged branch already does; if nothing exists yet, the cleanest is one
  of:
  - seed `email_deliveries` with every currently-existing `alerts.id` /
    `meetings.id` as already-delivered (one-time, before first run), **or**
  - a `FIRST_SEND_CUTOFF` timestamp = first-deploy time and filter
    `created_at >= FIRST_SEND_CUTOFF`.
  Either keeps the first real send to genuinely new items only.
- **Random/signed unsubscribe token** — unchanged.
- **`email_deliveries` dedup** — a row already sent is never re-sent. The split
  does not change dedup keys; just ensure both notices and meetings items are
  recorded. ⚠︎ confirm the dedup key (likely `(user_id, alert_id)` /
  `(user_id, item_type, item_id)`).

The split touches **only** *which topics* select items into each section. It
does **not** change scheduling, backfill suppression, tokens, or dedup.

---

## 4. Verify before merge / before any real send (task item 9)

Run the **DB-backed dry-run** (no emails actually sent):

1. **Seed a Box Elder test user** with both sets populated, e.g.:
   ```sql
   update public.users
   set community_id = 'd67c558f-1f04-4811-a565-873ae2afd6f3',
       topics = jsonb_set(
         jsonb_set(coalesce(topics,'{}'::jsonb),
           '{notices}',  '["County Commission & county business","Water companies"]'::jsonb, true),
           '{meetings}', '["Planning, zoning & development"]'::jsonb, true),
       marketing_consent = true
   where email = '<your-test-address>';
   ```
   Ensure at least one matching `alerts` row (`government_notice`, those
   categories) and one future `meetings` row exist (insert fixtures if needed),
   and that they are **after** the no-backfill cutoff / not in `email_deliveries`.
2. **Run the digest in dry-run mode** (the branch's existing flag, e.g.
   `--dry-run` / `DRY_RUN=1`). ⚠︎ use the real flag.
3. **Confirm:**
   - **"would send" > 0** for the test user, with the email previewing **two
     sections** (Government notices grouped by notice-topics; Upcoming meetings
     grouped by meeting-topics).
   - **0 emails actually sent** and **0 new `email_deliveries`/`email_events`
     rows** written by the dry-run.
4. **Show the diff** (`git diff` of the branch) and **confirm the migration is
   still a single, additive migration** that does not alter existing tables. Per
   the locked decision (§1), this split adds **no columns** — the migration is
   unchanged by it.

**Prerequisite for real sends (not a blocker for building/dry-running):**
`RESEND_API_KEY` in GitHub Secrets + `homesignal.net` verified in Resend.

---

## 5. Cross-repo checklist

| # | Repo | Item | State |
|---|------|------|-------|
| 1–5 | homesignal-site | Two tiles, same 7 topics, independent per tile, signup write, parked Stay-informed | ✅ done (`d3cde8a`) |
| 6 | homesignal-ingest | Independent notice/meeting storage, single migration | ◻ this spec §1 |
| 7 | homesignal-ingest | digest.py — two sections, gov-notice-only notices, future meetings | ◻ this spec §2 |
| 8 | homesignal-ingest | Keep locked decisions | ◻ this spec §3 |
| 9 | homesignal-ingest | DB-backed dry-run verification | ◻ this spec §4 |

**Storage is locked to jsonb keys (Option A).** No site follow-up is needed or
pending; typed columns are explicitly rejected (see §1).

---

## 6. Live DB validation (2026-06-17, project `qwnnmljucajnexpxdgxr`)

Verified the real Supabase schema/data against this spec (read-only). The
matching contract holds, but the engine implementer must account for these
ground-truth facts:

### Tables/columns that DON'T exist yet (created by the unmerged migration)
- **`email_deliveries`** and **`email_events`** tables do **not** exist in the
  live DB. They are part of the unmerged email-delivery migration in
  `homesignal-ingest` — correct, since the migration hasn't been applied. The
  dedup logic (§3) depends on `email_deliveries` existing post-migration.
- **`users.marketing_consent`** does **not** exist yet (nor `consent_at`,
  `consent_version`, `signup_source`). The consent gate in the §2 sketch
  (`user.get("marketing_consent", True)`) therefore must **default to True when
  the column/key is absent**, or be gated on whether the consent migration
  (`docs/multi-county-plan.md` §3 step 5) has run. Do **not** hard-require the
  column. `users` today = `id, email, zip_code, created_at,
  data_licensing_agreed, community_id, topics(jsonb)`.

### `alerts` — pipeline_type is the v1 filter
- `alerts.pipeline_type` has a CHECK constraint:
  `pipeline_type IN ('permit_filing','government_notice','news')`. There is **no
  `emerging_technology`/`global_best_practices`** at the alerts level. So
  "exclude news / emerging / global" simply means **filter
  `pipeline_type = 'government_notice'`** — that's the whole exclusion. (Note the
  alerts value is `'news'`, while `topics.js`/the site use `'news_alert'` as the
  pipeline label — irrelevant to v1 since we only select `government_notice`.)
- Match notice-topics on `alerts.category` (exact string).
- 260 existing rows → all suppressed on first send (no-backfill, §3).

### ⚠︎ Non-canonical categories already in the data (re-tag decision needed)
Live Box Elder `government_notice` alerts by category include two values that
are **not** among the 7 canonical topics and therefore **match nothing and never
deliver**:
- `council_meeting` — **46 rows**
- `Public notices` — **7 rows**

(The canonical ones present: County Commission & county business 9, Planning 10,
Elections & voting 3, Public safety & emergencies 1, Stratos 7, Water companies
7; no Property-taxes alerts yet.) This is the same taxonomy-drift the FIX-2 /
re-tag work targets — surfacing it here because exact-string matching means
those 53 rows are invisible to subscribers until re-tagged. **Not fixing it in
this change** (separate data decision), but flag it: the engine owner should
decide whether `council_meeting`/`Public notices` get re-tagged to canonical
categories.

### `meetings` — future filter + nullable category
- Match meeting-topics on `meetings.category` (exact string); **`category` is
  nullable** — null-category meetings (3 today) match no topic and are skipped.
- Future filter = **`meeting_date >= now()`** (`meeting_date` is `timestamptz`).
- Live data: exactly **1 future** meeting (`Planning, zoning & development`); the
  rest are past and correctly excluded. A test user following Planning in
  meeting-topics would get that 1 meeting.

### Dry-run note (§4) given no-backfill + live data
With no-backfill suppressing all 260 historical alerts, a first-run dry-run for
a seeded user would show **would-send = 0** unless a **fresh** matching item
(dated after the first-send cutoff / not in `email_deliveries`) exists. To get a
**non-zero** "would send" in the dry-run, seed one new `alerts` row
(`pipeline_type='government_notice'`, a canonical `category` in the user's
notice-topics, `created_at = now()`) and/or rely on the 1 existing **future
meeting** if the meeting path isn't subject to the alert backfill cutoff. ⚠︎
confirm how the branch's no-backfill rule treats `meetings` vs `alerts`.

### Read-only would-send preview (no writes, ran 2026-06-17)
The matching logic was previewed against live data with a pure `SELECT` (0
writes, 0 sends). For a hypothetical user following notice-topics
{County Commission & county business, Water companies} and meeting-topics
{Planning, zoning & development}, the canonical matches present are: 9 + 7 = 16
gov-notice alerts and 1 future meeting — confirming the join/category matching
works end-to-end at the DB level. (Actual first-send would still be governed by
the no-backfill cutoff + `email_deliveries` dedup.)
