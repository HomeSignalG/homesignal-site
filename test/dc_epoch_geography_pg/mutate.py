#!/usr/bin/env python3
"""Prohibited mutations of the Epoch canonical-geography path. Each MUST fail the suite.

Usage: mutate.py --list                 -> "NAME FILE" per line (FILE is repo-relative)
       mutate.py NAME ABSOLUTE_FILE     -> the mutated file on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply (a mutation that does not apply is indistinguishable from one that survives).

M9 (an Epoch-specific reader) and M13 (fixture names as decision logic) are structural and live in
test/dc-epoch-geography-structure.test.mjs.
"""
import sys

D3 = 'docs/dc-step3d-derived-location.sql'
A3 = 'docs/dc-step3a-canonical-identity.sql'
B3 = 'docs/dc-step3b-canonical-geography.sql'
MAP = 'docs/map1-dc-publication.sql'
LOAD = 'docs/dc-geocode-observations-load.sql'

EDGE_TAIL = """     where r.revoked_at is null and r.verdict = 'CONFIRMED_MATCH';
    select count(*) into v_reviews from _res_edge;"""


def auto_edge(rule):
    return EDGE_TAIL.replace(
        "'CONFIRMED_MATCH';\n",
        "'CONFIRMED_MATCH'\n"
        "    union all\n"
        "    select ra.record_key, rb.record_key from public.dc_identity_candidate k\n"
        "      join public.dc_observation_record_key ra on ra.home_signal_observation_id = k.observation_a\n"
        "      join public.dc_observation_record_key rb on rb.home_signal_observation_id = k.observation_b\n"
        "     where k.candidate_rule_key = '%s';\n" % rule)


UNKNOWN_TYPE = """    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated') then
        return query select 'REJECTED_UNKNOWN_MATCH_TYPE'::text, null::double precision, 'unknown precision is not a site'::text;
"""
ACCEPT_LIST = "    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated') then"
AREA_LIST = "    elsif p_match_type in ('zip_centroid', 'county_centroid') then"
AREA_ONLY_SITE = "and a.basis <> 'NON_SITE_AREA' and b.basis <> 'NON_SITE_AREA'"
RECORD_KEY_UNIQUE = """             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name)) = 1"""

