#!/usr/bin/env python3
"""Prohibited mutations of the AUTOMATIC Epoch canonical-geography path. Each MUST fail the suite.

Usage: mutate.py --list                 -> "NAME FILE" per line (FILE is repo-relative)
       mutate.py NAME ABSOLUTE_FILE     -> the mutated file on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply (a mutation that does not apply is indistinguishable from one that survives).

M14 (an Epoch-specific Map 1 reader) and M16 (a facility-specific production exception) are
structural and live in test/dc-epoch-geography-structure.test.mjs.
"""
import sys

D3 = 'docs/dc-step3d-derived-location.sql'
A3 = 'docs/dc-step3a-canonical-identity.sql'
B3 = 'docs/dc-step3b-canonical-geography.sql'
MAP = 'docs/map1-dc-publication.sql'
PICK_CLASS = "              (evidence_class in ('PUBLISHER_NON_SITE', 'PUBLISHER_UNUSABLE')),\n"
CONFLICT_CLASSES = "    select p_class_a in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')\n       and p_class_b in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')\n"
DISAGREE_END = "b.evidence_class, b.uncertainty_m, b.lat, b.lng)) disagree,"
LOAD = 'docs/dc-geocode-observations-load.sql'

# the end of the automatic edge set in dc_resolve_canonical: weak-evidence mutations add edges here
EDGE_END = "       and d.rank_a < 2 and d.rank_b < 2;\n    select count(*) into v_edges from _res_edge;"


def extra_edges(sql):
    return [(EDGE_END,
             "       and d.rank_a < 2 and d.rank_b < 2\n    union\n" + sql
             + ";\n    select count(*) into v_edges from _res_edge;", 1)]


# cross-source pairs of CURRENT records, as record keys (atlas side a, epoch side b)
PAIRS = """    select ra.record_key, rb.record_key
      from public.dc_current_observation ca
      join public.dc_source_observation oa on oa.home_signal_observation_id = ca.home_signal_observation_id
      join public.dc_observation_record_key ra on ra.home_signal_observation_id = ca.home_signal_observation_id
      join public.dc_current_observation cb on cb.source_key > ca.source_key
      join public.dc_source_observation ob on ob.home_signal_observation_id = cb.home_signal_observation_id
      join public.dc_observation_record_key rb on rb.home_signal_observation_id = cb.home_signal_observation_id
     where ra.record_key_rank < 2 and rb.record_key_rank < 2 and """

UNKNOWN_TYPE = """    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated') then
        return query select 'REJECTED_UNKNOWN_MATCH_TYPE'::text, null::double precision, 'unknown precision is not a site'::text;
"""
ACCEPT_LIST = "    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated') then"
AREA_LIST = "    elsif p_match_type in ('zip_centroid', 'county_centroid') then"
RECORD_KEY_UNIQUE = """             and count(*) over (partition by o.source_key, o.acquisition_run_id, o.distribution_key,
                                             btrim(o.source_native_name)) = 1"""

