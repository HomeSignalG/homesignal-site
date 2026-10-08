-- Disposable stand-ins for pg_net and the vault (NEVER applied to production: run.sh refuses unless PGDATABASE names a disposable database).
-- They reproduce only what the shipped SQL touches:
--   vault.decrypted_secrets (name, decrypted_secret)   the one secret the wrapper reads
--   net.http_post(url, body, params, headers, timeout_milliseconds)   records the request it would make, returns its id
-- What this CANNOT prove is real delivery; the production read-back after the apply does that.
drop schema if exists vault cascade;
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
drop schema if exists net cascade;
create schema net;
create table net.calls (id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                              headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.calls (url, body, params, headers, timeout_milliseconds) values ($1, $2, $3, $4, $5) returning id
$$;
