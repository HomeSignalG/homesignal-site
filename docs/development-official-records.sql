-- ============================================================================================
-- Development dossiers: OFFICIAL RECORDS and the ENTITIES they name, and the daily job that
-- turns them into CANDIDATE links (founder, 2026-10-30: "you do not miss things like change
-- and amendments"; "the code needs to account for integrating new entities that pop up").
-- Applies AFTER docs/development-dossier.sql (and docs/state-water-rights.sql for the
-- water_rights_filings table it reads).
--
-- What this adds, and what it does not:
--   1. public.official_record / _observation / _party: the official records a development's
--      links point at (today: Utah Division of Water Rights change records and each water
--      right's scanned-document folder), every version we read of them (append-only), and every
--      ORGANIZATION each record names, with the role the record gives it and the record's own
--      words. Owner addresses are never stored. A party that is not an organization is never
--      stored either: the ingest drops it, and the write function refuses one.
--   2. public.official_records_ingest(payload): the ONE write path (service_role only). The
--      fetcher in homesignal-ingest (scripts/ingest_official_records.py) calls it.
--   3. public.official_records_watch_list(): which records to read: every water filing any
--      development links (approved or candidate).
--   4. public.development_propose_from_records(job): proposes CANDIDATE links, never approves:
--        * each organization a linked change record names (owner -> applicant, buyer under
--          contract, developer -> master_developer);
--        * each document in a linked water right's folder that is an application, amendment,
--          decision, segregation or other action (never a protest, letter of concern or correspondence,
--          which name private people), dated from a year before the linked filing onward,
--          or new since the folder was first read;
--        * each organization owning an anchor parcel of a linked land assembly;
--        * each governing body the land assembly's research names;
--        * each NEW water filing whose applicant is an organization the project already links.
--      Anything already linked in ANY state (candidate, approved, rejected, revoked) for the
--      same entity and role, or the same object, is skipped: a rejected entity is not proposed
--      again. Nothing publishes until a reviewer approves it on Dashboard tab 18.
--
-- GRANTS: the tables are closed to anon and authenticated; the functions run for service_role.
-- ROLLBACK (nothing else depends on these):
--   drop function public.development_propose_from_records(text), public.official_records_watch_list(),
--     public.official_records_ingest(jsonb), public.development_entity_keys(text),
--     public.development_entity_is_organization(text);
--   drop table public.official_record_party, public.official_record_observation, public.official_record;
-- ============================================================================================

begin;

-- ── what an entity name is ──────────────────────────────────────────────────────────────────
-- Organization: the name carries a legal form or names a public body. A bare personal name, a
-- family trust or "John Smith Ranch" is not one, so it is never stored or proposed.
create or replace function public.development_entity_is_organization(p_name text)
returns boolean language sql immutable set search_path to 'public','pg_temp' as $fn$
  select coalesce(
    upper(' ' || regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9&]+', ' ', 'g') || ' ')
      ~ ' (L ?L ?C|L ?C|L ?L ?P|L ?P|P ?L ?L ?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|N ?A'
        '|CITY|COUNTY|TOWN|TOWNSHIP|STATE|DISTRICT|DEPARTMENT|DIVISION|AUTHORITY|AGENCY|COMMISSION|BOARD|BUREAU'
        '|UNIVERSITY|ASSOCIATION|ASSOCIATES|PARTNERS|PARTNERSHIP|HOLDINGS|GROUP|CORPS|IRRIGATION|CANAL|CONSERVANCY) '
    and upper(coalesce(p_name, '')) !~ '\m(FAMILY|LIVING|REVOCABLE|IRREVOCABLE) TRUST\M', false)
$fn$;

-- The keys a name matches on: its normalized form, the same without a parenthesized part, and
-- the parenthesized part itself (so "Military Installation Development Authority (MIDA)" and
-- "MIDA" are one entity). Legal forms are spelled one way ("Inc." = "INC" = "Incorporated").
create or replace function public.development_entity_keys(p_name text)
returns text[] language sql immutable set search_path to 'public','pg_temp' as $fn$
  with n as (
    select upper(coalesce(p_name, '')) s
  ), parts as (
    select s,
           btrim(regexp_replace(s, '\([^)]*\)', ' ', 'g')) outside,
           (regexp_match(s, '\(([^)]*)\)'))[1] inside
      from n
  ), norm as (
    select v from parts, lateral unnest(array[s, outside, inside]) v where v is not null
  ), cleaned as (
    select btrim(regexp_replace(
             regexp_replace(
               regexp_replace(regexp_replace(v, '[`''’]', '', 'g'), '&', ' AND ', 'g'),
               '[^A-Z0-9]+', ' ', 'g'),
             '\m(INCORPORATED)\M', 'INC', 'g')) k
      from norm
  )
  select coalesce(array_agg(distinct
           btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(k,
             '\mL L C\M', 'LLC', 'g'), '\mL C\M', 'LC', 'g'), '\mCORPORATION\M', 'CORP', 'g'),
             '\mCOMPANY\M', 'CO', 'g'), '\s+', ' ', 'g')))
           filter (where length(k) > 1), '{}')
    from cleaned
