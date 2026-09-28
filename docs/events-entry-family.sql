-- HomeSignal — record which page type a visit entered through (SEO plan step 14).
--
-- Search Console reports impressions, clicks, CTR and position per submitted sitemap,
-- one sitemap per page type (/sitemaps/zip-alerts.xml, zip-development.xml, city.xml,
-- project.xml, guide.xml). This is the site's half: an address lookup or an alert
-- sign-up is written to public.events with the page type the visit ENTERED through.
--
-- Client: lib/data.js HS.pageFamily / HS.entryFrom / HS.eventRow / HS.logEvent,
--         shell.js captureEntry(), and the four call sites
--         (property_lookup, alert_signup_area, alert_signup_maps, alert_signup_topics).
--
-- ADDITIVE ONLY: two nullable columns, two CHECK constraints, one read function.
-- Existing rows keep NULL. The browser keeps INSERT only (table-level grant, so the new
-- columns are covered); it still cannot read the table. Apply this BEFORE the site
-- change deploys: until then the client's insert names columns that do not exist,
-- PostgREST refuses it, and the event is dropped silently.

begin;

alter table public.events add column if not exists entry_family text;
alter table public.events add column if not exists entry_path   text;

comment on column public.events.entry_family is
  'Page type the visit entered through: zip, city, project, guide, home, map, other (lib/data.js HS.pageFamily). NULL = not recorded.';
comment on column public.events.entry_path is
  'Path of the page the visit entered through, no query string (lib/data.js HS.entryFrom).';

alter table public.events drop constraint if exists events_entry_family_known;
alter table public.events add constraint events_entry_family_known check (
  entry_family is null
  or entry_family in ('zip', 'city', 'project', 'guide', 'home', 'map', 'other'));

alter table public.events drop constraint if exists events_entry_path_bounded;
alter table public.events add constraint events_entry_path_bounded check (
  entry_path is null or (length(entry_path) <= 200 and entry_path like '/%'));

-- Read side: counts per entry page type. Service role only; no browser role may run it.
create or replace function public.hs_seo_family_conversions(p_days integer default 28)
returns table (
  entry_family       text,
  property_lookups   bigint,
  alert_signups      bigint,
  converting_sessions bigint
)
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(e.entry_family, '(not recorded)')                          as entry_family,
         count(*) filter (where e.event_type = 'property_lookup')             as property_lookups,
         count(*) filter (where e.event_type like 'alert\_signup\_%')         as alert_signups,
         count(distinct e.session_id)                                         as converting_sessions
  from public.events e
  where e.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 28), 1))
    and (e.event_type = 'property_lookup' or e.event_type like 'alert\_signup\_%')
  group by 1
  order by 1 collate "C";
$fn$;

revoke all on function public.hs_seo_family_conversions(integer) from public;
revoke all on function public.hs_seo_family_conversions(integer) from anon, authenticated;
grant execute on function public.hs_seo_family_conversions(integer) to service_role;

-- Post-conditions: refuse to commit a half-applied or wrongly-granted change.
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'events'
        and column_name in ('entry_family', 'entry_path')) <> 2 then
    raise exception 'events entry columns missing';
  end if;
  if has_function_privilege('anon', 'public.hs_seo_family_conversions(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.hs_seo_family_conversions(integer)', 'execute') then
    raise exception 'hs_seo_family_conversions is callable by a browser role';
  end if;
  if not has_table_privilege('anon', 'public.events', 'insert')
     or has_table_privilege('anon', 'public.events', 'select') then
    raise exception 'events browser grants changed: anon must insert and must not select';
  end if;
end $$;

commit;
