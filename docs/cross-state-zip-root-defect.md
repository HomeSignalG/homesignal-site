# Cross-state ZIP root defect — investigation, scope, and proposed fix

**Status:** investigated and proven. **Nothing applied.** Awaiting founder go-ahead.
**Date:** 2026-07-27. **Trigger:** ZIP 79922 anchoring El Paso, TX news to Doña Ana County, NM.

---

## 1. What is wrong (root cause, proven — not inferred)

ZIP **79922 is an El Paso, Texas ZIP** that is modeled in `public.communities` as a
New Mexico page under a New Mexico county root.

Live row (`select … from public.communities where zip_codes @> array['79922']`):

| id | name | level | county | state | parent_id |
|---|---|---|---|---|---|
| `d5f7fb9f-…` | `El Paso (79922)` | `zip` | **Doña Ana** | **NM** | `5e4429ae-…` |
| `5e4429ae-…` | `Doña Ana County` | `county` | Doña Ana | NM | `null` |

Authoritative crosswalk — `zipcodes` PyPI **v3.0.0**, the same bundled offline USPS
dataset every state build pins (site CLAUDE.md §12.0):

```
79922 El Paso   El Paso County TX
79835 Canutillo El Paso County TX
```

**Origin.** `docs/remaining-states-communities-seed.sql` — the 42-remaining-states build:

- line 276 — `('Doña Ana County','Doña Ana','NM','county','dona-ana-county-nm',array['79835','79922','87936',…])`
- line 8057 — `('El Paso (79922)','Doña Ana','NM','zip','el-paso-79922',array['79922'],…)`

**Classification: a source-data defect in one build, not a resolver bug and not a
Local News bug.** That build keyed county identity on `county_fips` from the U.S.
Census 2020 **ZCTA5→County Relationship File**. A ZCTA whose polygon straddles a
state line appears under the counties it overlaps, so a Texas ZCTA that spills across
the NM line was emitted under the New Mexico county. The build already knew this class
existed and hand-resolved exactly two cases (`20135` Bluemont VA, `82701` Newcastle WY)
to their authoritative USPS state — the remaining cases were never swept for.

The resolver, the ZIP→page engine, the Gold Master driver and the topic gate all
behaved correctly; they faithfully followed a wrong parent pointer.

---

## 2. Scope — how many ZIPs share the condition

Every one of the **12,722** `level='zip'` rows was reconciled against `zipcodes` v3.0.0
(12,722 parsed, 0 parse anomalies, 2 ZCTA-only ZIPs absent from the USPS dataset and
skipped rather than guessed). **19 ZIP pages carry the wrong state.** All 19 are
cross-state border ZCTAs — the defect is systematic and bounded, not one-off.

| ZIP | page name | modeled | authoritative | correct-state county root modeled? |
|---|---|---|---|---|
| 21874 | Willards (21874) | DE / Sussex | **MD / Wicomico** | no |
| 21912 | Warwick (21912) | DE / New Castle | **MD / Cecil** | no |
| 30741 | Rossville (30741) | TN / Hamilton | **GA / Walker** | no |
| 42223 | Fort Campbell (42223) | TN / Montgomery | **KY / Christian** | no |
| 56136 | Hendricks (56136) | SD / Brookings | **MN / Lincoln** | no |
| 56744 | Oslo (56744) | ND / Grand Forks | **MN / Marshall** | no |
| 57255 | New Effington (57255) | ND / Richland | **SD / Roberts** | no |
| 58436 | Ellendale (58436) | SD / Brown | **ND / Dickey** | no |
| 58439 | Forbes (58439) | SD / Brown | **ND / McPherson** | no |
| 59221 | Fairview (59221) | ND / McKenzie | **MT / Richland** | no |
| 59270 | Sidney (59270) | ND / McKenzie | **MT / Richland** | no |
| **79835** | Canutillo (79835) | NM / Doña Ana | **TX / El Paso** | **YES** |
| 79837 | Dell City (79837) | NM / Otero | **TX / Hudspeth** | no |
| **79922** | El Paso (79922) | NM / Doña Ana | **TX / El Paso** | **YES** |
| 81137 | Ignacio (81137) | NM / San Juan | **CO / La Plata** | no |
| 83120 | Freedom (83120) | ID / Bonneville | **WY / Lincoln** | no |
| **84536** | Monument Valley (84536) | AZ / Navajo | **UT / San Juan** | **YES** |
| 86514 | Teec Nos Pos (86514) | NM / San Juan | **AZ / Apache** | no |
| 99128 | Farmington (99128) | ID / Latah | **WA / Whitman** | no |

