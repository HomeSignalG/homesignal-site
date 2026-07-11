# Follow-up: replace the meetings-gate title regex with a structured `meeting_kind` flag

**Status:** documented, NOT implemented. Pick up cold from this file.
**Why it exists:** the dev-tracker "Proposed / weigh-in" (orange) band decides which government
meetings to surface. As of the v19 gate widening it admits a meeting when it is a public
governing-body meeting and EXCLUDES internal/administrative sessions **by matching the meeting
title against a keyword regex**. That regex is fragile — a vendor that titles a workshop
"Policy Discussion" or "Committee of the Whole" slips through as a public item (over-count), and a
real hearing titled oddly could be missed. The durable fix is to classify meeting kind **at ingest
time from each vendor's structured metadata** and have the engine gate key on that column instead of
guessing from the title.

## Where the fragile heuristic lives today (baseline to replace)

- **Engine gate** — `supabase/functions/get-address-report/index.ts`, function `devSites()`
  (deployed as get-address-report **v19**, version 27). The meetings loop:
  ```js
  const INTERNAL_MEETING_RE = /work session|study session|workshop|work meeting|press conference|
    ceremony|swearing|proclamation|flag raising|recognition|ribbon|executive session|closed session|
    briefing|retreat|training|orientation|agenda review|cancel/i;
  ...
  for (const m of meetings ?? []) {
    const mtitle = m.title || "";
    const openComment = m.is_public_hearing === true || m.comment_period_open === true;
    if (!openComment && INTERNAL_MEETING_RE.test(mtitle)) continue;   // <-- title guess to remove
    ...
  }
  ```
  The meetings query fetches all rows for the community chain (no flag filter, `.limit(400)`), and
  the loop above is the only place "internal vs public" is decided.
- **Ingest already sets a related flag** — `homesignal-ingest/ingest.py::is_public_hearing()`
  (~line 758) keys `is_public_hearing` on the word "hearing" in `notice_type`/`tags`/`title`. That
  flag is written to `meetings.is_public_hearing` in the meetings-row writer (~line 1586–1604,
  where `is_public_hearing`, `location`, `agenda_summary`, `dedupe_key` are stamped).

## Target design

