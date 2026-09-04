-- ============================================================================
-- N5 LEGACY ROW POPULATION — a miniature of the REAL production corpus
-- ----------------------------------------------------------------------------
-- Applied AFTER fixture_pre_state.sql and BEFORE the migration, so the migration is exercised
-- against a coherent legacy state rather than an empty one. Kept separate from the DDL so
-- migration-only tests can opt out.
--
-- It reproduces, at 5-project scale, exactly the invariants production satisfies (receipts in
-- docs/n5-applied-state-of-record.md §5) - so the fail-closed gate must PASS here:
--   canonical proven set == expected ELIGIBLE set, both directions
--   coordinates equal the authoritative pair · all pt:1 · all ST_Point · one geom per key
--   reject partition closes the authoritative PROVEN population, reasons agree
--   every reject carries detail = {"snapshot": …, "distinct_coords": N}
--
-- Scale is the ONLY difference from production. 3 eligible + 2 ineligible instead of
-- 718,278 + 5,171; the set relationships are identical.

insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs) values
  ('r-proven', 'PROVEN',   5, 5),
  ('r-rec',    'RECOVERY', 1, 1)
on conflict (registry_id) do nothing;

insert into geo.n5_snapshot (snapshot_id, sources, projects, pairs, n_rows) values
  ('phase1-2026-09-01', 2, 6, 6, 6)
on conflict (snapshot_id) do nothing;

-- The authoritative frozen identity baseline.
insert into preservation.app_project_identity
  (snapshot_id, source_key, zip, registry_id, lat, lng, source_seq, record_kind) values
  -- three globally single-coordinate PROVEN projects -> ELIGIBLE
  ('phase1-2026-09-01','L-elig-1','02138','r-proven', 42.0, -71.0, 1,'development'),
  ('phase1-2026-09-01','L-elig-2','02139','r-proven', 43.0, -72.0, 1,'development'),
  ('phase1-2026-09-01','L-elig-3','02140','r-proven', 44.0, -73.0, 1,'development'),
  -- the same project on a second page ZIP with the SAME coordinate: still ONE eligible project
  ('phase1-2026-09-01','L-elig-3','02141','r-proven', 44.0, -73.0, 2,'development'),
  -- globally multi-coordinate -> MULTI_COORD_UNRESOLVED (distinct_coords 2)
  ('phase1-2026-09-01','L-multi', '02142','r-proven', 45.0, -74.0, 1,'development'),
  ('phase1-2026-09-01','L-multi', '02142','r-proven', 46.0, -75.0, 2,'development'),
  -- no coordinate at all -> NULL_COORD (distinct_coords 0)
  ('phase1-2026-09-01','L-null',  '02143','r-proven', null, null, 1,'development'),
  -- RECOVERY treatment: never in the PROVEN verdict population at all
  ('phase1-2026-09-01','L-rec',   '02144','r-rec',    47.0, -76.0, 1,'development');

-- LEGACY CANONICAL POINTS, as the ad-hoc materialisation left them: feature_id 'pt:1',
-- ST_Point, SRID 4269, first_z3 NULL, invalid_reason NULL, outcome 1, real registry_id,
-- and NO verdict_snapshot_id column to populate.
insert into geo.n5_geom
  (source_key, registry_id, feature_id, outcome, geom, invalid_reason, first_z3, provenance)
values
  ('L-elig-1','r-proven','pt:1',1,ST_SetSRID(ST_MakePoint(-71.0,42.0),4269),null,null,'proven_stored_point'),
  ('L-elig-2','r-proven','pt:1',1,ST_SetSRID(ST_MakePoint(-72.0,43.0),4269),null,null,'proven_stored_point'),
  ('L-elig-3','r-proven','pt:1',1,ST_SetSRID(ST_MakePoint(-73.0,44.0),4269),null,null,'proven_stored_point'),
  -- recovered publisher geometry, untouched by #1016 and required to stay NULL-attributed
  ('L-rec','r-rec','oid-77',1,ST_SetSRID(ST_MakePoint(-76.0,47.0),4269),null,'021','recovered_authoritative');

-- LEGACY REJECTS, in the old shape, carrying the only durable snapshot provenance.
insert into geo.n5_point_reject (source_key, registry_id, reason, detail, rejected_at) values
  ('L-multi','r-proven','MULTI_COORD_UNRESOLVED',
     '{"snapshot":"phase1-2026-09-01","distinct_coords":2}'::jsonb, '2026-09-02 23:50:51.752805+00'),
  ('L-null', 'r-proven','NULL_COORD',
     '{"snapshot":"phase1-2026-09-01","distinct_coords":0}'::jsonb, '2026-09-02 23:50:51.752805+00');
