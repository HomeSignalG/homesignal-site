drop schema if exists net cascade; create schema net;
create table net._http_response (id bigint primary key, status_code int, content text, created timestamptz);
drop table if exists public.development_reports cascade;
create table public.development_reports (zip text primary key, refreshed_at timestamptz, last_collected_response_id bigint);
