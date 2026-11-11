-- JODY Development Map indexing pilot: deterministic selection (2026-11-11). Read-only.
-- Groups are authoritative ZIP membership counts (geo.n5_serving_membership), i.e. the records the
-- interactive map draws. One treatment (rank 1) and one control (rank 2) per (group, state), for 25
-- states per group chosen by hash. 4 groups x 25 states = 100 treatment + 100 control.
with m as (select zcta5::text zip, count(*) n from geo.n5_serving_membership group by 1),
b as (select r.zip, max(c.state) state, coalesce(max(m.n),0) n
  from public.canonical_zip_registry r join public.communities c on c.level='zip' and r.zip = any(c.zip_codes)
  left join m on m.zip=r.zip group by r.zip),
c as (select zip,state,n, case when n=0 then 'g0_none' when n<=2 then 'g1_1to2' when n<=20 then 'g2_3to20' else 'g3_over20' end grp from b),
r as (select *, row_number() over (partition by grp, state order by md5(zip||'jody-map-pilot-2026-11-11')) rk from c),
s as (select grp, state from r where rk=2),
st as (select grp, state, row_number() over (partition by grp order by md5(state||grp||'jody-map-pilot-2026-11-11')) sr from s)
select json_agg(json_build_object('grp',r.grp,'state',r.state,'zip',r.zip,'n',r.n,
  'arm',case r.rk when 1 then 'treatment' else 'control' end) order by r.grp, r.state, r.rk) j
from r join st on st.grp=r.grp and st.state=r.state and st.sr<=25 where r.rk<=2;
