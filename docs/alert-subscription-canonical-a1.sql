-- ===========================================================================
-- HomeSignal — CANONICAL EMAIL-SUBSCRIPTION MODEL, migration A1 (ADDITIVE ONLY)
-- Founder-approved 2026-09-21. Read the design in this file's companion PR body.
--
-- A1 adds structure ONLY. No backfill, no constraints, no behaviour change:
-- every column it adds is nullable or defaulted, so every existing RPC and
-- reader keeps working byte-identically after it applies. Reversible by
-- dropping exactly what it creates.
--
-- The catalog vocabulary is GENERATED from the shipped runtime
-- (digest.py::CANONICAL_TOPICS + SUBTOPIC_VOCAB + topics.gov_compat), never
-- transcribed -- ingest CLAUDE.md rule 7. That generation is what pulls in the
-- legacy alias 'Water companies', which _topic_list still accepts and which a
-- hand-typed list would have dropped, turning a live preference into an FK
-- violation at A3.
-- ===========================================================================

-- 1) TOPIC CATALOG ---------------------------------------------------------
-- The referential target that makes an invalid topic string fail at WRITE time
-- instead of silently matching nothing at delivery time.
create table if not exists public.alert_topic_catalog (
  stream     text not null,
  topic      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint alert_topic_catalog_pkey primary key (stream, topic),
  constraint alert_topic_catalog_stream_ck
    check (stream in ('notices','meetings','news','global','emerging'))
);

alter table public.alert_topic_catalog enable row level security;
drop policy if exists alert_topic_catalog_read on public.alert_topic_catalog;
create policy alert_topic_catalog_read on public.alert_topic_catalog
  for select to anon, authenticated using (true);   -- a vocabulary, no PII
grant select on public.alert_topic_catalog to anon, authenticated;

insert into public.alert_topic_catalog (stream, topic) values
  ('notices','City government (Brigham City)'),
  ('notices','City government (Tremonton)'),
  ('notices','County Commission & county business'),
  ('notices','Eagle Mountain data center project'),
  ('notices','Elections & voting'),
  ('notices','Planning, zoning & development'),
  ('notices','Property taxes & assessments'),
  ('notices','Public safety & emergencies'),
  ('notices','Stratos data center project'),
  ('notices','Water companies'),
  ('notices','Water districts & utilities'),
  ('meetings','City government (Brigham City)'),
  ('meetings','City government (Tremonton)'),
  ('meetings','County Commission & county business'),
  ('meetings','Eagle Mountain data center project'),
  ('meetings','Elections & voting'),
  ('meetings','Planning, zoning & development'),
  ('meetings','Property taxes & assessments'),
  ('meetings','Public safety & emergencies'),
  ('meetings','Stratos data center project'),
  ('meetings','Water companies'),
  ('meetings','Water districts & utilities'),
  ('news','Air Quality'),
  ('news','Animal & Human Viruses / Diseases'),
  ('news','Data Centers'),
  ('news','EMF'),
  ('news','Infrastructure'),
  ('news','Light Pollution'),
  ('news','Livestock, Crops, Pets & Wildlife Health'),
  ('news','Noise Pollution'),
  ('news','Radiation'),
  ('news','Soil Quality'),
  ('news','Water Quality'),
  ('news','Weather & Climate Hazards'),
  ('global','Air Quality'),
  ('global','Animal & Human Viruses / Diseases'),
  ('global','Data Centers'),
  ('global','EMF'),
  ('global','Infrastructure'),
  ('global','Light Pollution'),
  ('global','Livestock, Crops, Pets & Wildlife Health'),
  ('global','Noise Pollution'),
  ('global','Radiation'),
  ('global','Soil Quality'),
  ('global','Water Quality'),
  ('global','Weather & Climate Hazards'),
  ('emerging','Air Quality'),
  ('emerging','Animal & Human Viruses / Diseases'),
  ('emerging','Data Centers'),
  ('emerging','EMF'),
  ('emerging','Infrastructure'),
  ('emerging','Light Pollution'),
  ('emerging','Livestock, Crops, Pets & Wildlife Health'),
  ('emerging','Noise Pollution'),
  ('emerging','Radiation'),
  ('emerging','Soil Quality'),
  ('emerging','Water Quality'),
  ('emerging','Weather & Climate Hazards')
on conflict (stream, topic) do nothing;

-- 2) CONSENT: alert email consent is a SEPARATE concept from marketing -------
-- marketing_consent keeps its data and its meaning; it simply stops gating
-- delivery. Nothing is copied here -- that is A2, under the evidence rule.
alter table public.users
  add column if not exists alert_email_consent      boolean not null default false,
  add column if not exists alert_email_consent_at   timestamptz,
  add column if not exists alert_email_consent_copy text;

-- 3) Composite-FK target so a subscription can never point at a (user, place)
--    pair that does not exist on the users row itself.
create unique index if not exists ux_users_id_community
  on public.users (id, community_id);

-- 4) STREAM + ORIGIN -------------------------------------------------------
-- stream is the fix for the lossy key: notices and meetings both map to
-- pipeline_type 'government_notice', so the old unique key could not represent
-- them independently. origin separates a pre-staged follow floor from an
-- explicit email selection, so a follow can never read as enrollment.
alter table public.user_subscriptions
  add column if not exists stream text,
  add column if not exists origin text;

-- 5) VERIFY ----------------------------------------------------------------
do $$
declare n_cat int; n_gov int; n_sub int;
begin
  select count(*) into n_cat from public.alert_topic_catalog;
  select count(*) into n_gov from public.alert_topic_catalog where stream in ('notices','meetings');
  select count(*) into n_sub from public.alert_topic_catalog where stream in ('news','global','emerging');
  if n_cat <> 58 then raise exception 'catalog seed wrong: % rows, expected 58', n_cat; end if;
  if n_gov <> 22 then raise exception 'government catalog wrong: %', n_gov; end if;
  if n_sub <> 36 then raise exception 'subtopic catalog wrong: %', n_sub; end if;
  raise notice 'A1 ok: catalog=% (gov=%, sub=%)', n_cat, n_gov, n_sub;
end $$;