Two facts that make the fix safe:

- **No collision.** For all 19, the correct-state county's `zip_codes` array does **not**
  also claim the ZIP (`correct_state_county_also_claims = 0` for every row). Fixing
  cannot create a duplicate same-level claim.
- **Only 3 are fully repairable today** (79835, 79922 → `el-paso-county-tx`; 84536 →
  `san-juan-county-ut`). The other 16 counties were never modeled — the 42-states build
  seeded top-10 counties per state — so there is no correct root to attach them to.

---

## 3. Affected products

| Product | Impact today |
|---|---|
| **Local News** | The 73 El Paso TX articles anchored to Doña Ana County NM (§4). Currently **not visible on any page** — the 25 NM-rooted ZIPs were deliberately left un-materialized during the topic-gate rollout. |
| **Government Notices / Meetings** | A wrong-state page inherits the **foreign state's** county government via the parent cascade. Latent only: none of the 19 ZIPs currently materializes any government row (`gov_rows = 0` for all 19), because none of those roots carries wired content. |
| **Development Tracker** | Unaffected in substance — `development_reports` is keyed per ZIP with its own pinned centroid, and the engine's coverage gate is keyed on the ZIP's own state/county. |
| **Subscriber email** | No impact. `digest.py` matches on `subtopics` ∩ follows; it never reads community state. |

---

## 4. The 73 Doña Ana-anchored Local News rows

All 73 are **El Paso, Texas** publishers:

| publisher | rows | qualifying |
|---|---|---|
| `www.ktsm.com` (KTSM 9 News, El Paso TX) | 34 | 3 |
| `elpasomatters.org` (El Paso Matters, TX) | 24 | 4 |
| `kfoxtv.com` (KFOX14, El Paso TX) | 14 | 0 |
| `www.elpasoinc.com` (El Paso Inc., TX) | 1 | 0 |

All created `2026-07-27` (the first Gold Master ingestion), `geo_evidence.status='routed'`,
`method='place'`.

**Decisive finding — they are 100% duplicates.** Checked on `source_url` identity against
El Paso County TX (which holds 74 local_news rows):

```
nm_rows                   73
tx_rows                   74
nm_urls_already_under_tx  73
nm_urls_unique_to_nm       0
qualifying_dupes           7
```

Every single El Paso article is **already correctly anchored to El Paso County, TX**.
The Gold Master workbook maps El Paso ZIPs to El Paso publishers; the correctly-modeled
El Paso ZIPs routed them to the TX root, and the two mis-modeled ZIPs (79922, 79835)
routed the same articles a second time to the NM root.

**Disposition: REMOVE the 73, do not re-ingest, do not re-materialize.**

- *Re-materialize* is wrong — it would publish Texas journalism on New Mexico ZIP pages.
- *Rewrite* (re-point `community_id` to El Paso County TX) is wrong — it would create 73
  genuine duplicates of rows that already exist there.
- *Remove + re-ingest* — the re-ingest half is unnecessary: **zero unique content is lost**,
  proven by `nm_urls_unique_to_nm = 0`.

Removal is idempotent and safe **only after** the ZIP modeling is fixed; otherwise the next
registry run re-creates them from the same wrong parent pointer.

---

