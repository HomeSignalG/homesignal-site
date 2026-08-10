-- ============================================================================================
-- Del Valle FRS Organization Affiliation integration pilot — ZIP 78617 ONLY
-- Applied 2026-08-10. This file is the SQL OF RECORD (repo convention: docs/*.sql are parked,
-- applied via mcp__Supabase__apply_migration). It documents what was built, and — more
-- importantly — what the schema makes IMPOSSIBLE.
--
-- WHAT FRS IS. The EPA Facility Registry Service publishes owner / operator / parent
-- affiliations for a regulated facility. It is a REAL government source and it fills gaps no
-- other wired source fills. But it identifies the organization by NAME — no CN, no RN, no
-- reliable DUNS (populated on 7 of 40 pilot rows) — so it can corroborate a stronger source
-- and it can answer a question nothing else answers, and it can NEVER outrank an
-- identifier-backed chain or make a corporate parent verified.
--
-- SCOPE HELD. Texas combined download only (state_combined_tx.zip / TX_ORGANIZATION_FILE.CSV),
-- filtered on the 29 FRS registry ids HomeSignal already holds for 78617 plus 2 same-address
-- controls. NATIONAL_ORGANIZATION_FILE.CSV was NOT downloaded. CONTACT_FILE was NOT extracted
-- (named individuals). No production pipeline, no statewide feature, no ESG.
-- Extraction workflow: .github/workflows/frs-org-delvalle-extract.yml (one-shot, read-only).
-- ============================================================================================


-- ── 1. The evidence hierarchy, as a NAMED ORDERED VOCABULARY — not a score ───────────────────
-- The brief asked for a hierarchy and explicitly said not to invent a numeric score. A rank
-- FUNCTION gives ORDER (which is all arbitration needs) without giving the tiers arithmetic:
-- nothing can average them, sum them, or present "2.5" to a reader.
create or replace function public.evidence_tier_rank(_tier text)
returns integer language sql immutable as $$
  select case _tier
    when 'identifier_backed'    then 1   -- agency identifier chain (TCEQ CN -> RN)
    when 'authoritative_filing' then 2   -- a filing that STATES the role (TDLR TABS, SEC EX-21)
    when 'frs_affiliation'      then 3   -- EPA FRS organization affiliation (name-matched)
    when 'candidate'            then 4   -- a lead; never presentable as a resolved role
    else 9 end
$$;

-- Backfilled onto the existing resolved-roles table. FRS writes ZERO rows here — measured
-- 2026-08-10: 13 rows in property_company_roles, 0 with evidence_tier='frs_affiliation'.
alter table public.property_company_roles
  add column if not exists evidence_tier text
  check (evidence_tier in ('identifier_backed','authoritative_filing','frs_affiliation','candidate'));


-- ── 2. The raw affiliations, stored VERBATIM ─────────────────────────────────────────────────
-- Every field the source publishes is kept, including the ones nothing renders. Provenance is
-- the point: an affiliation with no program, no interest type and no source file is
-- indistinguishable from an assertion we made up.
create table if not exists public.frs_org_affiliations (
  id                bigserial primary key,
  registry_id       text not null,          -- THE ANCHOR. Never an address, never a name.
  pgm_sys_acrnm     text not null,          -- which EPA program reported it (RCRAINFO, NPDES…)
  pgm_sys_id        text not null,          -- that program's own id for the facility
  interest_type     text not null,
  affiliation_type  text not null,          -- the source's own word; mapped, never rewritten
  org_name          text not null,          -- verbatim, suffixes intact
  org_type          text,
  duns_number       text, ein text, state_business_id text,
  start_date        text, end_date text,    -- kept as the source's DD-MON-YY strings
  city_name         text, state_code text,
  source_file       text not null,
  source_version    text not null,
  retrieved_at      timestamptz not null default now()
);

-- ⚠️ THE UNIQUE KEY MUST INCLUDE interest_type AND duns_number.
-- The first attempt keyed on (registry_id, affiliation_type, org_name, program) and SILENTLY
-- COLLAPSED 6 of 41 rows — the same company reported by the same program under two different
-- interest types is TWO facts about the facility, not a duplicate. Provenance loss is
-- invisible: the surviving row looks complete.
create unique index if not exists frs_org_affil_uniq on public.frs_org_affiliations
  (registry_id, affiliation_type, org_name, pgm_sys_acrnm, pgm_sys_id,
   interest_type, coalesce(duns_number, ''));


-- ── 3. The affiliation-type classification — ALL 39 VALUES, none defaulted ───────────────────
-- Conservative by construction: a value earns an identity role only when the word itself
-- states one. Everything else is retained as evidence or dropped, and NOTHING falls through to
-- a default. (39 rows in public.frs_affiliation_role_map, verified 2026-08-10.)
--
--   current_identity     (3)  OWNER -> Facility Owner · OPERATOR -> Operator ·
--                             OWNER/OPERATOR -> Facility Owner AND Operator
--   historical_identity  (3)  FORMER OWNER · FORMER OPERATOR · FORMER OWNER/OPERATOR
--   evidence_detail     (20)  PARENT COMPANY / PARENT OWNER / PARENT COMPANY 1 / 2 /
--                             JOINT PARENT COMPANY / PART PARENT OWNER -> parent CANDIDATES;
--                             AGENT, ATTORNEY, CONSULTANT, CONTRACTOR, LESSEE, PERMITTEE,
--                             PERMITEE (the agency's own misspelling, kept verbatim),
--                             CO-PERMITTEE, ORGANIZATION, PART OWNER, RESPONSIBLE PARTY,
--                             RESPONSIBLE ENTITY, POTENTIALLY RESPONSIBLE PARTY,
--                             TRANSMISSION OR DISTRIBUTION SYSTEM OWNER
--   not_relevant        (13)  every contact / mailing-address variant
--
-- Three of those classifications are load-bearing and should not be "simplified":
--   • OWNER -> "Facility Owner", NEVER "Property Owner". FRS OWNER is an affiliation to a
--     REGULATED FACILITY, not a deed to the parcel.
--   • CONTRACTOR is not an operator. This is the same error the TCEQ construction-stormwater
--     rows would have caused (5 "operators" for one power plant, three of them builders).
--   • POTENTIALLY RESPONSIBLE PARTY is a CERCLA term of art. Rendering it as an identity role
--     would be an accusation, not a fact.
create table if not exists public.frs_affiliation_role_map (
  affiliation_type text primary key,
  class            text not null check (class in
                     ('current_identity','historical_identity','evidence_detail','not_relevant')),
  hs_role          text,
  hs_role_2        text,        -- OWNER/OPERATOR expands to both, from ONE source row
  parent_candidate boolean not null default false,
  note             text
);


-- ── 4. The person guard — an organization file still contains people ─────────────────────────
-- TX_ORGANIZATION_FILE.CSV carries named individuals in org_name. Two are in the pilot's 40
-- rows: "JUDY TORRES ROMAN" (an OWNER/OPERATOR row) and "PERWEZ MOHEET, ACTING DIRECTOR".
-- Publishing a private individual as the owner of a facility on a public page is the failure
-- this prevents. Requires a corporate / government / trade token to pass; fails CLOSED.
create or replace function public.frs_looks_like_organization(_name text)
returns boolean language sql immutable as $$
  select coalesce(_name, '') ~* ('\m(' ||
    'llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|l\.p|llp|plc|' ||
    'trust|partners|holdings|group|enterprises|industries|systems|services|service|' ||
    'city|county|state|district|authority|department|dept|board|commission|agency|' ||
    'university|school|isd|municipal|utilities|energy|water|waste|oil|gas|construction|' ||
    'materials|manufacturing|properties|realty|development|ranch|farms|associates|' ||
    'cleaners|market|store|shop|plant|works|mill|dba|and|&' || ')\M');
$$;
-- Probed live: excludes exactly those 2 names, passes all 19 organizations. It is a NAME
-- heuristic and is therefore fail-closed by design — an organization whose name carries no
-- recognisable token is dropped rather than risked.


-- ── 5. The reader view + the arbitration ─────────────────────────────────────────────────────
-- v_frs_identity_roles       expands OWNER/OPERATOR into both roles from one row, applies the
--                            person guard, and de-dupes on (registry_id, role, org_name, class).
-- detect_frs_identity_conflicts(_zip)
--                            compares each FRS row against the resolved identity for the SAME
--                            (project, role) by evidence_tier_rank and stamps a reason:
--                              NULL       -> displayable
--                              'agrees'   -> a stronger source names the SAME company. Shown
--                                            ONCE (not twice) and cited as corroboration.
--                              'conflict' -> a stronger source names a DIFFERENT company. Kept
--                                            in public.identity_conflicts for review; NOT put
--                                            in front of the reader as an open contradiction.
-- app_project_frs_identity(_project_id)
--                            -> {current, history, parent_candidates}
-- v_app_project_identity     gained an `frs` column BESIDE the untouched `identity` column.
--                            The two never merge in the database; the render layer decides.
--
-- public.identity_conflicts has RLS ON and NO public select policy — it is internal review
-- state, not page data.


-- ── 6. CONTAINMENT — proven, not asserted ────────────────────────────────────────────────────
-- The one thing a complementary source must not do is leak into the machinery that assumes
-- identifier-grade linkage. Measured 2026-08-10 by grepping pg_get_functiondef:
--
--   app_project_track_record   reads FRS: NO      <- the three track-record levels are untouched
--   app_site_parties           reads FRS: NO
--   app_attach_parents         reads FRS: NO      <- no parent inheritance path exists
--   app_refresh_zip            reads FRS: NO      <- nothing FRS reaches the materialised pages
--   app_project_frs_identity   reads FRS: YES     <- the only reader
--   detect_frs_identity_conflicts reads the view  <- arbitration only
--
-- So an FRS-NAMED company cannot pull facilities or enforcement events into a track record.
-- That is deliberate: company_facilities / company_track_events follow CN -> RN -> NOV/NOE, an
-- unbroken chain of agency identifiers, and an FRS name match is not one.


-- ── 7. PILOT MEASUREMENT (all figures run 2026-08-10; queries in the session log) ────────────
--   Pilot FRS facilities in 78617 ............................. 29
--     with at least one FRS organization row .................. 11
--     with none .............................................. 18
--   Rows loaded ............................................... 41  (40 pilot + 1 control)
--     distinct registry ids ................................... 12
--     distinct organization names ............................. 20
--     with a DUNS ............................................. 7
--     with a non-zero EIN ..................................... 8
--   Affiliation types present ..... OPERATOR 14 · OWNER 10 · OWNER/OPERATOR 8 ·
--                                   MAILING ADDRESS 5 · PARENT OWNER 3 · BILLING CONTACT 1
--   Dropped as not_relevant ................................... 6
--   Dropped by the person guard ............................... 2
--   FORMER-role rows in the pilot ............................. 0   (history path is untested
--                                   by live data and is covered by a synthetic fixture instead)
--   Displayed role entries .................................... 18  (Facility Owner 11 · Operator 7)
--   Suppressed as 'agrees' .................................... 2
--   Suppressed as 'conflict' .................................. 4
--   Parent CANDIDATES ......................................... 3   (all on registry 110071161706)
--   Parents made VERIFIED by FRS .............................. 0   (the only verified parent in
--                                   the database is still Martin Marietta, from SEC EX-21.01)
--   Rows written to property_company_roles by FRS ............. 0
--   Facilities where FRS filled a gap (no prior resolved role) . 6
--   Facilities where FRS sits alongside a stronger source ...... 3
--
-- POSITIVE CONTROL — registry 110005052085, BFI WASTE SYSTEMS OF TEXAS LP:
--   before, identity = [] and the card read "not yet available".
--   after,  Facility Owner BROWNING-FERRIS INDUSTRIES INC (Reported)
--           Operator      BFI WASTE SYSTEMS OF TEXAS LP  (Reported)
--   Republic Services acquired Browning-Ferris in reality; FRS does not say so, so HomeSignal
--   does not say so. BFI's parent stays unresolved.
--
-- NEGATIVE CONTROL — registry 110070182593, TXI - GARFIELD SAND & GRAVEL:
--   0 FRS organization rows. The TCEQ operator (Martin Marietta Materials Southwest, LLC,
--   Verified, with its SEC-verified parent) is unchanged, and no FRS wording appears anywhere
--   on the card. An FRS zero is an ordinary outcome, not a degraded one.
--
-- SAME-ADDRESS CONTROL — registry 110034344494 (CEMEX INC.) shares Garfield's street address
--   and DOES have an FRS row. It is a different registry id, so it joins to nothing on the
--   Garfield card. 110071427904 (MM - GARFIELD S&G), also same-address, has 0 FRS rows.


-- ── 8. KNOWN LIMITATIONS — recorded, not fixed ───────────────────────────────────────────────
-- (a) NAME VARIANTS READ AS SEPARATE COMPANIES. Registry 110008975804 publishes four OWNER
--     rows: AUSTIN ENERGY · CITY OF AUSTIN · CITY OF AUSTIN DBA AUSTIN ENERGY ·
--     "CITY OF AUSTIN, AUSTIN ENERGY". All four display, because the brief forbids
--     over-normalization (LLC vs LTD must stay distinct) and there is no principled line
--     between "a DBA of the same body" and "a different company" that a string comparison can
--     draw. Honest, but four owner rows where a person would say "one". Resolving it needs an
--     identifier, not a fuzzier match.
-- (b) THE CONFLICT REGISTER MIXES TWO THINGS. Of the 4 open conflicts, 2 are genuine
--     disagreements (T. MORALES COMPANY, L.L.C. and TIC - THE INDUSTRIAL COMPANY — both
--     contractors) and 2 are name variants of the winning company. Both are suppressed
--     identically, which is the safe direction, but the register is not a clean queue.
-- (c) END DATES ARE ESSENTIALLY ABSENT. 3 of 40 pilot rows carry one, and all three are the
--     parent candidates. Every date phrase therefore reads "recorded from <date>" — never
--     "since", never "present". A blank END_DATE carries no information at all.
-- (d) 18 of 29 pilot facilities gain nothing. FRS coverage is real but partial; this is the
--     expected shape, not a load failure.
