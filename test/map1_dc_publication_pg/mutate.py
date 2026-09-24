#!/usr/bin/env python3
"""Prohibited mutations of docs/map1-dc-publication.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if the anchor is absent
Every anchor must match EXACTLY ONCE (except where `count` says otherwise), so a mutation can
never silently fail to apply.
"""
import re
import sys

MUTATIONS = {
    # proximity instead of geography: a 5-mile circle around the ZIP polygon's centre
    'centroid_radius': [(
        "select p.*, geo.zip_point_membership_in(bb.geom, p.lat, p.lng) as verdict",
        "select p.*, case when ST_DistanceSphere(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4269), "
        "ST_Centroid(bb.geom)) <= 8046.72 then 'member' else 'outside' end as verdict", 1)],
    # publish every classification (NON_DC and DC_CANDIDATE onto Map 1)
    'publish_non_confirmed': [(
        "and e.classification = 'CONFIRMED_DC'", "and e.classification is not null", 1)],
    # publish unresolved / not-a-site geography as a precise point
    'publish_unresolved': [(
        "and ge.geography_status = 'RESOLVED'\n       and ge.geometry_type = 'POINT'",
        "and ge.lat is not null", 1)],
    # drop the legacy OSM population during migration (coverage loss)
    'drop_osm_compat': [(
        "pool as (select * from canon union all select * from osm_kept)",
        "pool as (select * from canon)", 1)],
    # fuzzy proximity dedupe (50 m pairs are NOT the same facility)
    'loose_dedupe': [(")) <= 1", ")) <= 100", 3)],
    # a source-specific reader
    'atlas_only': [(
        "where e.superseded_by is null",
        "where e.superseded_by is null and o.source_key = 'compute_atlas'", 1)],
    # a cancelled data centre drawn as a data centre
    'publish_cancelled': [(
        "('proposed',           'Proposed')),",
        "('proposed',           'Proposed'),\n    ('cancelled',          'Approved')),", 1)],
    # the page's old collapse: everything not operational is Approved
    'status_collapse': [(
        "('proposed',           'Proposed')", "('proposed',           'Approved')", 1)],
    # a duplicate marker for the same facility
    'no_dedupe': [("where not (", "where true or not (", 1)],
    # the superseded identity keeps publishing
    'publish_superseded': [("where e.superseded_by is null", "where true", 1)],
    # boundary-inclusive membership with no edge guard: one point, two ZIP pages
    'edge_blind': [("where verdict = 'member' and zcta_hits <= 1", "where verdict = 'member'", 1)],
}


def main():
    if sys.argv[1:] == ['--list']:
        print('\n'.join(MUTATIONS))
        return 0
    name, path = sys.argv[1], sys.argv[2]
    text = open(path, encoding='utf-8').read()
    for find, repl, count in MUTATIONS[name]:
        n = text.count(find)
        if n != count:
            sys.stderr.write('%s: anchor %r appears %d time(s), expected %d\n' % (name, find, n, count))
            return 2
        text = text.replace(find, repl)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
