# Handoff — independent Notices vs Meetings delivery (homesignal-ingest)

> **Audience:** a session working in **`homesignal-ingest`** (the engine repo). This spec
> is parked in `homesignal-site` because that's the session that surfaced it; the work
> itself is cross-repo (site + ingest + DB). **Ship all three together** — it's a
> subscription-model change.
>
> **Rule for this doc:** everything under "Verified (site side)" was checked against the
> live code/DB this session. Everything under "To verify in ingest" is **not** asserted —
> confirm it in that repo before acting (never guess).

---

## 1. What we want
On a town/community page a resident can now open **Government Notices** and **Upcoming
Meetings** as two separate tiles. We want the *selection* to be independent too — e.g.
follow **Planning meetings** without every **Planning notice**, or vice versa. Today
following a government topic delivers **both** streams.

## 2. Why it isn't independent yet (verified, site side)
- `community.html` maps **both** gov tiles to the same pipeline key —
  `CAT_TO_PIPELINE = { notices:'government_notice', meetings:'government_notice', … }`.
- `buildSubscriptionSet()` emits `{pipeline_type, topic}` and **de-dupes**, so
  "notices: Planning" and "meetings: Planning" collapse to one row
  `{government_notice, 'Planning, zoning & development'}`.
- The single write path is the `signup_complete` RPC (SECURITY DEFINER), which reconciles
  `user_subscriptions` server-side.
- Content: the **`alerts`** table (`pipeline_type='government_notice'`) is the *notices*
  stream; the **`meetings`** table is the *meetings* stream. Both are matched by
  `category == subscription.topic` (word-for-word) **AND** `community_id`.
- DB check today: `alerts.pipeline_type ∈ ('permit_filing','government_notice','news')`.
  (Meetings live in their own table, so they are **not** constrained by this.)

So the subscription has **no dimension that distinguishes the two streams** — that's the
gap.

## 3. Recommended design — a stream marker on the subscription
Give a government subscription a **stream**: `notice` vs `meeting`. Cleanest encoding is a
distinct pipeline key per stream:

| Tile | Writes subscription | Matches content |
|---|---|---|
| Government Notices | `{ pipeline_type:'government_notice', topic }` | `alerts` rows (`government_notice`) where `category==topic` + `community_id` |
| Upcoming Meetings | `{ pipeline_type:'government_meeting', topic }` | `meetings` rows where `category==topic` + `community_id` |

(An alternative is a separate `stream` column on `user_subscriptions`; the pipeline-key
approach reuses the existing matching machinery and is likely the smaller change — decide
in the ingest repo based on how matching is actually written.)

## 4. Touch-points

**Site (`homesignal-site`) — small:**
- `community.html`: change `CAT_TO_PIPELINE.meetings` from `'government_notice'` to the
  meetings-stream key (e.g. `'government_meeting'`). The two tiles + scoped popups already
  exist (shipped this session).
- **Verify `box-elder.html` / `eagle-mountain.html`** (frozen legacy pages, but LIVE):
  they already render two gov tiles (`data-cat="notices"` / `"meetings"`) — check what
  their `CAT_TO_PIPELINE` maps them to and split consistently, or they'll keep collapsing.
- `topics.js` header comment documents the pipeline keys — add the new one so the four
  string-match sites stay in sync.

**Ingest (`homesignal-ingest`) — the substance:**
- `digest.py`: make the **Meetings tier** match `user_subscriptions` with the
  meetings-stream key against `meetings.category`, and the **Notices tier** match the
  notices-stream key against `alerts.category`. (Today they very likely both fire off the
  single `government_notice` topic follow — confirm.)
- The `signup_complete` RPC / `user_subscriptions` writer: ensure the new pipeline key
  passes through and isn't rejected by a constraint.
- `CANONICAL_TOPICS` is **unchanged** — topics (categories) don't change, only the stream.

**DB:**
- Confirm whether `user_subscriptions.pipeline_type` has a CHECK constraint; if so, add the
  new value. `alerts.pipeline_type` is **not** touched (meetings aren't alerts).

## 5. Migration / back-compat — do NOT break existing subscribers
Existing government subscriptions are `{government_notice, topic}` and currently deliver
**both** streams. On rollout:
- **Backfill:** for every existing `{government_notice, topic}` row, also create a
  `{government_meeting, topic}` row for the same `(community_id, topic)` — so no current
  subscriber silently loses meeting alerts.
- Or have the digest treat a legacy `government_notice`-only follow as **"both"** until the
  user re-saves. Pick one; the backfill is the cleaner, explicit path.

## 6. Coordination
- This spans **site + ingest + DB → ship together** (rule 6: a cross-repo change).
- It **interacts with the in-flight multi-community subscription fix**. The subscription
  key is becoming `(community_id, stream, topic)`; make sure both changes agree on that
  composite key so they don't clobber each other.

## 7. Open questions to answer in the ingest session (don't guess)
1. Does `user_subscriptions.pipeline_type` (or equivalent) have a CHECK/allow-list? Values?
2. How does `digest.py` match the **Meetings** tier vs the **Notices** tier today — does it
   already distinguish, or does it surface a topic's meetings whenever the topic is followed?
3. Where is `signup_complete` defined (which repo / which `docs/*.sql`), and does it need a
   change to accept the new stream key?
4. Do `box-elder.html` / `eagle-mountain.html` map their two gov tiles to distinct keys, or
   both to `government_notice`?

## 8. Definition of done
A test subscriber follows **Planning *meetings*** only (not notices) on a community; the
digest dry-run delivers the Planning **meeting** but **not** the Planning **notice**; and an
existing Box Elder subscriber's coverage is unchanged (still gets both, via backfill).

---

### Provenance (site side, verified this session)
`community.html` `CAT_TO_PIPELINE` (notices + meetings → `government_notice`),
`buildSubscriptionSet` de-dupe, `signup_complete` write path, the alerts/meetings tables
and `alerts.pipeline_type` check constraint, and the two-tile split shipped in
`community.html`. Ingest-side specifics are intentionally left as "verify" — they live in
`homesignal-ingest`, not checked here.
