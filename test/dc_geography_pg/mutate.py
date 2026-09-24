#!/usr/bin/env python3
"""Prohibited mutations of docs/dc-step3b-canonical-geography.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply.
"""
import sys

AREA_STATUS = "                when b.basis = 'NON_SITE_AREA' then 'GEOGRAPHY_UNRESOLVED'\n"
MUTATIONS = {
    # decide geography from unlinked current evidence (the 2026-09-24 outage)
    'no_identity_guard': [("    if v_pending > 0 then", "    if false then", 1)],
    # publish a publisher's town centroid as a facility point
    'no_area_demotion': [(AREA_STATUS, "", 1)],
    # let the publisher's "exact" label override its own centroid statement
    'exact_overrides': [(AREA_STATUS, "                when b.basis = 'NON_SITE_AREA' and b.prec is distinct from 'exact' then 'GEOGRAPHY_UNRESOLVED'\n", 1)],
    # decimal count as ground truth: reject every 2-dp point
    'decimals_as_truth': [("or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'", "or b.decimals <= 2 then 'GEOGRAPHY_UNRESOLVED'", 1)],
    # road references demoted as if they were town centroids
    'road_demotes': [(AREA_STATUS, "                when b.basis in ('NON_SITE_AREA', 'NON_SITE_ROAD') then 'GEOGRAPHY_UNRESOLVED'\n", 1)],
    # a historical sentence treated as the current pin
    'no_history_guard': [("            continue when pre ~* hist_re;\n", "", 1)],
    # a direction phrase ("south of X city center") treated as the pin
    'no_direction_guard': [("            continue when area_rules[i][1] = 'AREA_CENTROID' and pre ~ dir_re;\n", "", 1)],
    # parks / roads in a matched place name treated as a settlement
    'no_park_road_guard': [("            continue when mm.m ~* park_re or mm.m ~ roadsuf_re;\n", "", 1)],
    # one source's text rule applied to every source
    'every_source': [("    if p_source_key = 'compute_atlas' then\n        -- the publisher's own sentences", "    if true then\n        -- the publisher's own sentences", 1)],
    # a rule silently disabled
    'drop_county_seat_rule': [("array['COUNTY_SEAT', '\\ycounty seat\\y', 'i']", "array['COUNTY_SEAT', 'x(?!x)x', 'i']", 1)],
    # prefer the area observation over the site observation
    'area_first': [("(basis = 'NON_SITE_AREA'), (basis = 'DERIVED_ADDRESS'),", "(basis <> 'NON_SITE_AREA'), (basis = 'DERIVED_ADDRESS'),", 1)],
    # a demoted facility disappears from the geography plane
    'delete_demoted': [("         where e.superseded_by is null)", "         where e.superseded_by is null and coalesce(p.basis, '') <> 'NON_SITE_AREA')", 1)],
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
