# State notice-portal registry — the government-content frontier, mapped

**Purpose.** HomeSignal's *pages* are pure data (§0 of `CLAUDE.md`): all 12,315 communities
across 50 states are live and subscribable with zero code. What is **not** yet pure data is the
**government content** on those pages — Notices + Meetings from each community's own city
council / county commission. Today that content exists for **exactly 3 Utah communities**
(Utah County, Box Elder, Eagle Mountain). Everywhere else the government tiles are empty (the
page still shows the universal News / Emerging Tech / Global tiers).

This doc is the **verified map** of how to close that gap: for every state, where its
first-party government notices actually live, and — critically — **what engineering each one
costs**. It is the reusable input that turns "wire 49 states" from a marathon into a sequenced
pipeline. It was built by direct research (evidence URL on every row); classifications rest on
each system's own operator language + the governing statute. `.gov` portals frequently return
HTTP 403 to automated fetchers, so several rows are confirmed via the operating entity named in
indexed page text + statute rather than a live page render — flagged where it matters.

---

## The two hard rules this map enforces

1. **First-party government sources only.** A state/county/city *government-run* notice system —
   never a newspaper- or press-association aggregator (`*publicnotice*.com` run by a Press
   Association), never a content aggregator (Google/Yahoo/etc). This is non-negotiable
   (`CLAUDE.md` claims discipline + §4). Many states' *only* statewide option is an aggregator;
   those are **off-limits** and marked `AGGREGATOR_ONLY` below.
2. **Never fabricate.** A community with no wired first-party feed shows **empty** government
   tiles, never a plausible-looking one.

---

## The engineering reality (read before planning any state)

Adding a **community** is pure data. Adding a **state's government content is not** — and the
reason is specific and verified in code:

- `homesignal-ingest/ingest.py`'s `source_type=html` handler is **Utah-PMN-specific**:
  `is_pmn_body_url()` hard-checks `"utah.gov/pmn"`, and `parse_pmn_body()` / `parse_pmn_notice()`
  / `_parse_pmn_date()` assume utah.gov/pmn's exact URL scheme
  (`/pmn/sitemap/publicbody/<id>.html`) and HTML shape. (There are also one-off special cases,
  e.g. `bcutah.gov`, `waterrights.utah.gov`.)
- Therefore **each distinct portal format needs its own parser adapter** in the ingest repo.
  Utah works only because someone built the PMN parser. Nevada's `notice.nv.gov` (ASP.NET MVC,
  `/PublicBody/…` routes) or Rhode Island's `opengov.sos.ri.gov` have different HTML and would
  each need a new adapter.
