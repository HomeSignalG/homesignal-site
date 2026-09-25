#!/usr/bin/env python3
"""Prohibited mutations of ATLAS COORDINATE VALIDATION. Each MUST fail the suite.

Usage: mutate.py --list                 -> "NAME FILE" per line (FILE is repo-relative)
       mutate.py NAME ABSOLUTE_FILE     -> the mutated file on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail
to apply (a mutation that does not apply is indistinguishable from one that survives).

X01-X18 are the eighteen breaks the Atlas validation brief names, in its order; X00 is the
deployment gate (acquisition must be inert until an extraction is admitted). X17 (a second
geocoder) also has a structural pin in test/dc-atlas-validation-structure.test.mjs.
"""
import sys

D3 = 'docs/dc-step3d-derived-location.sql'
A3 = 'docs/dc-step3a-canonical-identity.sql'
B3 = 'docs/dc-step3b-canonical-geography.sql'
MAP = 'docs/map1-dc-publication.sql'
LOAD = 'docs/dc-geocode-observations-load.sql'

DISAGREE_END = "b.evidence_class, b.uncertainty_m, b.lat, b.lng)) disagree,"
PAIRING = "and (a.source_key, a.evidence_class, a.oid) < (b.source_key, b.evidence_class, b.oid)"
PICK_DERIVED = "              (evidence_class = 'DERIVED_ADDRESS'),\n"
STATUS_DISAGREE = "                when b.oid is null or b.disagree or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'\n"
STATUS_SHARED = "                when b.basis = 'DERIVED_ADDRESS' and b.shared then 'GEOGRAPHY_UNRESOLVED'\n"
DERIVED_UNC = "       dp.positional_uncertainty_m,\n       'DERIVED_ADDRESS'::text"
PUB_RANGE = "   and o.source_native_lat between -90 and 90 and o.source_native_lon between -180 and 180\n"
VERDICT = "    select p.*, geo.zip_point_membership_in(bb.geom, p.lat, p.lng) as verdict,"
PT = "ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4269)"
EDGE_END = "       and d.rank_a < 2 and d.rank_b < 2;\n    select count(*) into v_edges from _res_edge;"
LOAD_HEAD = "insert into public.dc_address_geocode\n    (geocoder_query,"
LOAD_END = "on conflict (geocoder_query, ladder_version) do nothing;\n"


def disagree_unless(cond):
    return [(DISAGREE_END,
             "b.evidence_class, b.uncertainty_m, b.lat, b.lng)\n                          and not (" + cond + ")) disagree,", 1)]


def pt(side):
    return f"ST_SetSRID(ST_MakePoint({side}.lng, {side}.lat), 4269)"


