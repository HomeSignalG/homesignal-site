#!/usr/bin/env python3
"""Prohibited mutations of docs/dc-step3b-canonical-geography.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply.
"""
import sys

PICK_CLASS = "              (evidence_class in ('PUBLISHER_NON_SITE', 'PUBLISHER_UNUSABLE')),\n"
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
    'area_first': [(PICK_CLASS, "              (evidence_class not in ('PUBLISHER_NON_SITE', 'PUBLISHER_UNUSABLE')),\n", 1)],
    # ── canonical geography authority (rule_version 4) ──
    # G1 a source NAME decides authority
    'G1_atlas_always_wins': [(PICK_CLASS, "              (source_key = 'compute_atlas') desc,\n" + PICK_CLASS, 1)],
    # G3 the publisher's "exact" label decides authority over the evidence class
    'G3_publisher_exact_always_wins': [(PICK_CLASS, "              (prec = 'exact') desc nulls last,\n" + PICK_CLASS, 1)],
    # G5 any coordinate difference is a disagreement (no allowance for anyone's error)
    'G5_any_difference_disagrees': [("then 1000\n", "then 0\n", 1),
                                    ("else coalesce(p_uncertainty_a, 0) + coalesce(p_uncertainty_b, 0) end", "else 0 end", 1)],
    # G7 among conflicting claims, the closest agreeing pair wins
    'G7_closest_pair_wins': [("b.evidence_class, b.uncertainty_m, b.lat, b.lng)) disagree,",
        "b.evidence_class, b.uncertainty_m, b.lat, b.lng)\n"
        "                          and not exists (select 1 from _geo_pts c join _geo_pts d on c.canonical_entity_id = d.canonical_entity_id"
        " and c.source_key < d.source_key where c.canonical_entity_id = e.canonical_entity_id"
        " and c.evidence_class in ('PUBLISHER_SITE', 'DERIVED_ADDRESS') and d.evidence_class in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')"
        " and not public.dc_site_claims_conflict(c.evidence_class, c.uncertainty_m, c.lat, c.lng, d.evidence_class, d.uncertainty_m, d.lat, d.lng))) disagree,", 1)],
    # G13 two peer site claims never conflict: a genuine contradiction publishes arbitrarily
    'G13_peer_conflict_publishes': [("    select p_class_a in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')\n",
        "    select not (p_class_a = 'PUBLISHER_SITE' and p_class_b = 'PUBLISHER_SITE')\n       and p_class_a in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')\n", 1)],
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
