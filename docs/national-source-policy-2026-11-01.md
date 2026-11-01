# National source policy (founder decision, 2026-11-01)

Dated record. It governs which records may appear on JODY's maps, feeds and Development Activity Reports. It replaces
founder ruling R7 (`docs/development-activity-founder-ruling-r7-2026-10-04.md`) and the per-source clearance process
built on the September rights audit (`docs/corporate-output-source-rights-audit-2026-09-27.md`). Both are kept as history,
each carrying a superseded notice.

## 1. The decision, in the founder's words (2026-11-01)

> I have already removed the following two requirements nationally for JODY:
> 1. Requiring verification that source terms are silent or permissive.
> 2. Requiring verification that nothing prohibits commercial use, bulk copying, or redistribution.
>
> Do not reintroduce either requirement through Option B, Option C, a new class-based approval process, or a manual
> exception queue.

> * Official government development records should enter the national ingestion pipeline without individual owner approval.
> * Eligible records should flow automatically into JODY maps, feeds, and Development Activity Reports.
> * Adding cities, counties, and states should not require changes to a manually maintained source allowlist.
> * Remove obsolete policy gates consistently across code, tests, documentation, and workflows.
> * Preserve factual accuracy, source provenance, and record verification.
> * Do not interpret removal of internal checks as permission to disregard independently applicable legal or contractual
>   restrictions.

And, on records that cannot be traced:

> Every Development Activity Report record needs to be traceable to an official government record. But I would also have
> Claude investigate those five records and restore their source associations wherever possible. Exclusion should not mean
> permanently losing valid data.

On the September rights audit:

> Preserve it as historical documentation. Clearly mark it as superseded by the November 1 national policy, so future
> Claude Code sessions don't accidentally revive outdated approval requirements.

## 2. What a record needs

A development record may appear in a report when:

1. a wired connector produced it, so it carries its **source family** (`registry_id`, stamped from the connector's own
   `source_registry_id`);
2. it carries its **official record link** (`source_ref`);
3. it passes the existing accuracy rules: status and type vocabularies, ZIP polygon membership, the geocode fence, date
   sanity, the standing-inventory rule, and so on.

A record with no source family is left out, and the report says so: *"Some records near this address are not included
because their official source is not identified."* That is a provenance rule, not a rights rule.

There is **no** per-source allowlist, terms check, class approval or review queue. Adding a city, county or state is its
registry entry and nothing else.

## 3. What is kept, and why it is not an allowlist

- **Credit lines** (`supabase/functions/_shared/source-attribution.json`). Three publishers recorded a required credit line
  (NYC Department of Buildings ×2, City of Seattle). The report carries it. A source absent from the file carries no
  credit line and is included anyway.
- **A source whose known written terms forbid commercial use** (the North Dakota DOT work-zone layer) is not wired. That is
  an onboarding fact recorded in `docs/source-registry.md`. Nobody has to go looking for terms.

## 4. Where it is enforced

- `supabase/functions/_shared/national-report.ts` and `changes-since-report.ts`: the provenance rule; no clearance lookup.
- `supabase/functions/get-address-report/sources/tdlr-tabs.ts`: TDLR TABS records now carry the source family `tdlr-tabs`.
  Before this they carried none, so the five Caldwell Lane filings at ZIP 78617 were stored with no family and left out.
- `test/no-source-allowlist.test.mjs`: fails if an allowlist, a clearance lookup or an "uncleared" blocker comes back, if a
  source no file has ever named does not reach the report, or if a superseded document loses its notice.

## 5. Measured when this was written (read-only, production, 2026-11-01)

- Registry: 256 sources. Old allowlist: the same 256, so removing it changed no report on the day.
- `app_projects` development rows with no `registry_id`: 5. All are TDLR TABS filings at 78617; they return once
  `get-address-report` is deployed with the TABS change and 78617 is refreshed.
- Map 1 (`geo.n5_accepted_source`): 6 registry sources had no row, so Map 1 drew none of their records. Of these, only
  `baltimore-city-housing-permits` had stored records (2,824). That gate is removed separately; see
  `docs/national-source-eligibility-architecture-2026-11-01.md` §2.2.
