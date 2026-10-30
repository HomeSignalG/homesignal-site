-- Stand-ins for the production objects docs/development-dossier.sql reads (columns as measured
-- 2026-10-29), plus Supabase's roles and auth.uid() (here: the GUC test.uid).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

drop table if exists public.resolved_projects, public.v_resolved_project_zip, public.app_projects,
  public.dc_canonical_entity, public.water_rights_filings, public.youtube_channel_videos,
  public.video_bluesky_jobs, public.bsky_post_metrics cascade;
create table public.resolved_projects (id uuid primary key default gen_random_uuid(), project_key text unique not null,
  display_name text, display_name_basis text);
create table public.v_resolved_project_zip (project_key text, zip text, parcels_in_this_zip bigint, is_primary_zip boolean);
create table public.app_projects (id uuid primary key default gen_random_uuid(), zip text, name text, type text, type_raw text,
  status text, submitted_at date, date_kind text, source_ref text, source_key text, source_seq smallint, record_kind text);
create table public.dc_canonical_entity (canonical_entity_id uuid primary key, classification text, superseded_by uuid);
create table public.water_rights_filings (source text, point_key text, filing_no text, filing_type text, status text,
  filed_on date, date_label text, record_url text, removed_from_source_at timestamptz);
create table public.youtube_channel_videos (video_id text primary key, url text, title text, privacy_status text,
  published_at timestamptz, duration_s int, public_verified_at timestamptz);
create table public.video_bluesky_jobs (id uuid primary key default gen_random_uuid(), status text, post_text text,
  bsky_uri text, published_at timestamptz);
create table public.bsky_post_metrics (id bigserial, bsky_uri text, label text, posted_at timestamptz, captured_at timestamptz default now());

insert into public.resolved_projects (project_key, display_name, display_name_basis) values
  ('stratos-box-elder', 'Stratos data center project', 'record'), ('eagle-mountain', 'Eagle Mountain land assembly', 'descriptive');
insert into public.v_resolved_project_zip values ('stratos-box-elder', '84336', 78, true), ('stratos-box-elder', '84307', 4, false);
insert into public.app_projects (zip, name, type, type_raw, status, submitted_at, date_kind, source_ref, source_key, source_seq, record_kind) values
  ('98407', 'Proctor 4 - Mixed-Use Development', 'Development', 'Project', 'Proposed', '2026-08-27', 'filed',
   'https://apps.ecology.wa.gov/separ/Main/SEPA/Record.aspx?SEPANumber=202603632', 'wa-ecology-sepa:202603632', 1, 'development'),
  ('98406', 'Proctor 4 - Mixed-Use Development', 'Development', 'Project', 'Proposed', '2026-08-27', 'filed',
   'https://apps.ecology.wa.gov/separ/Main/SEPA/Record.aspx?SEPANumber=202603632', 'wa-ecology-sepa:202603632', 1, 'development');
insert into public.dc_canonical_entity values ('fe2068de-0000-4000-8000-000000000001', 'CONFIRMED_DC', null),
  ('fe2068de-0000-4000-8000-000000000002', 'CONFIRMED_DC', 'fe2068de-0000-4000-8000-000000000001');
insert into public.water_rights_filings values
  ('ut_dwr_pending', 'a55167|1', 'a55167', 'Permanent change application', 'Unapproved', '2026-10-15', 'Priority date',
   'https://www.waterrights.utah.gov/search/?q=a55167', null),
  ('ut_dwr_pending', 'a55167|2', 'a55167', 'Permanent change application', 'Unapproved', '2026-10-15', 'Priority date',
   'https://www.waterrights.utah.gov/search/?q=a55167', null);
insert into public.youtube_channel_videos values
  ('q-phnTGrMRQ', 'https://www.youtube.com/watch?v=q-phnTGrMRQ', 'Stratos water filing', 'public', '2026-10-28', 295, '2026-10-28'),
  ('shortAAAAAA', 'https://www.youtube.com/shorts/shortAAAAAA', 'Stratos short', 'public', '2026-10-28', 40, '2026-10-28'),
  ('privateAAAA', 'https://www.youtube.com/watch?v=privateAAAA', 'Not public', 'private', null, 300, null);
insert into public.video_bluesky_jobs (status, post_text, bsky_uri, published_at) values
  ('published', 'A Stratos post', 'at://did:plc:x/app.bsky.feed.post/aaa', '2026-10-29'),
  ('scheduled', 'Not yet', 'at://did:plc:x/app.bsky.feed.post/bbb', null);
