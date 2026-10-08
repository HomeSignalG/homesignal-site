-- Disposable stand-in for pg_cron (NEVER applied to production: run.sh refuses unless PGDATABASE names a
-- disposable database). Production runs pg_cron 1.6.4; the local and CI Postgres images do not carry it, so this
-- reproduces the three calls the shipped SQL makes and the unique (jobname, username) rule, nothing more.
--   cron.schedule(name, schedule, command)  — creates the job, or updates it when that name already exists
--   cron.alter_job(id, schedule, command, database, username, active)
--   cron.unschedule(id)
-- What this CANNOT prove is real pg_cron behaviour; the production read-back after the apply does that.
drop schema if exists cron cascade;
create schema cron;
create table cron.job (
  jobid    bigserial primary key,
  schedule text    not null,
  command  text    not null,
  nodename text    not null default 'localhost',
  nodeport integer not null default 5432,
  database text    not null default current_database(),
  username text    not null default current_user,
  active   boolean not null default true,
  jobname  text,
  unique (jobname, username)
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values ($1, $2, $3)
  on conflict (jobname, username) do update set schedule = excluded.schedule, command = excluded.command, active = true
  returning jobid
$$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
                               database text default null, username text default null, active boolean default null)
returns void language sql as $$
  update cron.job j set schedule = coalesce($2, j.schedule), command = coalesce($3, j.command), active = coalesce($6, j.active)
   where j.jobid = $1
$$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$
  with d as (delete from cron.job where jobid = $1 returning 1) select exists (select 1 from d)
$$;
