-- Map 1 may draw permits located by geocoding a street address ⚖️ FOUNDER RULING (2026-10-20)
--
-- WHAT. The seven registry sources whose records are located only by geocoding their own
-- street address were frozen as treatment NOAUTH in geo.n5_accepted_source, so the daily N5
-- generation withheld every one of their records from Map 1 (reason REGISTRY_NOAUTH). The
-- founder ruled that Map 1 may draw them. They move to PROVEN, which serves the record's
-- stored point (geo.n5_gen_prepare_publish, part D, D6).
--
-- WHY THE FENCE STILL HOLDS. The stored point of these records is the geocode result that
-- already passed sources/geo-fence.ts (matched ZIP equals the record's filed ZIP and within
-- 25 mi of the report ZIP's centre); a fence failure nulls the point and N5 rejects the key
-- as POINT_REJECTED. Measured 2026-10-20: every stored row of the six present sources carries
-- provenance geo_precision = 'address' and a coordinate (Boulder 1,215 · Virginia Beach 16,891
-- · Worcester 8,290 · Hartford 3,741 · Naperville 1,087 · Anaheim 955; Prince George's has no
-- stored row today).
--
-- NOT CHANGED: the '(null)' row (registry-less keys, tdlr_tabs). part D's D6 joins on the raw
-- registry_id while the shard files those keys under '(null)', so a PROVEN '(null)' would get
-- no proven point and no unresolved class, and READY would refuse.
--
-- KNOWN LABEL: the radius RPC names these points 'proven_stored_point', which N2 defined as a
-- publisher's own coordinate. An honest separate label is a follow-up, not done here.
--
-- TAKES EFFECT with the next generation that opens (n5-generation.yml, at most one per 20 h);
-- the ACTIVE generation is unchanged. Apply only while no generation is BUILDING.
--
-- The set is computed in the database (claims rule 7) and fingerprinted (rules 8/9).

do $$
declare
  v_n  int;
  v_fp text;
  v_building int;
begin
  select count(*) into v_building from geo.n5_generation where state = 'BUILDING';
  if v_building > 0 then
    raise exception 'a generation is BUILDING; apply after it finishes';
  end if;

  select count(*), md5(string_agg(registry_id, ',' order by registry_id collate "C"))
    into v_n, v_fp
    from geo.n5_accepted_source
   where treatment = 'NOAUTH' and registry_id <> '(null)';
  if v_n = 0 then
    raise notice 'already applied: no NOAUTH registry left besides (null)';
    return;
  end if;
  if v_n <> 7 or v_fp <> '158f6256a68bef5de3ee313b85e6d290' then
    raise exception 'NOAUTH set moved: n=% fp=% (expected 7 / 158f6256a68bef5de3ee313b85e6d290)', v_n, v_fp;
  end if;

  update geo.n5_accepted_source
     set treatment = 'PROVEN'
   where treatment = 'NOAUTH' and registry_id <> '(null)';
  get diagnostics v_n = row_count;
  if v_n <> 7 then
    raise exception 'updated % rows, expected 7', v_n;
  end if;

  select count(*), md5(string_agg(registry_id, ',' order by registry_id collate "C"))
    into v_n, v_fp
    from geo.n5_accepted_source
   where treatment = 'PROVEN'
     and registry_id in ('anaheim-land-use-cases','boulder-construction-permits',
                         'hartford-building-permits','naperville-building-permits',
                         'prince-georges-county-permits','virginia-beach-building-permits',
                         'worcester-building-permits');
  if v_n <> 7 or v_fp <> '158f6256a68bef5de3ee313b85e6d290' then
    raise exception 'post-check failed: n=% fp=%', v_n, v_fp;
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING; the next generation then withholds them again):
--   update geo.n5_accepted_source set treatment = 'NOAUTH'
--    where registry_id in ('anaheim-land-use-cases','boulder-construction-permits',
--                          'hartford-building-permits','naperville-building-permits',
--                          'prince-georges-county-permits','virginia-beach-building-permits',
--                          'worcester-building-permits');