MUTATIONS = {
    # ── the founder's M1-M16 ────────────────────────────────────────────────────────────────
    # M1 a cross-source merge requires a human review row (none exists: nothing merges)
    'M1_merge_requires_human_review': (A3, [(EDGE_END,
        "       and d.rank_a < 2 and d.rank_b < 2\n       and d.decision_rule_key like 'REVIEWED%';\n"
        "    select count(*) into v_edges from _res_edge;", 1)]),
    # M2 the nearest Atlas facility automatically wins
    'M2_nearest_atlas_wins': (A3, extra_edges(
        "    select x.record_key_a, x.record_key_b from (\n"
        "      select d.*, rank() over (partition by d.evidence->'candidate_evidence'->>'derived_observation'\n"
        "                               order by (d.evidence->'candidate_evidence'->>'distance_m')::numeric) r\n"
        "        from _res_decision d where d.candidate_rule_key = 'DERIVED_POINT_NEAR_OTHER_SOURCE_DC') x\n"
        "     where x.r = 1 and x.rank_a < 2 and x.rank_b < 2")),
    # M3 everything within 10 km merges
    'M3_within_10km_merges': (A3, extra_edges(
        "    select d.record_key_a, d.record_key_b from _res_decision d\n"
        "     where d.candidate_rule_key = 'DERIVED_POINT_NEAR_OTHER_SOURCE_DC' and d.rank_a < 2 and d.rank_b < 2")),
    # M4 the same ZIP merges
    'M4_same_zip_merges': (A3, extra_edges(PAIRS
        + "nullif(left(oa.source_native_address->>'postalCode', 5), '') = substring(cb.raw_payload->>'Address' from ',\\s*[A-Z]{2}\\s+(\\d{5})')")),
    # M5 the same city merges
    'M5_same_city_merges': (A3, extra_edges(PAIRS
        + "upper(btrim(oa.source_native_address->>'city')) = upper(btrim(split_part(cb.raw_payload->>'Address', ',', 2)))")),
    # M6 the same operator merges
    'M6_same_operator_merges': (A3, extra_edges(PAIRS
        + "lower(btrim(oa.source_native_operator)) = lower(btrim(ob.source_native_operator))")),
    # M7 a similar (here: identical) facility name alone merges
    'M7_same_name_merges': (A3, extra_edges(
        "    select d.record_key_a, d.record_key_b from _res_decision d\n"
        "     where d.candidate_rule_key = 'EXACT_NAME' and d.rank_a < 2 and d.rank_b < 2")),
    # M8 numbered sibling facilities merge (the designation guard is gone)
    'M8_numbered_siblings_merge': (A3, [(
        "        elsif cardinality(da) > 0 and cardinality(db) > 0 and not (da && db) then",
        "        elsif false then", 1)]),
    # M9 the provider's ZIP decides the canonical ZIP (its centroid replaces the derived point)
    'M9_provider_zip_decides': (B3, [(
        "       null::text, dp.lat, dp.lng, 6, o.observed_at,",
        "       null::text,\n"
        "       coalesce((select ST_Y(ST_Centroid(z.geom)) from geo.zcta_boundary z where z.zcta5 = right(dp.matched_address, 5)), dp.lat),\n"
        "       coalesce((select ST_X(ST_Centroid(z.geom)) from geo.zcta_boundary z where z.zcta5 = right(dp.matched_address, 5)), dp.lng),\n"
        "       6, o.observed_at,", 1)]),
    # M10 Epoch lifecycle is fabricated (silence becomes Operating)
    'M10_lifecycle_fabricated': (MAP, [(
        "coalesce(lc.map_status, 'Unknown') as map_status", "coalesce(lc.map_status, 'Operating') as map_status", 1)]),
    # M10b a stated cancelled is outvoted by another source's silence
    'M10b_cancelled_outvoted_by_silence': (MAP, [(
        "                    and c3.source_native_status is not null))),",
        "                    and false))),", 1)]),
    # M11 the location-authority observation must also provide the lifecycle
    'M11_lifecycle_from_location_authority_only': (MAP, [(
        "         where eo2.canonical_entity_id = e.canonical_entity_id\n",
        "         where eo2.canonical_entity_id = e.canonical_entity_id\n"
        "           and x.home_signal_observation_id = ge.authority_observation_id\n", 1)]),
    # M12 a new Epoch acquisition mints another entity (no stable record key)
    'M12_run_churn_new_entity': (A3, [(RECORD_KEY_UNIQUE, "             and false", 2)]),
    # M13 an unresolved record is never reconsidered once it has an entity
    'M13_unresolved_never_reconsidered': (A3, [(EDGE_END,
        "       and d.rank_a < 2 and d.rank_b < 2\n"
        "       and not exists (select 1 from public.dc_entity_observation eo\n"
        "                         join public.dc_observation_record_key r on r.home_signal_observation_id = eo.home_signal_observation_id\n"
        "                        where r.record_key in (d.record_key_a, d.record_key_b) and r.record_key_rank = 1);\n"
        "    select count(*) into v_edges from _res_edge;", 1)]),
    # M15 radius membership: the uncertainty disk is ignored
    'M15_radius_membership_no_disk': (MAP, [(
        "           case when p.positional_uncertainty_m is null then", "           case when true then", 1)]),

    # ── the guards the automatic rule depends on ─────────────────────────────────────────────
    'G_address_shared_within_source': (A3, [(
        "        elsif sa.same_address_in_source > 1 or sb.same_address_in_source > 1 then",
        "        elsif false then", 1)]),
    'G_address_not_both_data_centres': (A3, [(
        "        elsif coalesce(ca, '') not in ('CONFIRMED_DC', 'DC_CANDIDATE') or coalesce(cb, '') not in ('CONFIRMED_DC', 'DC_CANDIDATE') then",
        "        elsif false then", 1)]),
    'G_postal_conflict_ignored': (A3, [(
        "        elsif sa.postal is not null and sb.postal is not null and sa.postal <> sb.postal then",
        "        elsif false then", 1)]),
    'G_no_exclusivity': (A3, [(
        "           and r1.record_key <> r2.record_key);", "           and false);", 1)]),
    'G_identity_gate_removed': (B3, [(
        "                when b.basis = 'DERIVED_ADDRESS' and b.identity_open then 'GEOGRAPHY_UNRESOLVED'\n", "", 1)]),
    'G_unstable_identity_placed': (B3, [(
        "                when b.basis = 'DERIVED_ADDRESS' and b.unstable then 'GEOGRAPHY_UNRESOLVED'\n", "", 1)]),
    'G_uncited_publishes': (MAP, [("       and o.cite is not null\n", "", 1)]),
    # (re-anchored for rule_version 4: the class order, second key)
    'G_derived_overrides_site': (B3, [(
        "              (evidence_class = 'DERIVED_ADDRESS'),\n              -- inside one class only",
        "              (evidence_class <> 'DERIVED_ADDRESS'),\n              -- inside one class only", 1)]),
    # (re-anchored for rule_version 4: the one contradiction definition)
    'G_derived_excluded_from_disagreement': (B3, [(CONFLICT_CLASSES,
        "    select p_class_a = 'PUBLISHER_SITE'\n       and p_class_b = 'PUBLISHER_SITE'\n", 1)]),
    'G_area_points_disagree': (B3, [(CONFLICT_CLASSES, "    select true\n", 1)]),
    'G_shared_address_places': (B3, [(
        "                when b.basis = 'DERIVED_ADDRESS' and b.shared then 'GEOGRAPHY_UNRESOLVED'\n", "", 1)]),
    # ── CANONICAL GEOGRAPHY AUTHORITY (rule_version 4): each MUST fail a check ──
    # G2 a publisher point always outranks a derived one, whatever the publisher says it is
    'G2_publisher_always_wins': (B3, [(PICK_CLASS, "              (evidence_class = 'DERIVED_ADDRESS'),\n" + PICK_CLASS, 1)]),
    # G4 a derived geocode always outranks the publisher's site point
    'G4_derived_always_wins': (B3, [(PICK_CLASS, "              (evidence_class <> 'DERIVED_ADDRESS'),\n" + PICK_CLASS, 1)]),
    # G6 a derived point is held to the 1 km peer tolerance, ignoring its calibrated error: any
    # disagreement with it withholds the publisher's site point
    'G6_any_derived_disagreement_withholds': (B3, [("else coalesce(p_uncertainty_a, 0) + coalesce(p_uncertainty_b, 0) end", "else 1000 end", 1)]),
    # G8 two claims inside one ZCTA agree, however far apart
    'G8_same_zip_means_agree': (B3, [(DISAGREE_END, "b.evidence_class, b.uncertainty_m, b.lat, b.lng)\n"
        "                          and not exists (select 1 from geo.zcta_boundary z where ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(a.lng, a.lat), 4269))"
        " and ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4269)))) disagree,", 1)]),
    # G8b ... and two claims in different ZCTAs disagree, however close
    'G8b_different_zip_means_disagree': (B3, [(DISAGREE_END, "b.evidence_class, b.uncertainty_m, b.lat, b.lng)\n"
        "                          or (a.canonical_entity_id = e.canonical_entity_id and a.evidence_class in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')"
        " and b.evidence_class in ('PUBLISHER_SITE', 'DERIVED_ADDRESS') and not exists (select 1 from geo.zcta_boundary z"
        " where ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(a.lng, a.lat), 4269)) and ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4269))))) disagree,", 1)]),
    # G9 the geocoder's own ZIP settles a contradiction when it names the publisher point's polygon
    'G9_provider_zip_breaks_tie': (B3, [(DISAGREE_END, "b.evidence_class, b.uncertainty_m, b.lat, b.lng)\n"
        "                          and not exists (select 1 from geo.zcta_boundary z where z.zcta5 = right(coalesce(a.basis_evidence->>'matched_address', b.basis_evidence->>'matched_address'), 5)"
        " and (ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(a.lng, a.lat), 4269)) or ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4269))))) disagree,", 1)]),
    # G10 a contradiction is settled by the centroid (mean) of the claims, which is then published
    'G10_centroid_breaks_tie': (B3, [
        ("p.prec, p.lat,\n               p.lng,",
         "p.prec, (select avg(x.lat) from _geo_pts x where x.canonical_entity_id = e.canonical_entity_id and x.evidence_class in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')) lat,\n"
         "               (select avg(x.lng) from _geo_pts x where x.canonical_entity_id = e.canonical_entity_id and x.evidence_class in ('PUBLISHER_SITE', 'DERIVED_ADDRESS')) lng,", 1),
        ("when b.oid is null or b.disagree or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'", "when b.oid is null or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'", 1),
        ("                when b.disagree then 'SOURCES_DISAGREE'\n", "", 1)]),
    # G11 a contradiction is settled by publishing the authority point and letting its (nearest) ZIP decide
    'G11_nearest_zip_breaks_tie': (B3, [
        ("when b.oid is null or b.disagree or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'", "when b.oid is null or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'", 1),
        ("                when b.disagree then 'SOURCES_DISAGREE'\n", "", 1)]),
    # G12 the smaller uncertainty number wins, whatever kind of evidence carries it (a publisher
    # point carries none, so it would always win -- even the publisher's own town centroid)
    'G12_lower_uncertainty_wins': (B3, [(PICK_CLASS, "              coalesce(uncertainty_m, 0),\n" + PICK_CLASS, 1)]),
    'G_centroid_fallback': (B3, [(
        " where dp.verdict = 'ACCEPTED'\n   and dp.admitted;",
        " where (dp.verdict = 'ACCEPTED' or dp.match_type in ('zip_centroid', 'county_centroid'))\n   and dp.admitted;", 1)]),
    'G_accept_zip_centroid': (D3, [
        (AREA_LIST, "    elsif p_match_type in ('county_centroid') then", 1),
        (ACCEPT_LIST, "    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated', 'zip_centroid') then", 1)]),
    'G_accept_county_centroid': (D3, [
        (AREA_LIST, "    elsif p_match_type in ('zip_centroid') then", 1),
        (ACCEPT_LIST, "    elsif p_match_type not in ('rooftop', 'parcel_centroid', 'range_interpolated', 'county_centroid') then", 1)]),
    'G_accept_unknown_type': (D3, [(UNKNOWN_TYPE, "", 1)]),
    'G_accept_ambiguous': (D3, [("    elsif p_provider_candidates is distinct from 1 then",
                                 "    elsif p_provider_candidates < 1 then", 1)]),
    'G_accept_house_divergence': (D3, [("    elsif q_no is null or m_no is null or q_no <> m_no then",
                                        "    elsif false then", 1)]),
    'G_range_is_geocodable': (D3, [("    elsif a ~ '^\\d+[A-Za-z]?\\s*[-–]\\s*\\d+' then", "    elsif false then", 1)]),
    'G_write_source_coordinates': (LOAD, [(
        "on conflict (geocoder_query, ladder_version) do nothing;\n",
        "on conflict (geocoder_query, ladder_version) do nothing;\n"
        "update public.dc_source_observation o set source_native_lat = d.lat, source_native_lon = d.lng\n"
        "  from public.dc_observation_derived_point d\n"
        " where d.home_signal_observation_id = o.home_signal_observation_id and d.verdict = 'ACCEPTED';\n", 1)]),
    'G_load_accepts_unqueued': (LOAD, [(
        "   and j->>'geocoder_query' in (select geocoder_query from public.dc_geocode_queue)\n", "", 1)]),
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
