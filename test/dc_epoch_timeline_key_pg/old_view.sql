-- the dc_observation_record_key definition BEFORE the Epoch timeline key (origin/main 2026-10-01; production md5 of
-- pg_get_viewdef 12d40cc3f3e04a625d1d5e15faeb3343). Generated from git, never retyped.
create or replace view public.dc_observation_record_key with (security_invoker = true) as
select o.home_signal_observation_id,
       case when o.publisher_record_id is not null
              then o.source_key || '|' || o.distribution_key || '|' || o.publisher_record_id
            when s.supplies_publisher_record_id is false
             and nullif(btrim(o.source_native_name), '') is not null
             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name)) = 1
              then o.source_key || '|' || o.distribution_key || '|name:' || btrim(o.source_native_name)
            else 'singleton|' || o.home_signal_observation_id::text end as record_key,
       case when o.publisher_record_id is not null then 0
            when s.supplies_publisher_record_id is false
             and nullif(btrim(o.source_native_name), '') is not null
             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name)) = 1 then 1
            else 2 end as record_key_rank   -- 0 publisher id, 1 unique name, 2 singleton
  from public.dc_source_observation o
  join public.dc_source s on s.source_key = o.source_key;
