import json, sys, psycopg2, psycopg2.extras
# Regenerates test/fixtures/n5-generation-points/rpc_rows.json: loads real_rows.json (12 real production records,
# exported 2026-10-10, md5 5f5caaefe17615309c0455e4b81b9c27) into a disposable PostGIS and records what the PREVIOUS DDL
# (`git show <base>:docs/n5-spatial-read-rpc.sql` from before revision 4, passed as argv[1]) and the SHIPPED DDL return at two CONSTRUCTED
# subject points, ~0.45 and ~0.55 mile due north of Lightsey Residences. Not customer properties.
# usage: N5_TEST_DSN="host=... dbname=..." python3 gen_rpc_rows.py <old_ddl.sql>
import os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),"..",".."))
S=os.path.join(ROOT,"test","fixtures","n5-generation-points")
rows=json.load(open(S+"/real_rows.json"))
c=psycopg2.connect(os.environ["N5_TEST_DSN"]); c.autocommit=True
cur=c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute("do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;")
cur.execute(open(os.path.join(ROOT,"test","n5_spatial_pg","fixture_schema.sql")).read())
cur.execute("insert into geo.n5_verdict_manifest(snapshot_id,state,expected_source_keys,verdict_rows,eligible_rows,reject_counts,fingerprint,completed_at,canonical_synced_at) values ('phase1-2026-09-01','READY',1,1,1,'{}','fp',now(),now())")
cur.execute("insert into geo.n5_generation(generation_id,state) values ('n5-national-2026-10-10','ACTIVE')")
for r in rows:
    if r["src"]=="n5_geom":
        cur.execute("insert into geo.n5_geom(source_key,registry_id,feature_id,outcome,geom,provenance,verdict_snapshot_id) values (%s,%s,%s,1,st_setsrid(st_geomfromtext(%s),4269),%s,%s)",(r["source_key"],r["registry_id"],r["feature_id"],r["wkt"],r["provenance"],r["snap"]))
    else:
        cur.execute("insert into geo.n5_gen_proven_point(generation_id,source_key,registry_id,geom) values ('n5-national-2026-10-10',%s,%s,st_setsrid(st_geomfromtext(%s),4269))",(r["source_key"],r["registry_id"],r["wkt"]))
def call(sql_path, lat, lng, rad):
    cur.execute(open(sql_path).read())
    cur.execute("select * from public.n5_projects_within_radius(%s,%s,%s,2000) order by distance_mi, source_key, feature_id",(lat,lng,rad))
    return [dict(r) for r in cur.fetchall()]
import sys
OLD=sys.argv[1]; NEW=os.path.join(ROOT,"docs","n5-spatial-read-rpc.sql")
north=lambda mi: 30.23963078+mi/69.05
out={}
for tag,lat in (("045",north(0.45)),("055",north(0.55))):
    for ver,p in (("old",OLD),("new",NEW)):
        out[f"{ver}_{tag}"]=call(p,lat,-97.77712356,0.5)
out["subject_045"]=north(0.45); out["subject_055"]=north(0.55)
json.dump(out,open(S+"/rpc_rows.json","w"),default=str,indent=1)
for k,v in out.items():
    if isinstance(v,list): print(k,len(v),sorted(set(r["source_key"].split(":")[-1] for r in v if "0279C" in r["source_key"])))
