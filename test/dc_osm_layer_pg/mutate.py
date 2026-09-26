#!/usr/bin/env python3
"""Prohibited mutations of the OPENSTREETMAP LAYER'S ADDRESS CHECK. Each MUST fail the suite.

Usage: mutate.py --list                 -> "NAME FILE" per line (FILE is repo-relative)
       mutate.py NAME ABSOLUTE_FILE     -> the mutated file on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail
to apply (a mutation that does not apply is indistinguishable from one that survives).
"""
import sys

D3 = 'docs/dc-step3d-derived-location.sql'
B3 = 'docs/dc-step3b-canonical-geography.sql'
MAP = 'docs/map1-dc-publication.sql'

OSM_QUEUE = """        union all
        select o.geocoder_query, o.admitted
          from public.dc_osm_derived_point o
         where o.map_eligible
           and o.input_quality = 'GEOCODABLE'
           and o.derivation_id is null"""
CONFLICT = """            when public.dc_site_claims_conflict(o.osm_claim_class, null, o.osm_lat, o.osm_lng,
                                                'DERIVED_ADDRESS', o.positional_uncertainty_m, o.lat, o.lng)"""
NOT_US = """        if nullif(upper(btrim(coalesce(p_payload->>'addr:country', ''))), '') not in ('US', 'USA') then"""

MUTATIONS = {
    # the deployment gate (C3c): OSM admitted, and ONLY this extraction added
    'Y01_osm_not_admitted': (D3, [(
        "(('epoch_ai', 'data_centers'), ('compute_atlas', 'facilities'), ('openstreetmap', 'telecom_data_center')) $$;",
        "(('epoch_ai', 'data_centers'), ('compute_atlas', 'facilities')) $$;", 1)]),
    'Y01b_osm_admitted_widened': (D3, [(
        "('openstreetmap', 'telecom_data_center')) $$;",
        "('openstreetmap', 'telecom_data_center'), ('openstreetmap', 'other_distribution')) $$;", 1)]),
    # the OSM addresses never reach the ONE writer (a second queue would be needed)
    'Y02_queue_drops_osm': (D3, [(OSM_QUEUE, "", 1)]),
    # ineligible OSM records are geocoded too
    'Y03_queue_takes_ineligible': (D3, [("         where o.map_eligible\n           and o.input_quality", "         where o.input_quality", 1)]),
    # a private distance threshold instead of the shared conflict rule
    'Y04_private_conflict_math': (B3, [(CONFLICT,
        "            when ST_DistanceSphere(ST_MakePoint(o.osm_lng, o.osm_lat), ST_MakePoint(o.lng, o.lat)) > 5000", 1)]),
    # a project AREA treated as a site claim
    'Y05_area_is_site_claim': (D3, [(
        "case when r.location_precision in ('precise_location', 'approximate_campus_area')",
        "case when r.location_precision in ('precise_location', 'approximate_campus_area', 'approximate_project_area')", 1)]),
    # the record's own country is ignored
    'Y06_country_ignored': (D3, [(NOT_US, "        if false then", 1)]),
    # a failed or rejected geocode read as a verdict against the pin
    'Y07_absence_is_disagreement': (B3, [(
        "            when o.verdict <> 'ACCEPTED' then 'UNCHECKED_' || o.verdict\n",
        "            when o.verdict <> 'ACCEPTED' then 'SOURCES_DISAGREE'\n", 1)]),
    # the check readable by the public roles
    'Y08_check_public': (B3, [(
        "revoke all on public.dc_osm_address_check from anon, authenticated;",
        "grant select on public.dc_osm_address_check to anon, authenticated;", 1)]),
    # the OSM pin moved to the derived point (the view reports the geocode as the pin)
    'Y09_pin_moved': (D3, [(
        "select r.source_key, r.map_eligible, r.location_precision, r.lat as osm_lat, r.lng as osm_lng,",
        "select r.source_key, r.map_eligible, r.location_precision, coalesce(d.lat, r.lat) as osm_lat, coalesce(d.lng, r.lng) as osm_lng,", 1)]),
    # THE MAP 1 READER (C3c)
    'Y10_reader_ignores_admission': (MAP, [(
        "       and not (coalesce(k.admitted, false) and k.check_outcome = 'SOURCES_DISAGREE')),",
        "       and k.check_outcome is distinct from 'SOURCES_DISAGREE'),", 1)]),
    'Y11_reader_withholds_nothing': (MAP, [(
        "       and not (coalesce(k.admitted, false) and k.check_outcome = 'SOURCES_DISAGREE')),",
        "       ),", 1)]),
    'Y12_reader_flags_every_row': (MAP, [(
        "           case when k.admitted and k.check_outcome = 'CORROBORATED'\n",
        "           case when true\n", 1)]),
    'Y13_reader_withholds_unchecked': (MAP, [(
        "       and not (coalesce(k.admitted, false) and k.check_outcome = 'SOURCES_DISAGREE')),",
        "       and not (coalesce(k.admitted, false) and k.check_outcome <> 'CORROBORATED')),", 1)]),
    'Y14_reader_moves_pin_to_geocode': (MAP, [(
        "           lc.map_status, r.project_type, r.lat, r.lng, r.location_text, r.location_precision,",
        "           lc.map_status, r.project_type, coalesce(k.lat, r.lat) as lat, coalesce(k.lng, r.lng) as lng, r.location_text, r.location_precision,", 1)]),
}


def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--list':
        for k, (f, _) in MUTATIONS.items():
            print(k, f)
        return
    name, path = sys.argv[1], sys.argv[2]
    _, edits = MUTATIONS[name]
    s = open(path).read()
    for old, new, n in edits:
        got = s.count(old)
        if got != n:
            sys.stderr.write(f'{name}: anchor found {got}x, expected {n}x: {old[:80]!r}\n')
            sys.exit(2)
        s = s.replace(old, new)
    sys.stdout.write(s)


if __name__ == '__main__':
    main()