### 1. New column
`meetings.meeting_kind text` — enum-like, one of:
`public_meeting | hearing | work_session | ceremonial | administrative | canceled | unknown`.
- `public_meeting` and `hearing` → SHOWN in the orange band.
- `work_session | ceremonial | administrative | canceled` → EXCLUDED.
- `unknown` → SHOWN (fail-open, matches today's "not obviously internal → show" bias) but logged so
  the mapping tables can be extended.

Migration (park in `docs/`, apply via `mcp__Supabase__apply_migration`):
```sql
alter table public.meetings add column if not exists meeting_kind text;
comment on column public.meetings.meeting_kind is
  'Structured meeting classification set at ingest from vendor metadata; drives the dev-tracker
   Proposed-band gate. One of public_meeting|hearing|work_session|ceremonial|administrative|canceled|unknown.';
create index if not exists meetings_meeting_kind_idx on public.meetings (meeting_kind);
```

### 2. Set it at ingest — per-adapter mapping (in `homesignal-ingest`)
Each adapter already returns item dicts; add a `meeting_kind` derived from the vendor's OWN
structured type field, NOT the title. Add a shared `classify_meeting_kind(item)` in `ingest.py`
(next to `is_public_hearing`) that dispatches on the source and its structured field:

- **CivicClerk** (`adapters/civicclerk.py`, `_event_item`): the OData `Events` payload carries
  `categoryName` (already read as `cat`). Map `categoryName`:
  - contains "hearing" → `hearing`
  - "voting"/"regular"/"board"/"council"/"commission"/"court"/"meeting" → `public_meeting`
  - "work"/"study"/"budget"/"briefing" → `work_session`
  - "ceremony"/"proclamation"/"recognition"/"press" → `ceremonial`
  - "executive"/"closed" → `administrative`
  - `isCancelled`/status cancelled → `canceled`
  - else → `unknown`. Emit `meeting_kind` on the item dict.
- **Granicus** (`parse_granicus_rss`): the RSS item title/category is the only structured signal
  Granicus exposes (agenda name). Prefer any `<category>`/type element; if only the agenda name is
  available, still map by its LEADING token (Granicus agenda names are structured, e.g.
  "Board Briefing", "Budget Work Session #3"). Same buckets as above.
- **Legistar** (`adapters/legistar.py`): the Web API `Events` object has `EventBodyName` (the body,
  e.g. "Board of Commissioners") and often an event-type/comment field. Map the body/type — a named
  standing body meeting → `public_meeting`; "Work Session"/"Committee" study bodies → `work_session`.
- **Utah PMN** (`ingest.py` html handler): PMN detail pages expose `notice_type`/`tags` (already
  parsed for `is_public_hearing`). Extend that parse into the full `meeting_kind` map. This is the
  one source where the current title/notice_type signal is already fairly structured.

Then in the meetings-row writer (~line 1604) add `"meeting_kind": classify_meeting_kind(it)`
alongside the existing `"is_public_hearing"`.

### 3. Engine gate change (after the column is populated)
Replace the `INTERNAL_MEETING_RE` guard in `devSites()` with a structured check:
```js
const SHOW_KINDS = new Set(["public_meeting", "hearing", "unknown"]);
...
const openComment = m.is_public_hearing === true || m.comment_period_open === true;
const kind = m.meeting_kind || "unknown";
if (!openComment && !SHOW_KINDS.has(kind)) continue;
```
Add `meeting_kind` to the `.select(...)` list on the meetings query. Keep `openComment` as the
monotonic override so a flagged hearing always shows (never regress). Deploy as a new engine version
(esbuild single bundle, <30 KB — see the MCP-deploy ceiling note in CLAUDE.md §8), then re-cache
`development_reports` (use `public.dev_refresh_fire()` / `dev_refresh_collect()`; mind EPA FRS
throttling — fire in small low-concurrency batches, see this session's rollout notes).

### 4. Backfill existing rows
Two options, do BOTH for safety:
- **Immediate SQL backfill** from the current title regex, so existing `meetings` rows get a
  `meeting_kind` without waiting for re-ingest (fail-open to `unknown`):
  ```sql
  update public.meetings set meeting_kind = case
    when lower(title) ~ 'hearing' then 'hearing'
    when lower(title) ~ 'work session|study session|workshop|work meeting|briefing|retreat|training|orientation|agenda review' then 'work_session'
    when lower(title) ~ 'press conference|ceremony|swearing|proclamation|flag raising|recognition|ribbon' then 'ceremonial'
    when lower(title) ~ 'executive session|closed session' then 'administrative'
    when lower(title) ~ 'cancel' then 'canceled'
    when lower(title) ~ 'commission|council|board|court|meeting|voting session' then 'public_meeting'
    else 'unknown' end
  where meeting_kind is null;
  ```
  (This reproduces today's gate exactly, so it's a no-op behavior change until the adapters start
  emitting better values on the next ingest.)
- **Authoritative re-ingest** per source once the adapters emit `meeting_kind`, which overwrites the
  regex-derived values with vendor-metadata-derived ones.

### 5. Acceptance
- Spot-check a CivicClerk county (Travis 78617), a Granicus county (Clark/Hennepin), a Legistar
  county (King/Genesee), a PMN county (Utah/Box Elder): the orange count should match
  "public governing-body meetings", and known internal items (Multnomah "Budget Work Session #N",
  Travis "Press Conference", Clark "Planning Commission Briefing") must be excluded via
  `meeting_kind`, NOT the title regex.
- `verify-development` CI stays green.

## Cross-references
- Gate rationale + the sample verification that motivated this: this session's rollout (v19 gate
  widening); `CLAUDE.md` §3/§8.
- Adapter registry: `homesignal-ingest` `docs/state-notice-portals.md`, `docs/source-registry.md`.
