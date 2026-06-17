# Engine bundle — Notices/Meetings split (paste into homesignal-ingest)

Paste-ready implementation of the engine half. Built against the **live**
Supabase schema (project `qwnnmljucajnexpxdgxr`, validated 2026-06-17). Storage
is **Option A (jsonb keys)** — no schema change, the unmerged migration stays
untouched.

**Workflow:** apply in a `homesignal-ingest` session → run the dry-run → review
counts. **Nothing is applied or merged until you approve.**

Lines marked **⚠︎ADAPT** depend on code I can't see (your `digest.py` DB client,
send function, `email_deliveries`/`email_events` column names, unsubscribe-token
helper). Wire them to the real names; the SQL and logic are final.

---

## A. Contract being implemented (from the live DB)

- Read each recipient's follows from **`users.topics`** (jsonb), keys
  **`notices`** and **`meetings`**, each an array of canonical category strings.
- **Notices** = `alerts` where `pipeline_type='government_notice'` and
  `category ∈ notice_topics`. (Live `alerts.pipeline_type ∈
  {permit_filing, government_notice, news}` — so this filter alone excludes
  news/emerging/global.)
- **Meetings** = `meetings` where `category ∈ meeting_topics` and
  `meeting_date >= now()`.
- Match is **exact string** on `category` against the 7 canonical labels.
- `email_deliveries` dedup; no-backfill cutoff on alerts; 5 PM ET schedule
  unchanged; existing signed/random unsubscribe token reused.
