# Verify the Tremonton gov-site ingest config is COMMITTED

This checklist confirms the Tremonton gov-site configuration is **committed in the
ingest engine repo (`homesignal-ingest`)**, not merely running live. It lives in the
*site* repo only as a parked checklist — the code it verifies is in `homesignal-ingest`,
which is a separate repo. **Run this from a Claude Code session (or shell) scoped to
`homesignal-ingest`**, after granting that repo access.

Live status already confirmed on the DB side: 8 meetings (newest 7/28), 10 alerts. The
open question this answers is **committed vs. only-in-memory**.

The commands are discovery-based (whole-repo search), so they don't assume exact file
paths or the Tremonton domain. `grep` versions are given for portability; `rg` (ripgrep)
is faster if installed — swap `grep -rniE` → `rg -ni` and drop `--include` (use `-g '*.py'`).

---

## 0. Confirm you're in the ingest repo on the committed tip

```bash
git rev-parse --show-toplevel          # should end in /homesignal-ingest
git remote -v | head -1                # should show homesignal-ingest
git log --oneline -3                   # note the latest committed SHA
git status --porcelain                 # MUST be empty — proves committed, not just live/in-memory
```

## 1. Tremonton rows in feeds.csv (the two URLs)

```bash
# locate the feeds file(s)
git ls-files | grep -iE 'feed.*\.csv$|\.csv$'

# every committed Tremonton row (run against the path found above; feeds.csv assumed)
grep -niE 'tremonton' feeds.csv

# isolate the two endpoints explicitly
grep -niE 'tremonton[^,]*/feed/?'        feeds.csv   # the /feed/ notices URL
grep -niE 'tremonton[^,]*/events/feed/?' feeds.csv   # the /events/feed/ meetings URL

# pull just the URLs out, regardless of column layout
grep -noE 'https?://[^",[:space:]]*tremonton[^",[:space:]]*' feeds.csv
```

**PASS:** exactly two distinct Tremonton URLs — one ending `/feed/` (notices), one ending
`/events/feed/` (meetings) — present as committed CSV rows.

## 2. The 415 fix: browser User-Agent + Accept headers + per-run fetch cache

```bash
# UA + Accept headers in the fetch layer
grep -rniE "user-?agent|['\"]accept['\"]\s*:|mozilla/5\.0" --include='*.py' .

# the 415 trigger this was added to defeat
grep -rniE '\b415\b|unsupported media type' --include='*.py' .

# per-run fetch caching (so a good older article surfaces once, not per feed)
grep -rniE 'cache|lru_cache|functools\.cache|_fetched|seen_url|fetch_cache|@cache' --include='*.py' .

# confirm the headers are on the SAME fetch path the Tremonton feeds use
grep -rniE 'requests\.get|httpx\.|urlopen|session\.get|aiohttp' --include='*.py' .
# then read that function: sed -n '<start>,<end>p' <that_file.py>
# eyeball that headers= AND the cache wrap are both applied
```

**PASS:** a request-headers dict with a **browser `User-Agent`** AND an **`Accept`**
(e.g. `application/rss+xml,...`), on the shared fetch function, **and** a per-run cache
wrapper — reachable by the Tremonton rows (they use the generic fetcher; no per-feed
override needed).

## 3. Routing in code

```bash
# /feed/  -> subject-routed topics + "Public notices" catch-all
grep -rniE 'public notices' --include='*.py' --include='*.csv' .     # catch-all category present
grep -rniE 'subject|route|categor(y|ize)|topic' --include='*.py' .   # the subject-routing logic
grep -rniE '/feed/' --include='*.py' .                               # where /feed/ is handled

# /events/feed/ -> meetings table, labeled "City government (Tremonton)", geo "Tremonton, UT"
grep -rniE '/events/feed' --include='*.py' .                                   # routed to meetings, not alerts
grep -rniE 'city government \(tremonton\)' --include='*.py' --include='*.csv' . # meeting source label
grep -rniE 'tremonton,\s*ut' --include='*.py' --include='*.csv' .              # geographic_reference
grep -rniE 'meeting|meetings' --include='*.py' .                               # the meetings-table write path
```

**PASS:**
- `/feed/` routing: subject/topic routing **plus** a `"Public notices"` catch-all category.
- `/events/feed/` routing: routed to the **meetings** table with label
  `"City government (Tremonton)"` and geo `"Tremonton, UT"`.

---

## Summary table

| Check | PASS criteria |
|---|---|
| Committed (not just live) | `git status --porcelain` empty **and** the rows/code appear in `git ls-files`-tracked files |
| 1. feeds.csv | Two Tremonton URLs — one `…/feed/`, one `…/events/feed/` — as committed CSV rows |
| 2. 415 fix | Browser `User-Agent` + `Accept` headers on the shared fetch fn, **and** a per-run cache wrapper |
| 3a. `/feed/` routing | Subject/topic routing **plus** a `"Public notices"` catch-all |
| 3b. `/events/feed/` routing | Meetings table, label `"City government (Tremonton)"`, geo `"Tremonton, UT"` |

**If a pattern returns nothing:** retry without `--include` (config may be YAML/JSON/TOML,
not `.py`/`.csv`), e.g. `grep -rniE 'tremonton, ?ut' .`.
