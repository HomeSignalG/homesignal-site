-- Disposable stand-in for pg_net (NEVER applied to production: run.sh refuses unless PGDATABASE names a disposable one).
-- Reproduces only what the shipped SQL touches: net.http_get(url, params, headers, timeout_milliseconds) -> request id,
-- and the response table net._http_response with the columns production has. Answers are written by the suite, by hand.
drop schema if exists net cascade;
create schema net;
create sequence net.req_seq;
create table net.sent (id bigint primary key, url text, headers jsonb, timeout_ms int);
create table net._http_response (id bigint primary key, status_code int, content_type text, headers jsonb, content text,
                                 timed_out boolean, error_msg text, created timestamptz default now());
create function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
                             timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$
declare i bigint := nextval('net.req_seq');
begin insert into net.sent values (i, url, headers, timeout_milliseconds); return i; end $$;
