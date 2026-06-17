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

## 1. Storage (task item 6) — no new columns required (recommended)

The split needs **no schema change**: `users.topics` is already jsonb and the
site writes both keys. Reading `topics->'notices'` and `topics->'meetings'`
satisfies "store each user's notice-topics and meeting-topics independently."

**This is the safest way to honor "no second migration":** adding zero columns
can't introduce one. Keep the existing unmerged migration exactly as-is.

### If you prefer typed columns instead of jsonb keys (Option B) ⚠︎
Only if the unmerged branch already moves follows off `users.topics` onto typed
columns, fold these into **that same migration** (additive, no table rewrites):

```sql
-- Fold into the EXISTING unmerged migration file. Additive only.
alter table public.users
  add column if not exists notice_topics  text[] not null default '{}',
  add column if not exists meeting_topics text[] not null default '{}';
```

If you take Option B, tell me and I'll update the site to also write
`notice_topics` / `meeting_topics` (today it writes the jsonb keys). Until then,
**Option A (read the jsonb keys) is what the shipped site supports.**

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
   still a single, additive migration** that does not alter existing tables —
   i.e. Option A added nothing, or Option B only `ADD COLUMN ... IF NOT EXISTS`.

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

**If you take Option B (typed columns), ping me** — the site needs a one-line
follow-up to write `notice_topics`/`meeting_topics` instead of (or in addition
to) the jsonb keys.
