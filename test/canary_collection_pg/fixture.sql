drop schema if exists net cascade; create schema net;
create table net._http_response (id bigint primary key, status_code int, content text, error_msg text, created timestamptz);
drop table if exists public.development_reports cascade;
create table public.development_reports (zip text primary key, sites jsonb, refreshed_at timestamptz, facilities_refreshed_at timestamptz, last_collected_response_id bigint, epa_last_outcome jsonb);
drop table if exists public.dev_refresh_source_failures cascade;
create table public.dev_refresh_source_failures (zip text, seen_at timestamptz, blocked_update boolean);
drop table if exists public.app_projects cascade;
create table public.app_projects (zip text, record_kind text, provenance jsonb);
-- the fire was at 00:00 on 2026-10-11 ('2026-10-11 00:00:00+00' in the script)
-- 70001 good: response 1001 arrived 00:05, cache applied 00:06, cursor 1001
insert into net._http_response values (1001,200,'{"zip":"70001"}',null,'2026-10-11 00:05+00');
insert into public.development_reports values ('70001','[{}]','2026-10-11 00:06+00',null,1001,null);
-- 70002 LOST canary 2001 (no row); a later rolling refresh response 2002 was applied, cursor 2002
insert into net._http_response values (2002,200,'{"zip":"70002"}',null,'2026-10-11 03:00+00');
insert into public.development_reports values ('70002','[{}]','2026-10-11 03:01+00',null,2002,null);
-- 70003 response exists, collector rolled back: cursor still old
insert into net._http_response values (3001,200,'{"zip":"70003"}',null,'2026-10-11 00:05+00');
insert into public.development_reports values ('70003','[{}]','2026-10-09 00:00+00',null,2900,null);
-- 70004 evaluated but refused: cursor == id, refreshed_at old
insert into net._http_response values (4001,200,'{"zip":"70004"}',null,'2026-10-11 00:05+00');
insert into public.development_reports values ('70004','[{}]','2026-10-09 00:00+00',null,4001,null);
-- 70005 HTTP 500
insert into net._http_response values (5001,500,'{"zip":"70005"}',null,'2026-10-11 00:05+00');
insert into public.development_reports values ('70005','[{}]','2026-10-11 00:06+00',null,5001,null);
-- 70006 response names another zip
insert into net._http_response values (6001,200,'{"zip":"70099"}',null,'2026-10-11 00:05+00');
insert into public.development_reports values ('70006','[{}]','2026-10-11 00:06+00',null,6001,null);
-- 70007 blocked update
insert into net._http_response values (7001,200,'{"zip":"70007"}',null,'2026-10-11 00:05+00');
insert into public.development_reports values ('70007','[{}]','2026-10-11 00:06+00',null,7001,null);
insert into public.dev_refresh_source_failures values ('70007','2026-10-11 00:05:30+00',true);
