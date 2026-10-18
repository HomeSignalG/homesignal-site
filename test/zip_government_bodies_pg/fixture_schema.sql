-- Minimal stand-ins for the production objects the function reads (disposable database only).
drop schema if exists geo cascade; drop table if exists public.communities, public.users, public.user_subscriptions cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema geo;
create table geo.zcta_boundary (zcta5 text primary key);
create table geo.zcta_place_overlap (
  zcta5 char(5), place_geoid text, place_name text, place_class text, place_funcstat text,
  zcta_arealand bigint, part_arealand bigint not null,
  area_share numeric generated always as (case when zcta_arealand > 0 then part_arealand::numeric / zcta_arealand end) stored,
  source_md5 text not null default 'x', primary key (zcta5, place_geoid));
revoke all on geo.zcta_place_overlap from public;
create table public.communities (
  id uuid primary key, name text, county text, state text, level text, parent_id uuid,
  zip_codes text[], government_topics text[], census_place_geoid text);

insert into public.communities values
 ('00000000-0000-0000-0000-0000000000c1','Pierce County','Pierce','WA','county',null,array['98466','98444','98411','98333'],array['County Commission & county business'],null),
 ('00000000-0000-0000-0000-0000000000a1','Tacoma','Pierce','WA','city','00000000-0000-0000-0000-0000000000c1',array[]::text[],array['City government (Tacoma)'],'5370000'),
 ('00000000-0000-0000-0000-0000000000f1','University Place (98466)','Pierce','WA','zip','00000000-0000-0000-0000-0000000000c1',array['98466'],array[]::text[],null),
 ('00000000-0000-0000-0000-0000000000f2','Parkland (98444)','Pierce','WA','zip','00000000-0000-0000-0000-0000000000c1',array['98444'],array[]::text[],null),
 ('00000000-0000-0000-0000-0000000000f3','Tacoma (98411)','Pierce','WA','zip','00000000-0000-0000-0000-0000000000c1',array['98411'],array[]::text[],null),
 ('00000000-0000-0000-0000-0000000000f4','Fox Island (98333)','Pierce','WA','zip','00000000-0000-0000-0000-0000000000c1',array['98333'],array[]::text[],null),
 -- a city community created before its feeds are wired: no government topics yet
 ('00000000-0000-0000-0000-0000000000a8','Fircrest','Pierce','WA','city','00000000-0000-0000-0000-0000000000c1',array[]::text[],array[]::text[],'5324250'),
 -- a coded city that covers only 0.5% of 98444: below the floor everywhere
 ('00000000-0000-0000-0000-0000000000a9','Lakewood','Pierce','WA','city','00000000-0000-0000-0000-0000000000c1',array[]::text[],array['City government (Lakewood)'],'5399999'),
 -- Utah: a chain city with no Census code yet, and one with a code
 ('00000000-0000-0000-0000-0000000000c2','Utah County','Utah','UT','county',null,array['84601','84003'],array['County Commission & county business'],null),
 ('00000000-0000-0000-0000-0000000000a2','Provo','Utah','UT','city','00000000-0000-0000-0000-0000000000c2',array['84601'],array['City government (Provo)'],null),
 ('00000000-0000-0000-0000-0000000000f5','Provo (84601)','Utah','UT','zip','00000000-0000-0000-0000-0000000000a2',array['84601'],array[]::text[],null),
 ('00000000-0000-0000-0000-0000000000a3','American Fork','Utah','UT','city','00000000-0000-0000-0000-0000000000c2',array['84003'],array['City government (American Fork)'],'4901310'),
 ('00000000-0000-0000-0000-0000000000f6','American Fork (84003)','Utah','UT','zip','00000000-0000-0000-0000-0000000000a3',array['84003'],array[]::text[],null),
 -- a ROOT city (Eagle Mountain shape)
 ('00000000-0000-0000-0000-0000000000a4','Eagle Mountain','Utah','UT','city',null,array['84005'],array['County Commission & county business'],'4920120'),
 ('00000000-0000-0000-0000-0000000000f7','Eagle Mountain (84005)','Utah','UT','zip','00000000-0000-0000-0000-0000000000a4',array['84005'],array[]::text[],null);

-- a consolidated city-county: five borough roots that are all the one city
insert into public.communities values
 ('00000000-0000-0000-0000-0000000000c3','New York County','New York','NY','county',null,array['10001'],array['County Commission & county business'],'3651000'),
 ('00000000-0000-0000-0000-0000000000c4','Kings County','Kings','NY','county',null,array['11201'],array['County Commission & county business'],'3651000'),
 ('00000000-0000-0000-0000-0000000000f8','Chelsea (10001)','New York','NY','zip','00000000-0000-0000-0000-0000000000c3',array['10001'],array[]::text[],null);
insert into geo.zcta_boundary values ('98466'),('98444'),('98333'),('84601'),('84003'),('84005'),('10001');
-- 98411 is a PO-box ZIP: no ZCTA, no overlap rows.
insert into geo.zcta_place_overlap (zcta5, place_geoid, place_name, place_class, place_funcstat, zcta_arealand, part_arealand) values
 ('98466','5373465','University Place city','C1','A',1000,631),
 ('98466','5324250','Fircrest city','C1','A',1000,255),
 ('98466','5370000','Tacoma city','C1','A',1000,114),
 ('98444','5370000','Tacoma city','C1','A',1000,190),
 ('98444','5353190','Parkland CDP','U1','S',1000,700),
 ('98444','5399999','Lakewood city','C1','A',1000,5),        -- 0.5%: below the 1% floor
 ('98444','5388888','Balance of X','C8','F',1000,50),         -- not a government
 ('84601','4962470','Provo city','C1','A',1000,980),
 ('84003','4901310','American Fork city','C1','A',1000,900),
 ('84005','4920120','Eagle Mountain city','C1','A',1000,935),
 ('10001','3651000','New York city','C1','A',1000,1000);

-- identities and selections, for clear_alert_selection
drop schema if exists auth cascade; create schema auth;
create table auth._jwt (claims jsonb);
create function auth.jwt() returns jsonb language sql stable as $$ select claims from auth._jwt limit 1 $$;
create table public.users (id uuid primary key, email text not null, community_id uuid not null, unique (email, community_id));
create table public.user_subscriptions (user_id uuid, community_id uuid, stream text, topic text, origin text, sort_order int default 0,
  primary key (user_id, community_id, stream, topic));
insert into public.users values
 ('00000000-0000-0000-0000-00000000aa01','res@example.com','00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-00000000aa02','res@example.com','00000000-0000-0000-0000-0000000000a1'),
 ('00000000-0000-0000-0000-00000000aa03','other@example.com','00000000-0000-0000-0000-0000000000a1');
insert into public.user_subscriptions values
 ('00000000-0000-0000-0000-00000000aa01','00000000-0000-0000-0000-0000000000c1','meetings','Elections & voting','explicit',1),
 ('00000000-0000-0000-0000-00000000aa02','00000000-0000-0000-0000-0000000000a1','meetings','Elections & voting','explicit',1),
 ('00000000-0000-0000-0000-00000000aa02','00000000-0000-0000-0000-0000000000a1','notices','City government (Tacoma)','explicit',1),
 ('00000000-0000-0000-0000-00000000aa02','00000000-0000-0000-0000-0000000000a1','notices','County Commission & county business','follow_floor',0),
 ('00000000-0000-0000-0000-00000000aa03','00000000-0000-0000-0000-0000000000a1','meetings','Elections & voting','explicit',1);
