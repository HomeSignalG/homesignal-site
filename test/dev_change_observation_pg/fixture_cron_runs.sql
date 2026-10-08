-- Disposable stand-in for cron.job_run_details, added to the pg_cron stand-in
-- (test/report_private_context_purge_pg/fixture_cron.sql). NEVER applied to production: run.sh refuses unless
-- PGDATABASE names a disposable database. Only the columns the shipped SQL reads (jobid, status, start_time) are
-- meaningful; the others exist so the table has pg_cron 1.6's shape. What this CANNOT prove is real pg_cron
-- behaviour; the production read-back after the apply does that.
create table cron.job_run_details (
  jobid          bigint,
  runid          bigserial primary key,
  job_pid        integer,
  database       text,
  username       text,
  command        text,
  status         text,
  return_message text,
  start_time     timestamptz,
  end_time       timestamptz
);