$fn$;

-- ── the records ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.official_record (
  record_key      text primary key check (record_key ~ '^[a-z]{2}_[a-z_]+:\S+$'),
  source          text not null check (source ~ '^[a-z]{2}_[a-z_]+$'),
  kind            text not null check (kind in ('change_record', 'document_folder', 'document')),
  subject_ref     text,          -- the water filing it belongs to, e.g. ut_dwr:a55167
  parent_key      text references public.official_record(record_key),
  title           text not null check (btrim(title) <> ''),
  doc_type        text,          -- the state's own document description ("Change Application", …)
  filed_on        date,
  url             text not null check (url ~ '^https://[^\s]+$'),
  facts           jsonb not null default '{}'::jsonb,
  content_sha256  text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  removed_from_source_at timestamptz
);
create index if not exists official_record_subject_idx on public.official_record (subject_ref);
create index if not exists official_record_parent_idx on public.official_record (parent_key);

-- every reading that differs from the one before it (a status change, an amendment, a new owner)
create table if not exists public.official_record_observation (
  id              bigint generated always as identity primary key,
  record_key      text not null references public.official_record(record_key),
  observed_at     timestamptz not null default now(),
  content_sha256  text,
  title           text,
  facts           jsonb not null default '{}'::jsonb
);
create index if not exists official_record_observation_key_idx on public.official_record_observation (record_key, observed_at);

create table if not exists public.official_record_party (
  record_key      text not null references public.official_record(record_key),
  party_key       text not null,
  party_name      text not null check (btrim(party_name) <> ''),
  role            text not null check (role in ('owner', 'applicant', 'buyer_under_contract', 'developer',
                                                'agent', 'consultant')),
  quote           text not null check (btrim(quote) <> ''),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  removed_at      timestamptz,
  primary key (record_key, party_key, role),
  check (public.development_entity_is_organization(party_name))
);

alter table public.official_record             enable row level security;
alter table public.official_record_observation enable row level security;
alter table public.official_record_party       enable row level security;
revoke all on public.official_record, public.official_record_observation, public.official_record_party
  from public, anon, authenticated;

create or replace function public.official_record_observation_append_only() returns trigger
language plpgsql set search_path to 'public','pg_temp' as $fn$
begin
  raise exception 'official_record_observation is append-only' using errcode = '42501';
end $fn$;
drop trigger if exists official_record_observation_append_only_trg on public.official_record_observation;
create trigger official_record_observation_append_only_trg before update or delete on public.official_record_observation
  for each row execute function public.official_record_observation_append_only();