MUTATIONS = {
    # X00 the deployment gate is bypassed: Atlas acquisition changes decisions before review
    'X00_admission_bypassed': (D3, [(
        "as $$ select (p_source_key, p_distribution_key) in (('epoch_ai', 'data_centers')) $$;",
        "as $$ select (p_source_key, p_distribution_key) in (('epoch_ai', 'data_centers'), ('compute_atlas', 'facilities')) $$;", 1)]),
    # X01 an Atlas publisher point always wins: its own address can never contradict it
    'X01_atlas_point_always_wins': (B3, disagree_unless("'compute_atlas' in (a.source_key, b.source_key)")),
    # X02 a derived geocode always wins over a publisher site point
    'X02_derived_always_wins': (B3, [(PICK_DERIVED, "              (evidence_class <> 'DERIVED_ADDRESS'),\n", 1)]),
    # X03 the same ZIP means corroborated
    'X03_same_zip_corroborates': (B3, disagree_unless(
        "exists (select 1 from geo.zcta_boundary z where ST_Covers(z.geom, " + pt('a') + ") and ST_Covers(z.geom, " + pt('b') + "))")),
    # X04 the provider's ZIP settles a conflict (the geocoder's postal ZIP names the point's polygon)
    'X04_provider_zip_decides': (B3, disagree_unless(
        "exists (select 1 from geo.zcta_boundary z where right(coalesce(a.basis_evidence->>'matched_address', "
        "b.basis_evidence->>'matched_address', ''), 5) = z.zcta5 and (ST_Covers(z.geom, " + pt('a') + ") or ST_Covers(z.geom, " + pt('b') + ")))")),
    # X05 a ZIP chooses between conflicting coordinates (a conflicting point that lies in a ZCTA publishes)
    'X05_zip_chooses_between_conflicts': (B3, [(STATUS_DISAGREE,
        "                when b.oid is null or (b.disagree and not exists (select 1 from geo.zcta_boundary z\n"
        "                     where ST_Covers(z.geom, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4269)))) or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'\n", 1)]),
    # X06 source name determines which claims are compared (rule_version 4's source pairing restored)
    'X06_source_pairing_restored': (B3, [(PAIRING, "and a.source_key < b.source_key", 2)]),
    # X07 Atlas gets a special geography rule (a looser allowance for its own address)
    'X07_atlas_special_rule': (B3, [(DERIVED_UNC,
        "       dp.positional_uncertainty_m * case when dp.source_key = 'compute_atlas' then 10 else 1 end,\n"
        "       'DERIVED_ADDRESS'::text", 1)]),
    # X08 a failed / rejected geocode removes the valid publisher point
    'X08_geocoder_failure_removes_point': (B3, [(PUB_RANGE, PUB_RANGE +
        "   and not exists (select 1 from public.dc_observation_derived_point r\n"
        "                    where r.home_signal_observation_id = o.home_signal_observation_id and r.verdict like 'REJECTED%')\n", 1)]),
    # X09 multiple provider candidates: one is taken anyway
    'X09_ambiguous_candidate_selected': (D3, [(
        "    elsif p_provider_candidates is distinct from 1 then", "    elsif p_provider_candidates < 1 then", 1)]),
    # X10 a vague address (no house number) is treated as a precise site address
    'X10_vague_address_is_site': (D3, [(
        "    elsif a !~ '^\\d' or a ~ '^\\d{5}(-\\d{4})?$' then", "    elsif a ~ '^\\d{5}(-\\d{4})?$' then", 1)]),
    # X11 a derived point changes identity (records whose admitted derived points lie within 5 km merge;
    #     a publisher separates its own records, so the pair that can bite is cross-source)
    'X11_derived_point_merges_identity': (A3, [(EDGE_END,
        "       and d.rank_a < 2 and d.rank_b < 2\n    union\n"
        "    select ra.record_key, rb.record_key\n"
        "      from public.dc_observation_derived_point da\n"
        "      join public.dc_observation_derived_point db\n"
        "        on da.home_signal_observation_id < db.home_signal_observation_id\n"
        "       and da.admitted and db.admitted and da.verdict = 'ACCEPTED' and db.verdict = 'ACCEPTED'\n"
        "       and ST_DistanceSphere(ST_MakePoint(da.lng, da.lat), ST_MakePoint(db.lng, db.lat)) <= 5000\n"
        "      join public.dc_observation_record_key ra on ra.home_signal_observation_id = da.home_signal_observation_id\n"
        "      join public.dc_observation_record_key rb on rb.home_signal_observation_id = db.home_signal_observation_id;\n"
        "    select count(*) into v_edges from _res_edge;", 1)]),
    # X12 a derived point shared by two records places both: a duplicate facility on one address
    'X12_shared_derived_point_places_both': (B3, [(STATUS_SHARED, "", 1)]),
    # X13 centroid membership returns (a point is a member of a ZIP whose centroid is within 25 km)
    'X13_centroid_membership': (MAP, [(VERDICT,
        "    select p.*, case when ST_DWithin(ST_Centroid(bb.geom)::geography, " + PT + "::geography, 25000)\n"
        "                     then 'member' else 'not_member' end as verdict,", 1)]),
    # X14 radius membership returns (within 5 km of the ZIP)
    'X14_radius_membership': (MAP, [(VERDICT,
        "    select p.*, case when ST_DWithin(bb.geom::geography, " + PT + "::geography, 5000)\n"
        "                     then 'member' else 'not_member' end as verdict,", 1)]),
    # X15 nearest-ZIP membership returns
    'X15_nearest_zip_membership': (MAP, [(VERDICT,
        "    select p.*, case when p_zip = (select z.zcta5 from geo.zcta_boundary z\n"
        "                                    order by ST_Distance(z.geom, " + PT + "), z.zcta5 limit 1)\n"
        "                     then 'member' else 'not_member' end as verdict,", 1)]),
    # X16 a derived point beyond its uncertainty silently moves the facility to itself
    'X16_conflict_moves_to_derived': (B3, [
        (STATUS_DISAGREE, "                when b.oid is null or b.decimals <= 1 then 'GEOGRAPHY_UNRESOLVED'\n", 1),
        (PICK_DERIVED, "              (evidence_class <> 'DERIVED_ADDRESS'),\n", 1)]),
    # X17 a second (Atlas) geocoder: "derivations" fabricated from the publisher's own point
    'X17_second_geocoder': (LOAD, [(LOAD_HEAD,
        "insert into public.dc_address_geocode (geocoder_query, canonical_addr, ladder_version, provider,\n"
        "       match_type, lat, lng, matched_address, provider_candidates, run_ref)\n"
        "select distinct on (q.geocoder_query) q.geocoder_query, upper(q.geocoder_query), q.ladder_version,\n"
        "       'atlas_geocoder', 'rooftop', o.source_native_lat, o.source_native_lon, upper(q.geocoder_query), 1, 'x17'\n"
        "  from public.dc_geocode_queue q\n"
        "  join public.dc_observation_derived_point p on p.geocoder_query = q.geocoder_query\n"
        "  join public.dc_source_observation o on o.home_signal_observation_id = p.home_signal_observation_id\n"
        " where o.source_native_lat is not null\n"
        "on conflict do nothing;\n" + LOAD_HEAD, 1)]),
    # X18 existing publisher evidence is overwritten by derived evidence
    'X18_publisher_evidence_overwritten': (LOAD, [(LOAD_END, LOAD_END +
        "update public.dc_source_observation o set source_native_lat = d.lat, source_native_lon = d.lng\n"
        "  from public.dc_observation_derived_point d\n"
        " where d.home_signal_observation_id = o.home_signal_observation_id and d.verdict = 'ACCEPTED';\n", 1)]),
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
