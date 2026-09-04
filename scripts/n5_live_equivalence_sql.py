#!/usr/bin/env python3
"""Emit a READ-ONLY query that proves the OPTIMIZED verdict derivation reproduces the
already-proven production state, and measures how long it takes.

The SELECT is lifted from the SHIPPED refresh_proven_verdict_sql() rather than retyped, so
what is measured and compared is exactly the SQL publish-verdict will execute. The OLD
correlated form is deliberately NOT run here: it could not complete inside a 2-minute
(Management API, run 33787011485) or a 15-minute (PG-wire, run 33789161115) budget, so the
oracle is the canonical geometry and reject ledger the applied migration already proved.
Row-for-row OLD vs NEW equality is proven separately, offline, by the OLD-VS-NEW DERIVATION
group in test/n5_pg/run_suite.py.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SNAPSHOT", "phase1-2026-09-01")
import n5_shard as N                                                    # noqa: E402

ins = N.refresh_proven_verdict_sql()
sel = ins[ins.index("with src as"):].rstrip().rstrip(";")
assert "group by source_key" in sel, "shipped derivation is not the grouped-aggregate form"
assert "(select count(*) from pairs q where" not in sel, "correlated subquery still present"

TEMPLATE = """set session characteristics as transaction read only;
set statement_timeout = '15min';
with v(snapshot_id, source_key, registry_id, ncoord, lat, lng, verdict) as (
%s
)
select (select count(*) from v),
       (select count(distinct source_key) from v),
       (select count(*) from (select source_key from v group by 1 having count(*) <> 1) t),
       (select count(*) from v where verdict = 'ELIGIBLE'),
       (select count(*) from v where verdict <> 'ELIGIBLE'),
       (select count(*) from v where verdict = 'MULTI_COORD_UNRESOLVED'),
       (select count(*) from v where verdict = 'NULL_COORD'),
       (select count(*) from (select source_key from v where verdict = 'ELIGIBLE'
          except select source_key from geo.n5_geom where provenance = 'proven_stored_point') t),
       (select count(*) from (select source_key from geo.n5_geom where provenance = 'proven_stored_point'
          except select source_key from v where verdict = 'ELIGIBLE') t),
       (select count(*) from (select source_key from v where verdict <> 'ELIGIBLE'
          except select source_key from geo.n5_point_reject) t),
       (select count(*) from (select source_key from geo.n5_point_reject
          except select source_key from v where verdict <> 'ELIGIBLE') t),
       (select count(*) from v join geo.n5_geom g on g.source_key = v.source_key
         where v.verdict = 'ELIGIBLE' and g.provenance = 'proven_stored_point'
           and (abs(ST_X(g.geom) - v.lng) > 1e-9 or abs(ST_Y(g.geom) - v.lat) > 1e-9));
"""
sys.stdout.write(TEMPLATE % sel)
