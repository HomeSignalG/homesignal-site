-- Stand-ins for the production columns docs/development-official-records.sql reads beyond the
-- dossier fixture (measured 2026-10-30): water_rights_filings.applicant,
-- resolved_projects.governing_bodies, resolved_project_parcels.
alter table public.water_rights_filings add column if not exists applicant text;
update public.water_rights_filings set applicant = 'BAR H RANCH INC.', filing_type = 'Application To Appropriate',
  record_url = 'https://www.waterrights.utah.gov/search/?q=a55167' where filing_no = 'a55167';
insert into public.water_rights_filings (source, point_key, filing_no, filing_type, status, filed_on, date_label, record_url, applicant) values
  ('ut_dwr_pending', 'a60001|1', 'a60001', 'Permanent change application', 'Unapproved', current_date - 3, 'Priority date',
   'https://www.waterrights.utah.gov/search/?q=a60001', 'Bar H Ranch, Inc.'),          -- same entity, new filing
  ('ut_dwr_pending', 'a60002|1', 'a60002', 'Application To Appropriate', 'Unapproved', current_date - 3, 'Priority date',
   'https://www.waterrights.utah.gov/search/?q=a60002', 'JOHN Q DOE'),                  -- a person: never proposed
  ('ut_dwr_pending', 'a60003|1', 'a60003', 'Application To Appropriate', 'Unapproved', current_date - 3, 'Priority date',
   'https://www.waterrights.utah.gov/search/?q=a60003', 'Unrelated Farms LLC'),         -- not linked: never proposed
  ('ut_dwr_pending', 'a40000|1', 'a40000', 'Permanent change application', 'Unapproved', current_date - 1000, 'Priority date',
   'https://www.waterrights.utah.gov/search/?q=a40000', 'Bar H Ranch Inc');            -- older than two years

alter table public.resolved_projects add column if not exists governing_bodies jsonb;
update public.resolved_projects set governing_bodies = '[{"body_name": "Military Installation Development Authority (MIDA)",
  "confidence": "verified", "source_url": "https://www.utah.gov/pmn/sitemap/publicbody/1077.html",
  "source_system": "Utah PMN - MIDA Board", "jurisdiction_basis": "Resolution 2026-06"},
 {"body_name": "Box Elder County Commission", "confidence": "unverified", "source_url": "https://example.gov/x"}]'
 where project_key = 'stratos-box-elder';

drop table if exists public.resolved_project_parcels;
create table public.resolved_project_parcels (id bigserial primary key, project_id uuid, apn text, owner_of_record text,
  acres numeric, in_anchor boolean, erecord_url text);
insert into public.resolved_project_parcels (project_id, apn, owner_of_record, acres, in_anchor, erecord_url)
select rp.id, v.apn, v.owner, v.acres, v.anchor, v.url
  from public.resolved_projects rp, (values
    ('05-006-0005', 'BAR H RANCH INC', 500.4, true, 'https://erecord.example.gov/R1'),
    ('05-006-0006', 'BAR H RANCH INC', 499.6, true, 'https://erecord.example.gov/R2'),
    ('06-006-0002', 'MURRAY HOLLOW LC', 640, true, 'https://erecord.example.gov/R3'),
    ('06-005-0012', 'BULL PASS RANCH LLC', 320, true, 'https://erecord.example.gov/R4'),
    ('07-005-0074', 'HANSEL VALLEY LODGE LLC', 1, false, 'https://erecord.example.gov/R5'),   -- not anchor
    ('07-005-0080', 'JANE ROE FAMILY TRUST', 40, true, 'https://erecord.example.gov/R6')       -- a person's trust
  ) v(apn, owner, acres, anchor, url)
 where rp.project_key = 'stratos-box-elder';