- **Only the ingest half is engineering.** The site half (a state's ZIP/county/city rows) is
  already done for all 50 states. So the frontier is entirely: *parser adapters + per-jurisdiction
  body-URL discovery*, done in `homesignal-ingest`, verified on CI (the sandbox has no egress).

### The leverage move: wire the VENDOR, not the state

The highest-value insight from this research: local governments don't hand-roll their agenda
sites — they buy them from a **small set of civic-tech vendors**, and those vendors use
**consistent, parseable URL/HTML patterns across every state**. Verified example: Douglas County,
NV publishes to `douglascountynv.granicus.com/ViewPublisher.php?view_id=1`; **Granicus** hosts
agendas for thousands of US counties/cities. notice.nv.gov itself is partly a *link directory*
pointing out to bodies' own (often Granicus) sites.

So one **Granicus adapter** could unlock local council/commission Meetings in *every* state at
once — independent of whether that state has a first-party statewide portal — and similarly for
the other big vendors. This is almost certainly a better first investment than 25 bespoke
state-portal parsers:

| Vendor | Typical URL signature | Rough footprint |
|---|---|---|
| **Granicus** (incl. Legistar, GovDelivery) | `<entity>.granicus.com/ViewPublisher.php?view_id=N`; `<entity>.legistar.com` | Very large — thousands of county/city agendas |
| **CivicPlus / CivicClerk / Agenda Center** | `<entity>.civicplus.com`, `/AgendaCenter`, `<entity>.civicclerk.com` | Very large — municipal sites |
| **PrimeGov** | `<entity>.primegov.com/public/portal` | Growing — large cities |
| **eSCRIBE / Novus AGENDA** | `pub-<entity>.escribemeetings.com`, `<entity>.novusagenda.com` | Moderate |

> Recommended sequencing (see "Wire order" at the bottom): build **one Granicus adapter first**,
> point it at a handful of already-modeled counties, verify Meetings land, then widen. Bespoke
> first-party state-portal parsers come *after*, and only for the states whose portal actually
> carries **local** bodies (very few — see the first table).

### ✅ Granicus RSS path — VALIDATED with live data (2026-07-05)

Confirmed on a GitHub runner (the read-only probe `homesignal-ingest scripts/probe_granicus_rss.py`,
run `28746915043`, since the sandbox has no egress). Target: **Douglas County, NV**
(`douglascountynv.granicus.com`, community root `519481a8-9535-4fb5-9413-e5e36a3e8f97`).

- **`ViewPublisherRSS.php?view_id=1&mode=agendas` → HTTP 200, 84,697 B, 102 items.** Real upcoming
  local meetings, e.g. `Board of County Commissioners - Supplemental - Jul 02, 2026`,
  `Airport Advisory Committee - Jul 07, 2026`, `Library Board of Trustees …`. `view_id=1` is the
  county's **all-bodies** feed; `view_id≥3` → 404; `view_id=2` is an internal test view (ignore).
- **The meeting date is in the `<title>` (`… - Jul 20, 2026`), NOT `pubDate`.** `pubDate` is the
  *posting* date (e.g. posted Jun 29 for a Jul 20 meeting). So a generic `source_type=rss` row
  would mis-date every meeting. **The one required piece of engineering:** a small Granicus adapter
  that (a) recognizes a `*.granicus.com/ViewPublisherRSS.php` source, (b) parses the trailing
  `- Mon DD, YYYY` from each title into `meetings.meeting_date`, (c) maps items to the meetings
  schema. ~30 lines, **state-agnostic** (works for any Granicus entity), dwarfed in value by its
  reach. This is the concrete next build; it is NOT pure feeds.csv data (per the engineering-reality
  section above), but it is one adapter, not 25.
- Net: the vendor-adapter thesis is confirmed with real content. A single Granicus adapter turns
  every already-modeled county whose government runs Granicus into a live-Meetings page.

### 🟢 Non-Utah government content is LIVE — 9 counties / 6 states (523 meetings)

Shipped end-to-end this build (DB-verified). From Utah-only to **9 counties across 6 states**, all
anchored to their county root under `County Commission & county business`, all first-party, all
correctly dated (adapters drop undated/unsourced items — no fabrication):

| County | Meetings | Upcoming | Vendor |
|---|---|---|---|
| Clark County, NV | 104 | 5 | Granicus (`clark` view 28) |
| Wake County, NC | 102 | 2 | Granicus (`wake` view 18) |
| Hennepin County, MN | 100 | 0 | Granicus (`hennepinmn` view 2) |
| Douglas County, NV | 100 | 2 | Granicus (`douglascountynv` view 1) |
| Genesee County, MI | 25 | 13 | Legistar (`geneseecountymi`) |
| Mecklenburg County, NC | 25 | 1 | Legistar (`mecklenburg`) |
| Washoe County, NV | 24 | 7 | Legistar (`washoe-nv`) |
| King County, WA | 24 | 9 | Legistar (`kingcounty`) |
| Pima County, AZ | 19 | 0 | Legistar (`pima`) |

Two vendor adapters carried all of it: the new state-agnostic **Granicus RSS** (`parse_granicus_rss`,
ingest PR #120) and the existing **Legistar** (`adapters/legistar.py`). Every county's titles were
DB-verified as real bodies (e.g. Pima "Board of Supervisors", Mecklenburg "Board of Commissioners",
Wake "Regular Meeting … BOC", Hennepin standing committees). Douglas has 0 subscribers so it was
pages-only, no emails; the others likewise only populate their previously-empty Meetings tiles.

- **Reusability proven — widening is pure data.** Add one feed row per county — Granicus
  `rss → <entity>.granicus.com/ViewPublisherRSS.php?view_id=N&mode=agendas`, or Legistar
  `html → <client>.legistar.com/Calendar.aspx` — keyed to the county root. No new code.
- **The frontier blocker was the `feeds.csv` → `public.feeds` sync, not the adapters.** Config is
  DB-first (`load_config`), so a feed added only to `feeds.csv` never runs on the schedule — which is
  exactly why Genesee sat at 0 despite a "LIVE — 25 events" note (now genuinely live: 25 meetings, 13
  upcoming). The wire pattern that works: `dryrun-feed.yml` (read-only) → insert row into
  `public.feeds` → `golive-feed.yml` or full ingest → **verify meeting titles** (confirm the right
  body). Existing adapters: Granicus RSS, Legistar, iQM2, CivicPlus AgendaCenter.
- **Honest caveats:** (1) Granicus `agendas` skews to a recent *archive* (e.g. Douglas/Hennepin show
  few future-dated at ingest time in July); the tile shows upcoming, the rest are real history. (2)
  **CivicClerk (`*.portal.civicclerk.com`) has no adapter yet** — Oakland MI / Travis TX / Salt Lake UT
  are deferred until one is built. (3) **Maricopa AZ** uses CivicPlus AgendaCenter on its own domain;
  the default category returned only the Community Action Commission (not the Board of Supervisors), so
  its feed is **disabled** pending the correct category CID.

---

## Tier 1 — first-party portals that carry LOCAL bodies (the Utah-style path)

These are the only states where a **single state portal** publishes city-council / county-commission
notices (what residents actually subscribe to). Utah is the shipped reference. Each still needs a
parser adapter for its portal format, but no per-jurisdiction hunting.

| State | System | URL | Operator (statute) | Local coverage | Note |
|---|---|---|---|---|---|
| **UT** | Public Meeting Notices (PMN) | utah.gov/pmn | State, Utah Code §63F-1-701 | **Yes** — city + county bodies | ✅ SHIPPED (reference parser) |
| **NV** | Nevada Public Notices | notice.nv.gov | Dept. of Administration, NRS 232.2175 / 241.015 | **Yes** — state + county + city + school + special districts | Partly a link-directory to bodies' own (Granicus) sites → Granicus adapter may serve it better |
| **RI** | OpenMeetings (OpenGov) | opengov.sos.ri.gov/openmeetings | Dept. of State, RIGL §42-46-6/7 | **Yes** — state + municipal | Full electronic filing of notices + minutes |
| **ND** | ND Public Meeting Notices (NDPMN) | apps.nd.gov/sos/ndpmn | Secretary of State, NDCC ch. 44-04 | **Likely** — "public entities" incl. political subdivisions (confirm depth) | Cleanest structural Utah-PMN analogue |
| **OH** | State of Ohio Public Notice | publicnotice.ohio.gov | State of Ohio | **Political subdivisions** — but **DEMOTED 2014** (HB483) in favor of the ONA aggregator | ⚠️ verify the .gov site is still populated before relying on it |

## Tier 2 — first-party portals scoped to STATE agencies only

Genuinely government-run and first-party, but they publish **state boards/agencies**, not local
city councils. Wiring them yields state-agency notices that don't map to the per-county community
model — so for **local** content these states still need the **vendor path** per jurisdiction.
Listed for completeness / future statewide-agency tier.

| State | System | URL | Operator |
|---|---|---|---|
| AL | Open Meetings | openmeetings.alabama.gov | Secretary of State |
| AK | Online Public Notices | aws.state.ak.us/OnlinePublicNotices | State of Alaska |
| AZ | Public Meetings | publicmeetings.az.gov | State of Arizona (opt-in) |
| AR | Public Meetings | portal.arkansas.gov/public-meetings | State of Arkansas |
| CT | Public Meeting Calendar | egov.ct.gov/pmc | Secretary of the State |
| DE | Public Meeting Calendar | publicmeetings.delaware.gov | Gov. Information Center / Dept. of State |
| HI | State Public Meetings Calendar | calendar.ehawaii.gov | DAGS / OIP (Sunshine Law) |
| IA | Public Meeting Calendar | iowa.gov/public-meetings | State of Iowa (OCIO) |
| ME | Government Meeting Calendar | maine.gov/portal/government/calendar.shtml | Dept. of Libraries |
| MS | Public Meeting Notices (PMN) | ms.gov/dfa/pmn | Dept. of Finance & Administration |
| NE | Public Meeting Calendar | nebraska.gov/calendar | State of Nebraska |
| NC | Public Meetings Calendar | sosnc.gov (General Counsel) | Secretary of State |
| NJ | Statewide Legal Notices Listings | nj.gov/state/statewide-legal-notices-list.shtml | Dept. of State (directory; eff. Mar 1 2026) |
| OK | Open Meetings Portal | openmeetings.ok.gov | Secretary of State |
| PA | Sunshine Meeting Notices | pa.gov/agencies/oa/sunshine-meeting-notices | Office of Administration |
| TX | Open Meetings notices | sos.state.tx.us/open | Secretary of State (state/regional) |
| VT | State Agency Meeting Calendar | libraries.vermont.gov/public-meeting-calendar-state-agencies | Dept. of Libraries |
| VA | Commonwealth Calendar | commonwealthcalendar.virginia.gov | Commonwealth (+ Regulatory Town Hall) |
| WA | Washington State Register | leg.wa.gov (Code Reviser) | Office of the Code Reviser |
| WV | Meeting Notices database | apps.sos.wv.gov/adlaw/meetingnotices | Secretary of State |
| WI | Public Meeting Notices | publicmeetings.wi.gov | Dept. of Administration |

## Tier 3 — AGGREGATOR_ONLY (off-limits under the first-party rule)

The only statewide option is a newspaper/press-association aggregator. **Do not ingest these.**
For these states, local content must come from the **vendor path** (Granicus etc.) or each body's
own government site.

| State | Aggregator (barred) | Run by |
|---|---|---|
| CO | publicnoticecolorado.com | Colorado Press Association |
| FL | floridapublicnotices.com | Florida Press Association |
| GA | georgiapublicnotice.com | Georgia Press Association |
| ID | idahopublicnotices.com | Newspaper Association of Idaho |
| IL | publicnoticeillinois.com | Illinois Press Association |
| IN | publicnoticeindiana.com | Hoosier State Press Association |
| KS | kansaspublicnotices.com | Kansas Press Association / Newz Group |
| MN | mnpublicnotice.com | Minnesota Newspaper Association |
| MO | mopublicnotices.com | Missouri Press Association |
| MT | montanapublicnotices.com | Montana Newspaper Association |
| NY | newyorkpublicnotices.com | Column / NY Press Association |
| OR | publicnoticeoregon.com | Oregon Newspaper Publishers Association |
| SC | scpublicnotices.com | South Carolina Press Association |
| SD | sdpublicnotices.com | South Dakota NewsMedia Association |
| TN | tnpublicnotice.com | Tennessee Press Service |
| WY | wyopublicnotices.com | Wyoming Press Association |

## Tier 4 — COUNTY_ONLY (no statewide first-party system at all)

Notices are decentralized to each government body's own site. Vendor path only.

| State | Basis |
|---|---|
| CA | Bagley-Keene — each agency posts on its own site; no central portal |
| KY | Each body posts locally (AG Open Meetings guide) |
| LA | Mandated one-stop portal **repealed** before launch (Act 374, 2025) |
| MD | Decentralized — Maryland Register + each body's site |
| MA | mass.gov keeps only a **directory of posting locations**, not a notice feed |
| MI | OMA — each public body posts on its own site |
| NH | RSA 91-A:2 — each body posts on its own site / local paper |
| NM | "Sunshine Portal" is spending-transparency, **not** meeting notices |

---

## Tally

- **Tier 1 (first-party, LOCAL bodies):** 5 — UT (shipped), NV, RI, ND, OH(⚠️demoted).
- **Tier 2 (first-party, state agencies only):** 21.
- **Tier 3 (aggregator-only, barred):** 16.
- **Tier 4 (county-only, no statewide):** 8.
- **Total: 50.** ✅

Blunt read: the "one state portal → every county" pattern that made Utah easy repeats cleanly in
**at most ~4 more states** (NV, RI, ND, and maybe OH). For the other ~45, local council/commission
content does **not** live in one first-party statewide place — which is exactly why the **vendor
adapter** strategy (Granicus first) is the real unlock, not 45 more portal parsers.

## Wire order (recommended)

1. **Granicus adapter** in `homesignal-ingest` (new `parse_granicus_*` + `source_type=granicus`),
   pointed at a few already-modeled counties (e.g. Douglas County NV, plus a large metro like
   Clark County NV or a Colorado Front Range county). Verify Meetings land in the DB via CI.
   This single adapter is state-agnostic and immediately widens coverage.
2. **RI + ND** first-party portal parsers (Tier 1, local coverage, clean per-body structure).
3. **NV** — likely served by the Granicus adapter (step 1) more than by a notice.nv.gov parser;
   confirm which bodies file full content on the portal vs. link out.
4. **OH** — only after verifying publicnotice.ohio.gov is still populated post-2014 demotion.
5. Then the **vendor adapters** for CivicPlus/CivicClerk, Legistar, PrimeGov to reach the long
   tail across all Tier 2/3/4 states.

Everything here is **ingest-repo work, CI-verified** (the sandbox has no egress). The site side is
done. No community row changes are required by any of it.