## 5. Proposed minimal change (NOT APPLIED)

Sequenced: fix the model first, then remove the duplicates it generated.

### 5a. Repair the 3 repairable ZIP rows

```sql
-- 79835 + 79922 -> El Paso County, TX
update public.communities
   set state = 'TX', county = 'El Paso',
       parent_id = (select id from public.communities where slug = 'el-paso-county-tx')
 where level = 'zip'
   and (zip_codes @> array['79835'] or zip_codes @> array['79922']);

-- 84536 -> San Juan County, UT
update public.communities
   set state = 'UT', county = 'San Juan',
       parent_id = (select id from public.communities where slug = 'san-juan-county-ut')
 where level = 'zip' and zip_codes @> array['84536'];

-- drop the two TX ZIPs from the NM county-level array (they were never NM)
update public.communities
   set zip_codes = array_remove(array_remove(zip_codes,'79835'),'79922')
 where slug = 'dona-ana-county-nm';
```

Affected: **3 ZIP pages + 1 county array.** The remaining **16** ZIPs need their correct
county root seeded first — that is a normal community-build task, not a schema change, and
is logged as follow-up rather than bundled here.

### 5b. Remove the 73 duplicate rows (only after 5a)

```sql
delete from public.alerts a
 using public.communities c
 where a.community_id = c.id
   and c.slug = 'dona-ana-county-nm'
   and a.category = 'local_news'
   and a.source_url in (
     select a2.source_url from public.alerts a2
      join public.communities c2 on c2.id = a2.community_id
     where c2.slug = 'el-paso-county-tx' and a2.category = 'local_news');
```

The `source_url in (…already under TX…)` clause is the safety interlock: it can only ever
delete a row whose content demonstrably survives elsewhere. Expected: **73**.

### 5c. Rollback

```sql
-- 5a rollback: restore the seeded (defective) modeling exactly
update public.communities
   set state='NM', county='Doña Ana',
       parent_id=(select id from public.communities where slug='dona-ana-county-nm')
 where level='zip' and (zip_codes @> array['79835'] or zip_codes @> array['79922']);

update public.communities
   set state='AZ', county='Navajo',
       parent_id=(select id from public.communities where slug='navajo-county-az')
 where level='zip' and zip_codes @> array['84536'];

update public.communities
   set zip_codes = zip_codes || array['79835','79922']
 where slug='dona-ana-county-nm' and not (zip_codes @> array['79922']);
```

`5b` is **not reversible by SQL** — but it needs no rollback: the deleted rows are
byte-identical duplicates of rows retained under El Paso County TX, and the Gold Master
registry re-creates any El Paso article on its normal 2-hour cadence.

### 5d. Proof it will not disturb legitimate cross-border coverage

- **No ZIP loses a page.** All three keep their `level='zip'` row and their `zip_codes`
  array; only `state`, `county`, `parent_id` change. `?zip=79922` still resolves.
- **No same-level collision is created** — `correct_state_county_also_claims = 0` for all
  19, verified live.
- **Doña Ana County keeps its real coverage**: 25 ZIPs → 23 after removing the two Texas
  ZIPs that were never New Mexico. Every genuine NM ZIP page is untouched.
- **El Paso County TX gains nothing it did not already have** — its 143 child ZIP pages and
  74 local_news rows are unchanged; 79922/79835 simply join the county they belong to.
- **Genuine cross-*county* border ZIPs are untouched.** This change keys strictly on
  `state` disagreement with the authoritative USPS dataset. The established
  cross-county-border policy (build the ZIP page, keep it off the other county's
  county-level array) is not modified, and no cross-county ZIP appears in the 19.

---

## 6. Follow-up (logged, not blocking)

1. Seed the 16 missing county roots, then repair their ZIPs the same way.
2. Add a `state`-vs-USPS assertion to `scripts/verify-communities.mjs` so this class is
   caught by CI instead of by a downstream content anomaly.
