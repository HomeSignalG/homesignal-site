-- ═══════════════════════════════════════════════════════════════════════════════════════
-- COMPANY IDENTITY RESOLUTION — Del Valle / ZIP 78617 pilot.  DDL + seed of record.
-- Applied 2026-08-09 as migrations:
--   company_identity_layer_pilot
--   company_identity_pilot_78617_seed
--   company_identity_pilot_78617_unambiguous_operators
--   v_app_project_identity_read_view
-- Parked here so the shape is reproducible; the live database is the runtime truth.
--
-- WHAT THIS LAYER IS FOR
--   Answer "who owns / builds / applies for / operates this" for a named real place, from
--   sources that STATE the answer. A facility's NAME is never such a source: TCEQ records
--   the responsible party for "TXI - GARFIELD SAND & GRAVEL" as Martin Marietta Materials
--   Southwest, LLC, so reading the operator off the sign would have got it wrong.
--
-- THE EVIDENCE BAR IS STRUCTURAL, NOT CONVENTIONAL
--   • property_company_roles.verification ∈ VERIFIED | HIGH_CONFIDENCE | UNRESOLVED, and
--     CHECK pcr_verified_needs_evidence / pcr_high_conf_needs_source make a claim without a
--     citation unstorable.
--   • company_parents cannot hold a parent NAME unless verification='verified' WITH source,
--     url, evidence_date and retrieved_at. A candidate lives in `notes`, which no renderer
--     and no join reads. Shared founders, executives, investors, similar names and news
--     co-occurrence have no column that accepts them.
--   • app_company_key() folds case and punctuation ONLY. Corporate suffixes are significant,
--     so "Neuralink" and "Neuralink Corporation" stay distinct companies — merging them
--     would infer a relationship from name similarity.
--
-- MEASURED COVERAGE, ZIP 78617, 2026-08-09
--   537 records (508 development + 29 facility) · 13 records carry a resolved role
--   13 role rows: 5 Property Owner · 5 Operator (validation set) · 3 Operator (second pass)
--   0 Developer · 0 Applicant — no wired source for 78617 states either role
--   1 verified parent · 6 unresolved-with-reason · 9 unique companies holding a role
--
-- WHY THE BULK OPERATOR IMPORT WAS REFUSED
--   13 of the 29 facilities name-match a TCEQ regulated entity in this ZIP, but TCEQ leaves
--   SUPERSEDED affiliations open-ended (affil_end_dt = 3000-12-31). A naive read returns 5
--   "operators" for SAND HILL ENERGY CENTER: City of Austin dba Austin Energy alongside
--   Austin Commercial, LP; Laughlin-Thyssen, Ltd.; and TIC - The Industrial Company — all
--   construction contractors. Only affiliations that are unambiguous (exactly one open
--   affiliation outside the construction-stormwater program) were admitted.
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- ── companies: one row per legal entity string we have seen stated by a source ──────────
create table if not exists public.companies (
  company_key      text primary key,               -- app_company_key(canonical_name)
  canonical_name   text not null,
  legal_name       text,
  entity_type      text,
  jurisdiction     text,
  identity_source  text,                           -- the source that STATES this identity
  identity_url     text,
  identity_date    date,
  retrieved_at     timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── aliases: only ever written when a SOURCE states the equivalence ─────────────────────
create table if not exists public.company_aliases (
  alias_key       text primary key,
  alias_name      text not null,
  company_key     text not null references public.companies(company_key),
  evidence_source text not null,                   -- NOT NULL: an alias needs a reason
  evidence_url    text,
  retrieved_at    timestamptz not null default now(),
  notes           text
);

-- ── per-record roles ────────────────────────────────────────────────────────────────────
create table if not exists public.property_company_roles (
  id              bigserial primary key,
  project_id      uuid references public.app_projects(id) on delete cascade,
  zip             text not null,
  role            text not null check (role in ('Property Owner','Developer','Applicant','Operator')),
  company_key     text not null references public.companies(company_key),
  verification    text not null check (verification in ('VERIFIED','HIGH_CONFIDENCE','UNRESOLVED')),
  evidence_source text,
  evidence_url    text,
  evidence_date   date,
  retrieved_at    timestamptz,
  parcel_id       text,
  notes           text,
  created_at      timestamptz not null default now(),
  constraint pcr_verified_needs_evidence check (
    verification <> 'VERIFIED' or (evidence_source is not null and evidence_url is not null)),
  constraint pcr_high_conf_needs_source check (
    verification <> 'HIGH_CONFIDENCE' or evidence_source is not null)
);

-- ── read path: one row per project that HAS a resolved role ─────────────────────────────
create or replace view public.v_app_project_identity
with (security_invoker = true) as
select r.project_id, r.zip, public.app_project_identity(r.project_id) as identity
from public.property_company_roles r
where r.project_id is not null
group by r.project_id, r.zip;

grant select on public.v_app_project_identity to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- THE TWO NAMED HOLDS, SETTLED WITH RECEIPTS (do not "fix" either from general knowledge)
--
-- TXI → Martin Marietta.  The facility's operator per TCEQ is Martin Marietta Materials
--   Southwest, LLC, and THAT entity's parent IS verified: SEC Exhibit 21.01 to the Martin
--   Marietta Materials, Inc. FY2025 Form 10-K (filed 2026-02-19, accession
--   0001193125-26-059193) reads "Martin Marietta Materials Southwest, LLC, a Delaware
--   limited liability company — 100%".
--   But TXI Operations, LP — the OTHER affiliation TCEQ still lists as open — is NOT in
--   that exhibit: 0 occurrences of "Texas Industries", no "TXI Operations" entry, while
--   "Martin Marietta Materials Southwest" occurs 4 times in the same document (positive
--   control). It stays unresolved.
--   ⚠ An earlier probe reported "0 hits" for "Texas Industries" in Martin Marietta's
--   filings. That was a WRONG QUERY SHAPE — EDGAR full-text `forms=` filters ROOT form
--   types, and EX-21 is a file type, not a root form. Re-run without it: 198 hits, incl.
--   EX-21.01 exhibits for FY2015 and FY2016. A 2016 subsidiary listing does not establish
--   a present-day parent, which is why the conclusion is unchanged and the reason is not.
--
-- BFI → Republic Services.  "BFI Waste Systems of Texas" appears in EDGAR only in filings
--   by Allied Waste Industries, Inc. (CIK 0000848865) — an Exhibit 21 dated 2001-12-31 and
--   a 2010 Form S-4 on which Republic Services, Inc. (CIK 0001060391) is a co-registrant.
--   Restricted to 2020-01-01..2026-08-09 the same search returns 0 hits across all of
--   EDGAR, while unrestricted it returns 158 — so the zero is a real absence, not a filter
--   artifact. A 2010 filing does not establish a present-day parent.
--   It is moot for the card regardless: the question never arises, because the FACILITY's
--   operator is unresolved. EPA FRS publishes no owner or operator column (verified: the
--   frs_facility_site row for registry 110005052085 has none, and parent_registry_id is
--   null), and TCEQ lists no Travis County regulated entity of that name.
--
-- River Bottoms Ranch LLC.  Its TDLR owner address (7400 PASEO PADRE PKWY, FREMONT, CA
--   94555) is the same street address as the SEC registrant record for Neuralink Corp.
--   (CIK 0001708503). A shared address is co-location, not ownership. EDGAR full-text for
--   "River Bottoms Ranch" returns 0 hits. Unresolved, with the lead recorded in notes.
-- ═══════════════════════════════════════════════════════════════════════════════════════