-- ── the one write path ──────────────────────────────────────────────────────────────────────
-- payload: {"source": "ut_dwr", "subject_ref": "ut_dwr:a55167", "complete": true,
--           "records": [{record_key, kind, parent_key, title, doc_type, filed_on, url, facts, content_sha256,
--                        parties: [{name, role, quote}]}]}
-- A record read again moves last_seen_at; a changed record (sha or facts) gets an observation.
-- When "complete" is true, documents of a folder in this payload that the folder no longer
-- lists, and parties a record no longer names, are marked removed (never deleted).
create or replace function public.official_records_ingest(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare r jsonb; pt jsonb; prev public.official_record; n_new int := 0; n_changed int := 0; n_seen int := 0;
        n_party_new int := 0; keys text[] := '{}'; k text; pk text; now_ts timestamptz := now();
        n_removed int := 0;
begin
  if jsonb_typeof(p_payload -> 'records') <> 'array' then
    raise exception 'payload.records must be an array' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(p_payload -> 'records') loop
    k := r ->> 'record_key';
    keys := keys || k;
    select * into prev from public.official_record where record_key = k;
    if not found then
      insert into public.official_record (record_key, source, kind, subject_ref, parent_key, title, doc_type, filed_on,
                                          url, facts, content_sha256, first_seen_at, last_seen_at)
      values (k, p_payload ->> 'source', r ->> 'kind', coalesce(r ->> 'subject_ref', p_payload ->> 'subject_ref'),
              null, r ->> 'title', r ->> 'doc_type', (r ->> 'filed_on')::date, r ->> 'url',
              coalesce(r -> 'facts', '{}'::jsonb), r ->> 'content_sha256', now_ts, now_ts);
      insert into public.official_record_observation (record_key, observed_at, content_sha256, title, facts)
      values (k, now_ts, r ->> 'content_sha256', r ->> 'title', coalesce(r -> 'facts', '{}'::jsonb));
      n_new := n_new + 1;
    else
      if prev.content_sha256 is distinct from (r ->> 'content_sha256')
         or prev.facts is distinct from coalesce(r -> 'facts', '{}'::jsonb)
         or prev.title is distinct from (r ->> 'title') then
        insert into public.official_record_observation (record_key, observed_at, content_sha256, title, facts)
        values (k, now_ts, r ->> 'content_sha256', r ->> 'title', coalesce(r -> 'facts', '{}'::jsonb));
        n_changed := n_changed + 1;
      end if;
      update public.official_record
         set title = r ->> 'title', doc_type = r ->> 'doc_type', filed_on = (r ->> 'filed_on')::date,
             url = r ->> 'url', facts = coalesce(r -> 'facts', '{}'::jsonb), content_sha256 = r ->> 'content_sha256',
             subject_ref = coalesce(r ->> 'subject_ref', p_payload ->> 'subject_ref', subject_ref),
             last_seen_at = now_ts, removed_from_source_at = null
       where record_key = k;
      n_seen := n_seen + 1;
    end if;
    for pt in select value from jsonb_array_elements(coalesce(r -> 'parties', '[]'::jsonb)) loop
      if not public.development_entity_is_organization(pt ->> 'name') then
        raise exception 'party % is not an organization; people are never stored', pt ->> 'name' using errcode = '22023';
      end if;
      pk := (public.development_entity_keys(pt ->> 'name'))[1];
      insert into public.official_record_party (record_key, party_key, party_name, role, quote, first_seen_at, last_seen_at)
      values (k, pk, btrim(pt ->> 'name'), pt ->> 'role', pt ->> 'quote', now_ts, now_ts)
      on conflict (record_key, party_key, role) do update
        set last_seen_at = now_ts, removed_at = null, quote = excluded.quote, party_name = excluded.party_name;
      if not exists (select 1 from public.official_record_party where record_key = k and party_key = pk
                       and role = pt ->> 'role' and first_seen_at < now_ts) then
        n_party_new := n_party_new + 1;
      end if;
    end loop;
    if coalesce((p_payload ->> 'complete')::boolean, false) then
      update public.official_record_party set removed_at = now_ts
       where record_key = k and removed_at is null and last_seen_at < now_ts;
    end if;
  end loop;
  -- parents are set once every record in the payload exists, so their order does not matter
  update public.official_record o set parent_key = x.value ->> 'parent_key'
    from jsonb_array_elements(p_payload -> 'records') x
   where o.record_key = x.value ->> 'record_key' and x.value ->> 'parent_key' is not null;
  if coalesce((p_payload ->> 'complete')::boolean, false) then
    -- a folder read in full: its documents that are no longer listed left the source
    update public.official_record d set removed_from_source_at = now_ts
     where d.kind = 'document' and d.removed_from_source_at is null and d.parent_key = any (keys)
       and not (d.record_key = any (keys));
    get diagnostics n_removed = row_count;
  end if;
  return jsonb_build_object('new', n_new, 'changed', n_changed, 'seen', n_seen, 'new_parties', n_party_new,
                            'removed', n_removed);
end $fn$;

create or replace function public.official_records_watch_list()
returns table (subject_ref text) language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select distinct l.object_ref
    from public.development_project_link l
   where l.object_kind = 'water_filing' and l.link_state in ('approved', 'candidate')
     and not exists (select 1 from public.development_project_link s where s.supersedes = l.link_id)
   order by 1
$fn$;

-- ── the daily proposal job ──────────────────────────────────────────────────────────────────
create or replace function public.development_propose_from_records(p_job text)
returns table (project_key text, object_kind text, object_ref text, role text, display_text text)
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare c record; lid uuid;
begin
  if p_job !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'a job must name itself' using errcode = '42501';
  end if;
  for c in
    with proj as (
      select p.project_id, p.project_key, p.state from public.development_project p where p.merged_into is null
    ),
    -- the newest row of every link chain (any state: a rejected entity is not proposed again)
    cur as (
      select l.* from public.development_project_link l
       where not exists (select 1 from public.development_project_link s where s.supersedes = l.link_id)
    ),
    live as (select * from cur where link_state in ('approved', 'candidate')),
    have_ent as (   -- every entity key a project already has, per role, in any state
      select cur.project_id, cur.role, k
        from cur, lateral unnest(public.development_entity_keys(substr(cur.object_ref, 4))) k   -- 'UT:<name>'
       where cur.object_kind = 'organization'
    ),
    -- 1. organizations a linked change record names
    from_records as (
      select pr.project_id, pr.project_key, pr.state, 'organization'::text object_kind,
             pt.party_name name,
             case pt.role when 'owner' then 'applicant' when 'developer' then 'master_developer' else pt.role end r,
             'a'::text grade, rec.url evidence_url,
             'Utah Division of Water Rights, ' || rec.title evidence_label, pt.quote, rec.record_key note_ref,
             case pt.role
               when 'owner' then 'Owner of the water right on ' || rec.title
               when 'buyer_under_contract' then 'Under contract to buy the water right on ' || rec.title
               when 'developer' then 'Named as the developer in ' || rec.title
               else initcap(replace(pt.role, '_', ' ')) || ' on ' || rec.title end txt,
             rec.filed_on d, case when rec.filed_on is null then null else 'Filed' end dl
        from live l join proj pr on pr.project_id = l.project_id
        join public.official_record rec on rec.subject_ref = l.object_ref and rec.kind = 'change_record'
        join public.official_record_party pt on pt.record_key = rec.record_key and pt.removed_at is null
       where l.object_kind = 'water_filing'
    ),
    -- 2. organizations owning anchor parcels of a linked land assembly
    from_parcels as (
      select pr.project_id, pr.project_key, pr.state, 'organization'::text, pp.owner_of_record,
             'landowner_of_record'::text, 'a'::text,
             min(pp.erecord_url) filter (where pp.erecord_url ~ '^https://'),
             'County tax record, parcel ' || min(pp.apn), null::text, l.object_ref,
             'Owner of record of ' || count(*) || ' of the associated parcels (about '
               || to_char(round(sum(pp.acres)), 'FM999,999,999') || ' acres), per county tax records',
             null::date, null::text
        from live l join proj pr on pr.project_id = l.project_id
        join public.resolved_projects rp on rp.project_key = l.object_ref
        join public.resolved_project_parcels pp on pp.project_id = rp.id and pp.in_anchor
       where l.object_kind = 'land_assembly' and public.development_entity_is_organization(pp.owner_of_record)
       group by pr.project_id, pr.project_key, pr.state, pp.owner_of_record, l.object_ref
    ),
    -- 3. governing bodies the land assembly's research names (verified only)
    from_bodies as (
      select pr.project_id, pr.project_key, pr.state, 'organization'::text, gb ->> 'body_name',
             'governing_body'::text, 'a'::text, gb ->> 'source_url', gb ->> 'source_system', null::text, l.object_ref,
             coalesce(gb ->> 'body_name', '') || ': ' || coalesce(gb ->> 'jurisdiction_basis', ''),
             null::date, null::text
        from live l join proj pr on pr.project_id = l.project_id
        join public.resolved_projects rp on rp.project_key = l.object_ref,
        lateral jsonb_array_elements(coalesce(rp.governing_bodies, '[]'::jsonb)) gb
       where l.object_kind = 'land_assembly' and gb ->> 'confidence' = 'verified'
         and gb ->> 'source_url' ~ '^https://'
    ),
    ents as (
      select * from from_records union all select * from from_parcels union all select * from from_bodies
    ),
    ent_new as (
      select distinct on (e.project_id, (public.development_entity_keys(e.name))[1], e.r) e.*
        from ents e
       where e.evidence_url ~ '^https://' and public.development_entity_is_organization(e.name)
         and not exists (select 1 from have_ent h
                          where h.project_id = e.project_id and h.role = e.r
                            and h.k = any (public.development_entity_keys(e.name)))
       order by e.project_id, (public.development_entity_keys(e.name))[1], e.r, e.note_ref
    ),
    -- 4. documents in a linked water right's folder that record an action
    docs_new as (
      select distinct on (pr.project_id, doc.url) pr.project_id, pr.project_key, pr.state, 'document'::text,
             doc.url, 'primary_document'::text, 'a'::text, doc.url,
             'Utah Division of Water Rights, scanned document ' || split_part(doc.record_key, ':', 2),
             null::text, doc.record_key,
             coalesce(doc.doc_type, 'Document') || ', water right ' || split_part(fol.record_key, ':', 2),
             doc.filed_on, case when doc.filed_on is null then null else 'Filed' end
        from live l join proj pr on pr.project_id = l.project_id
        join public.official_record ch on ch.subject_ref = l.object_ref and ch.kind = 'change_record'
        join public.official_record fol on fol.record_key = ch.parent_key and fol.kind = 'document_folder'
        join public.official_record doc on doc.parent_key = fol.record_key and doc.kind = 'document'
                                       and doc.removed_from_source_at is null
       where l.object_kind = 'water_filing'
         and doc.doc_type ~* '(application|amend|decision|order|proof|extension|approv|reject|withdraw|segregat|consolidat|conveyance|publication|certificate)'
         and doc.doc_type !~* '(protest|concern|correspondence|letter|e-?mail|memo)'
         and (doc.filed_on >= ch.filed_on - 365 or doc.first_seen_at > fol.first_seen_at + interval '1 day')
         and not exists (select 1 from cur where cur.project_id = pr.project_id and cur.object_kind = 'document'
                                             and cur.object_ref = doc.url)
       order by pr.project_id, doc.url
    ),
    -- 5. NEW water filings whose applicant is an organization the project already links (approved)
    filings_new as (
      select distinct on (pr.project_id, w.filing_no) pr.project_id, pr.project_key, pr.state, 'water_filing'::text,
             (case w.source when 'ut_dwr_pending' then 'ut_dwr' when 'id_idwr_applications' then 'id_idwr'
                              when 'nv_ndwr_pending' then 'nv_ndwr' end) || ':' || w.filing_no,
             case when w.filing_type ~* 'change' then 'water_change_application' else 'water_appropriation_application' end,
             'b'::text, w.record_url, 'State water-rights record ' || w.filing_no, null::text, w.applicant,
             coalesce(w.filing_type, 'Water-rights filing') || ' ' || w.filing_no || ', ' || w.applicant
               || coalesce(', filed ' || to_char(w.filed_on, 'Mon FMDD, YYYY'), ''),
             w.filed_on, w.date_label
        from public.water_rights_filings w
        join live l on l.object_kind = 'organization' and l.link_state = 'approved'
        join proj pr on pr.project_id = l.project_id
       where w.removed_from_source_at is null and w.record_url ~ '^https://'
         and w.source in ('ut_dwr_pending', 'id_idwr_applications', 'nv_ndwr_pending')
         and public.development_entity_is_organization(w.applicant)
         and w.filed_on >= current_date - 730
         and (public.development_entity_keys(w.applicant))
             && (public.development_entity_keys(substr(l.object_ref, 4)))
         and not exists (select 1 from cur where cur.project_id = pr.project_id and cur.object_kind = 'water_filing'
                           and split_part(cur.object_ref, ':', 2) = w.filing_no)
       order by pr.project_id, w.filing_no
    )
    select e.project_key pk, e.state, e.object_kind ok, e.state || ':' || btrim(replace(e.name, '`', '''')) ref, e.r role, e.grade,
           e.evidence_url, e.evidence_label, e.quote, 'From ' || e.note_ref note, e.txt, e.d, e.dl
      from ent_new e
    union all
    select d.project_key, d.state, d.object_kind, d.url, d.r, d.grade, d.evidence_url, d.evidence_label, d.quote,
           'From ' || d.note_ref, d.title, d.filed_on, d.dl
      from docs_new d (project_id, project_key, state, object_kind, url, r, grade, evidence_url, evidence_label,
                       quote, note_ref, title, filed_on, dl)
    union all
    select f.project_key, f.state, f.object_kind, f.ref, f.r, f.grade, f.evidence_url, f.evidence_label, f.quote,
           'Applicant ' || f.applicant || ' is an entity this development already links; whether this filing concerns '
             || 'the development is for the reviewer to check',
           f.txt, f.d, f.dl
      from filings_new f (project_id, project_key, state, object_kind, ref, r, grade, evidence_url, evidence_label,
                          quote, applicant, txt, d, dl)
  loop
    lid := public.development_link_propose(c.pk, c.ok, c.ref, c.role, c.grade, c.evidence_url, c.evidence_label,
             c.quote, c.note, c.txt, c.d, c.dl, null, false, p_job);
    project_key := c.pk; object_kind := c.ok; object_ref := c.ref; role := c.role; display_text := c.txt;
    return next;
  end loop;
end $fn$;

-- The protest window of a water filing, for the development dossier page (development_dossier_snapshot
-- calls it for every linked water_filing). Read from the state's own change record: its protest end
-- date and publication dates, the record's status words, and when we last read it. A filing with no
-- dated change record answers null, so the page shows no protest link. How to protest is the
-- agency's own form and guide, named per source here (the page renderer names no agency).
-- Utah (verified 2026-11-01): the Division of Water Rights' online form "Protest of Application"
-- takes the Water Right, Change, or Exchange number, the protesting party's name, mailing address,
-- phone and email, and the reasons, and charges a $15.00 non-refundable fee; a protest after the
-- protest period is "a Late Protest". Its home page: "If a party believes the proposed application
-- will impair existing water rights they may file a protest to the application."
create or replace function public.development_water_protest(p_ref text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
           'protest_end', r.facts ->> 'protest_end',
           'publication_began', r.facts ->> 'publication_began',
           'publication_end', r.facts ->> 'publication_end',
           'protested', r.facts ->> 'protested',
           'record_status', r.facts ->> 'status',
           'record_url', r.url,
           'checked_at', r.last_seen_at,
           'agency', a.agency, 'form_url', a.form_url, 'form_label', a.form_label,
           'help_url', a.help_url, 'help_label', a.help_label, 'who', a.who, 'how', a.how)
    from public.official_record r
    join (values ('ut_dwr', 'Utah Division of Water Rights',
                  'https://waterrights.utah.gov/protestOfApplication/protestOfApplication.asp',
                  'File a protest with the Utah Division of Water Rights',
                  'https://waterrights.utah.gov/wrinfo/Brochures/Protest-Filing-Process-2026.pdf',
                  'Protest Filing Q & A (Utah Division of Water Rights)',
                  'Anyone who believes this application will impair existing water rights may file a protest.',
                  'The state''s online form asks for the application number, your name, mailing address, phone and '
                  'email, and your reasons, and charges a $15 non-refundable fee. A protest filed after the period '
                  'ends is treated as a late protest.'))
         as a(src, agency, form_url, form_label, help_url, help_label, who, how)
      on a.src = split_part(p_ref, ':', 1)
   where r.subject_ref = p_ref and r.kind = 'change_record' and r.removed_from_source_at is null
     and (r.facts ->> 'protest_end') ~ '^\d{4}-\d{2}-\d{2}$'
   order by r.last_seen_at desc limit 1;
$fn$;
revoke all on function public.development_water_protest(text) from public, anon, authenticated;

revoke all on function public.official_records_ingest(jsonb), public.official_records_watch_list(),
  public.development_propose_from_records(text) from public, anon, authenticated;
grant execute on function public.official_records_ingest(jsonb), public.official_records_watch_list(),
  public.development_propose_from_records(text) to service_role;

commit;