MUTATIONS = {
    # M1 the provider's ZIP centroid substituted for the derived point
    'M1_provider_zip_centroid': (B3, [(
        "           null::text, dp.lat, dp.lng, 6, o.observed_at,",
        "           null::text,\n"
        "           coalesce((select ST_Y(ST_Centroid(z.geom)) from geo.zcta_boundary z where z.zcta5 = right(dp.matched_address, 5)), dp.lat),\n"
        "           coalesce((select ST_X(ST_Centroid(z.geom)) from geo.zcta_boundary z where z.zcta5 = right(dp.matched_address, 5)), dp.lng),\n"
        "           6, o.observed_at,", 1)]),
    # M2 a ZIP centroid accepted as a site
    'M2_accept_zip_centroid': (D3, [
        (AREA_LIST, "    elsif p_match_type in ('county_centroid') then", 1),
        (ACCEPT_LIST, "    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated', 'zip_centroid') then", 1)]),
    # M3 a county centroid accepted as a site
    'M3_accept_county_centroid': (D3, [
        (AREA_LIST, "    elsif p_match_type in ('zip_centroid') then", 1),
        (ACCEPT_LIST, "    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated', 'county_centroid') then", 1)]),
    # M4 an unknown match type accepted
    'M4_accept_unknown_type': (D3, [(UNKNOWN_TYPE, "", 1)]),
    # M5 the writer copies derived coordinates into publisher evidence
    'M5_write_source_coordinates': (LOAD, [(
        "on conflict (geocoder_query, ladder_version) do nothing;\n",
        "on conflict (geocoder_query, ladder_version) do nothing;\n"
        "update public.dc_source_observation o set source_native_lat = d.lat, source_native_lon = d.lng\n"
        "  from public.dc_observation_derived_point d\n"
        " where d.home_signal_observation_id = o.home_signal_observation_id and d.verdict = 'ACCEPTED';\n", 1)]),
    # M6 a nearby derived point merges automatically
    'M6_auto_merge_nearby': (A3, [(EDGE_TAIL, auto_edge('DERIVED_POINT_NEAR_OTHER_SOURCE_DC'), 1)]),
    # M6b the adjudicator confirms a nearby pair by rule
    'M6b_adjudicate_nearby_as_match': (A3, [(
        "        return query select 'POSSIBLE_MATCH'::text,\n"
        "            case when p_candidate_rule_key = 'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'",
        "        return query select case when p_candidate_rule_key = 'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'\n"
        "                                 then 'CONFIRMED_MATCH' else 'POSSIBLE_MATCH' end::text,\n"
        "            case when p_candidate_rule_key = 'DERIVED_POINT_NEAR_OTHER_SOURCE_DC'", 1)]),
    # M7 an exact cross-source name merges automatically
    'M7_auto_merge_exact_name': (A3, [(EDGE_TAIL, auto_edge('EXACT_NAME'), 1)]),
    # M8 operators of every source blended into one field
    'M8_blend_operators': (MAP, [(
        "           nullif(btrim(o.source_native_operator), '') as developer_or_operator,",
        "           (select string_agg(distinct x3.source_native_operator, ' / ')\n"
        "              from public.dc_entity_observation eo3\n"
        "              join public.dc_source_observation x3 using (home_signal_observation_id)\n"
        "             where eo3.canonical_entity_id = e.canonical_entity_id) as developer_or_operator,", 1)]),
    # M10 unresolved geography published
    'M10_publish_unresolved': (MAP, [(
        "       and ge.geography_status = 'RESOLVED'\n       and ge.geometry_type = 'POINT'),", "),", 1)]),
    # M11 the identity-review gate removed
    'M11_no_identity_gate': (B3, [(
        "                when b.basis = 'DERIVED_ADDRESS' and b.identity_open then 'GEOGRAPHY_UNRESOLVED'\n", "", 1)]),
    # M12 an area centroid used as the fallback point when the match was not a site
    'M12_centroid_fallback': (B3, [(
        "     where dp.verdict = 'ACCEPTED';",
        "     where dp.verdict = 'ACCEPTED' or dp.match_type in ('zip_centroid', 'county_centroid');", 1)]),
    # M14 a derived point outranks the publisher's own site point
    'M14_derived_overrides_site': (B3, [(
        "(basis = 'NON_SITE_AREA'), (basis = 'DERIVED_ADDRESS'),",
        "(basis = 'NON_SITE_AREA'), (basis <> 'DERIVED_ADDRESS'),", 1)]),
    # M14b a derived point excused from the disagreement check
    'M14b_derived_excluded_from_disagreement': (B3, [(
        AREA_ONLY_SITE,
        AREA_ONLY_SITE + " and a.basis <> 'DERIVED_ADDRESS' and b.basis <> 'DERIVED_ADDRESS'", 1)]),
    # M15 the wrong-sibling guard removed
    'M15_no_sibling_guard': (A3, [(
        "    having count(distinct split_part(c.record_key, '|', 1) || '|' || split_part(c.record_key, '|', 2))\n"
        "           < count(*);", "    having false;", 1)]),
    # M16 the uncertainty disk ignored
    'M16_no_uncertainty_disk': (MAP, [(
        "           case when p.positional_uncertainty_m is null then", "           case when true then", 1)]),
    # M17 a repeated name treated as a record key
    'M17_record_key_not_unique': (A3, [(RECORD_KEY_UNIQUE, "             and true", 2)]),
    # M18 a town-centroid point allowed to disagree with a site point
    'M18_area_points_disagree': (B3, [(AREA_ONLY_SITE, "and true", 1)]),
    # M19 the descriptor taken from the location authority even when it states no lifecycle
    'M19_descriptor_from_authority': (MAP, [(
        "          join lifecycle lx on lx.v = x.source_native_status\n", "", 1)]),
    # a derivation for an address the database never queued is loaded
    'load_accepts_unqueued': (LOAD, [(
        "   and j->>'geocoder_query' in (select geocoder_query from public.dc_geocode_queue)\n", "", 1)]),
    # an ambiguous provider answer accepted
    'accept_ambiguous': (D3, [("    elsif p_provider_candidates is distinct from 1 then",
                               "    elsif p_provider_candidates < 1 then", 1)]),
    # a divergent house number accepted
    'accept_house_divergence': (D3, [("    elsif q_no is null or m_no is null or q_no <> m_no then",
                                      "    elsif false then", 1)]),
    # a shared address places both records
    'shared_address_places': (B3, [(
        "                when b.basis = 'DERIVED_ADDRESS' and b.shared then 'GEOGRAPHY_UNRESOLVED'\n", "", 1)]),
    # a house-number range treated as a site address
    'range_is_geocodable': (D3, [("        elsif a ~ '^\\d+[A-Za-z]?\\s*[-–]\\s*\\d+' then", "        elsif false then", 1)]),
}


def main():
    if sys.argv[1:] == ['--list']:
        for name, (path, _) in MUTATIONS.items():
            print(name, path)
        return 0
    name, path = sys.argv[1], sys.argv[2]
    want, edits = MUTATIONS[name]
    if not path.endswith(want):
        sys.stderr.write('%s: targets %s, not %s\n' % (name, want, path))
        return 2
    text = open(path, encoding='utf-8').read()
    for find, repl, count in edits:
        n = text.count(find)
        if n != count:
            sys.stderr.write('%s: anchor %r appears %d time(s), expected %d\n' % (name, find[:80], n, count))
            return 2
        text = text.replace(find, repl)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