- `users.marketing_consent` does **not exist yet** → consent filter stays
  commented until the consent migration runs (don't reference the column now).

The 7 canonical categories (verbatim):
`County Commission & county business`, `Planning, zoning & development`,
`Property taxes & assessments`, `Public safety & emergencies`,
`Water companies`, `Elections & voting`, `Stratos data center project`.

---

## B. digest.py — two-section builder (drop-in)

```python
# ── notices/meetings split ─────────────────────────────────────────────
import os
from datetime import datetime, timezone

BOX_ELDER = "d67c558f-1f04-4811-a565-873ae2afd6f3"
GOV_PIPELINE = "government_notice"

# No-backfill: alerts created before this instant are treated as history and
# never emailed on the first (or any) run. Set once, at/just before first send.
# ISO-8601, e.g. "2026-06-17T00:00:00Z". Defaults to process start = "today only".
DIGEST_BACKFILL_CUTOFF = os.environ.get(
    "DIGEST_BACKFILL_CUTOFF",
    datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
)

CANONICAL_TOPICS = {
    "County Commission & county business",
    "Planning, zoning & development",
    "Property taxes & assessments",
    "Public safety & emergencies",
    "Water companies",
    "Elections & voting",
    "Stratos data center project",
}


def _topic_list(user, key):
    """Selections for one tile from users.topics jsonb: {'notices':[...], 'meetings':[...]}."""
    topics = user.get("topics") or {}
    vals = topics.get(key) or []
    # exact-string only; ignore anything not in the canonical set so a stale
    # client value can never widen a match.
    return [v for v in vals if isinstance(v, str) and v in CANONICAL_TOPICS]


def _group_by_category(rows):
    """rows -> {category: [row, ...]} preserving query order (by category, then date)."""
    out = {}
    for r in rows:
        out.setdefault(r["category"], []).append(r)
    return out


# ⚠︎ADAPT: db.query(sql, params) -> list[dict]. Shown psycopg-style (%(name)s).
# If you use supabase-py, translate to .from_("alerts").select(...).eq(...).in_(...).

NOTICES_SQL = """
select a.id, a.title, a.category, a.description, a.agency_name,
       a.impact_level, a.source_url, a.published_at, a.created_at
from public.alerts a
where a.community_id = %(cid)s
  and a.pipeline_type = 'government_notice'
  and a.category = any(%(topics)s)
  and a.created_at >= %(cutoff)s            -- no-backfill: history excluded
  and not exists (                          -- ⚠︎ADAPT email_deliveries columns
    select 1 from public.email_deliveries d
    where d.user_id = %(uid)s and d.item_type = 'alert' and d.item_id = a.id
  )
order by a.category asc, coalesce(a.published_at, a.created_at) desc
"""

MEETINGS_SQL = """
select m.id, m.title, m.category, m.meeting_date, m.location,
       m.is_public_hearing, m.source_url
from public.meetings m
where m.community_id = %(cid)s
  and m.category = any(%(topics)s)
  and m.meeting_date >= now()               -- upcoming only
  and not exists (                          -- ⚠︎ADAPT email_deliveries columns
    select 1 from public.email_deliveries d
    where d.user_id = %(uid)s and d.item_type = 'meeting' and d.item_id = m.id
  )
order by m.category asc, m.meeting_date asc
"""


def build_user_digest(db, user, cutoff=DIGEST_BACKFILL_CUTOFF):
    """Return {'notices':{cat:[rows]}, 'meetings':{cat:[rows]}, 'items':[...]}
    or None when there's nothing new to send."""
    cid = user.get("community_id")
    if not cid:
        return None

    notice_topics = _topic_list(user, "notices")
    meeting_topics = _topic_list(user, "meetings")
    if not notice_topics and not meeting_topics:
        return None

    notices = (
        db.query(NOTICES_SQL, {"cid": cid, "topics": notice_topics,
                               "cutoff": cutoff, "uid": user["id"]})
        if notice_topics else []
    )
    meetings = (
        db.query(MEETINGS_SQL, {"cid": cid, "topics": meeting_topics,
                                "uid": user["id"]})
        if meeting_topics else []
    )
    if not notices and not meetings:
        return None

    return {
        "user": user,
        "notices": _group_by_category(notices),
        "meetings": _group_by_category(meetings),
        "items": ([("alert", r["id"]) for r in notices]
                  + [("meeting", r["id"]) for r in meetings]),
    }


# ⚠︎ADAPT: recipient loader. marketing_consent is intentionally NOT selected/
# filtered (column doesn't exist yet). Re-enable the commented line after the
# consent migration ships.
RECIPIENTS_SQL = """
select id, email, community_id, topics
from public.users
where community_id is not null
  and topics is not null
  -- and coalesce(marketing_consent, true) = true   -- enable post-consent-migration
"""


def render_email(digest):
    """Two distinct sections, each grouped by topic. ⚠︎ADAPT to your HTML template
    + reuse your existing signed/random unsubscribe token."""
    u = digest["user"]
    parts = []

    def section(title, grouped, line_fn):
        if not grouped:
            return
        parts.append(f"<h2>{title}</h2>")
        for category in grouped:                       # already ordered by query
            parts.append(f"<h3>{category}</h3><ul>")
            for row in grouped[category]:
                parts.append(f"<li>{line_fn(row)}</li>")
            parts.append("</ul>")

    section("Government notices", digest["notices"],
            lambda r: f'<a href="{r.get("source_url") or "#"}">{r["title"]}</a>'
                      + (f' — {r["agency_name"]}' if r.get("agency_name") else ""))
    section("Upcoming meetings", digest["meetings"],
            lambda r: f'<a href="{r.get("source_url") or "#"}">{r["title"]}</a>'
                      f' — {r["meeting_date"]:%b %d, %Y}'
                      + (" (public hearing)" if r.get("is_public_hearing") else ""))

    token = make_unsubscribe_token(u)                  # ⚠︎ADAPT existing helper
    parts.append(f'<p><a href="https://homesignal.net/unsubscribe?t={token}">Unsubscribe</a></p>')
    return "\n".join(parts)


def run_digest(db, *, dry_run=True, cutoff=DIGEST_BACKFILL_CUTOFF):
    """5 PM ET cron calls this. ⚠︎ADAPT: leave the existing schedule untouched;
    only the body below changes."""
    recipients = db.query(RECIPIENTS_SQL, {})
    would_send_users = 0
    emails_sent = 0

    for u in recipients:
        digest = build_user_digest(db, u, cutoff=cutoff)
        if not digest:
            continue
        n_notices = sum(len(v) for v in digest["notices"].values())
        n_meetings = sum(len(v) for v in digest["meetings"].values())
        would_send_users += 1
        print(f"[would-send] {u['email']}: "
              f"{n_notices} notices / {len(digest['notices'])} topics, "
              f"{n_meetings} meetings / {len(digest['meetings'])} topics")

        if dry_run:
            continue

        send_email(u["email"], render_email(digest))          # ⚠︎ADAPT Resend send
        record_deliveries(db, u["id"], digest["items"])        # ⚠︎ADAPT email_deliveries write
        log_email_event(db, u["email"], u["community_id"], "sent")  # ⚠︎ADAPT email_events write
        emails_sent += 1

    print(f"SUMMARY would_send_users={would_send_users} "
          f"emails_sent={emails_sent} dry_run={dry_run} cutoff={cutoff}")
    return {"would_send_users": would_send_users, "emails_sent": emails_sent}
```

**What's intentionally unchanged:** the 5 PM ET schedule/cron, your Resend send
path, the `email_deliveries`/`email_events` writes, and the unsubscribe-token
helper. The split only changes *which rows* are selected and that they render as
**two sections grouped by topic**.

---

## C. Seed the Box Elder test user (jsonb notices/meetings)

Inserts a clearly-marked **test** user (does not modify existing users). Topics
chosen to match live data: notice-topics with rows present, meeting-topics =
the one existing future meeting.

```sql
-- SEED: Box Elder test recipient (safe to re-run; only touches this test row)
insert into public.users (email, zip_code, community_id, topics)
values (
  'digest-test+boxelder@homesignal.net',
  '84302',
  'd67c558f-1f04-4811-a565-873ae2afd6f3',
  jsonb_build_object(
    'notices',  jsonb_build_array('County Commission & county business','Water companies'),
    'meetings', jsonb_build_array('Planning, zoning & development')
  )
)
on conflict (email) do update
  set community_id = excluded.community_id,
      topics       = excluded.topics;
```

**Non-zero "would send" under no-backfill:** the historical 260 alerts are
excluded by the cutoff, so to see a non-zero *notices* count, also seed one
**fresh** matching alert (dated now). The existing future **meeting** (Planning)
already yields a non-zero *meetings* count on its own.

```sql
-- OPTIONAL FIXTURE: one fresh gov-notice alert so the Notices section is non-zero
-- under the no-backfill cutoff. Delete after the dry-run (cleanup below).
insert into public.alerts
  (community_id, pipeline_type, category, title, agency_name, impact_level, created_at, published_at)
values
  ('d67c558f-1f04-4811-a565-873ae2afd6f3','government_notice',
   'County Commission & county business',
   '[TEST] Commission special session notice','Box Elder County','new', now(), now());
```

```sql
-- CLEANUP after the dry-run (remove test fixtures)
delete from public.alerts where title = '[TEST] Commission special session notice';
delete from public.users where email = 'digest-test+boxelder@homesignal.net';
```

---

## D. Dry-run command + exact checks

```bash
# In the homesignal-ingest session. ⚠︎ADAPT entrypoint + flag to your CLI.
# Use a cutoff that proves no-backfill (today), so the 260 historical alerts drop out.
DIGEST_BACKFILL_CUTOFF="2026-06-17T00:00:00Z" python -m homesignal_ingest.digest --dry-run
#   or:  python digest.py --dry-run
```

**PASS criteria:**
1. **`would_send_users >= 1`** — the test user appears in a `[would-send]` line.
   - With the optional fresh-alert fixture: `1 notices / 1 topics`.
   - Meetings: `1 meetings / 1 topics` (the existing future Planning meeting).
2. **`emails_sent=0`** in the SUMMARY line (dry-run sends nothing).
3. **No new rows** in `email_deliveries` / `email_events` after the run
   (dry-run must not write). Verify:
   ```sql
   select count(*) from public.email_deliveries;   -- unchanged vs before run
   select count(*) from public.email_events;        -- unchanged vs before run
   ```
4. **Migration unchanged / still single + additive** — `git diff` shows changes
   only in `digest.py` (Option A added no column):
   ```bash
   git -C homesignal-ingest diff --stat            # expect: digest.py only
   git -C homesignal-ingest status                  # no new/modified migration file
   ```

Expected SUMMARY line (with the optional fixture seeded):
```
SUMMARY would_send_users=1 emails_sent=0 dry_run=True cutoff=2026-06-17T00:00:00Z
```

---

## E. DB-only would-send preview (no app code, no writes)

If you want to confirm matching before wiring `digest.py`, run these `SELECT`s
(pure reads). They mirror the queries in §B for the seeded test user.

```sql
-- Notices the test user would match (respecting the no-backfill cutoff)
select a.category, count(*) n
from public.alerts a
join public.users u on u.email = 'digest-test+boxelder@homesignal.net'
where a.community_id = u.community_id
  and a.pipeline_type = 'government_notice'
  and a.category = any (array(select jsonb_array_elements_text(u.topics->'notices')))
  and a.created_at >= timestamptz '2026-06-17T00:00:00Z'
group by a.category;

-- Upcoming meetings the test user would match
select m.category, count(*) n
from public.meetings m
join public.users u on u.email = 'digest-test+boxelder@homesignal.net'
where m.community_id = u.community_id
  and m.category = any (array(select jsonb_array_elements_text(u.topics->'meetings')))
  and m.meeting_date >= now()
group by m.category;
```

---

## F. Reconcile checklist before you run

- [ ] `db.query(...)` → your real client (psycopg / supabase-py). Param style matches.
- [ ] `email_deliveries` columns (`user_id, item_type, item_id`) → your real names.
- [ ] `send_email` / `record_deliveries` / `log_email_event` → your existing functions.
- [ ] `make_unsubscribe_token` → your existing signed/random token helper.
- [ ] Cron/schedule (5 PM ET) untouched; only `run_digest` body changed.
- [ ] Decide how no-backfill applies to **meetings** (this bundle: future-filter +
      dedup, no `created_at` cutoff on meetings).
- [ ] Separate decision (not in this change): re-tag the 53 non-canonical
      gov-notice alerts (`council_meeting` ×46, `Public notices` ×7) so they match.
