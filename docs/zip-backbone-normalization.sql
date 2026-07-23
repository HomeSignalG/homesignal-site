-- ============================================================================
-- ZIP BACKBONE NORMALIZATION — the 18 Utah pilot ZIPs that resolved through a
-- level='city' community row get their own level='zip' row, so EVERY user-facing
-- ZIP resolves through exactly one level='zip' community (required invariant,
-- founder-confirmed 2026-07-23). City rows are PRESERVED as parents/aggregation
-- nodes (their council topics + Eagle Mountain's directly-tagged content stay
-- put); nothing is deleted, re-pointed, or re-tagged.
--
-- ZIPs: 84302 84337 (Box Elder pilot) · 84003 84004 84005 84013 84042 84043
--       84045 84062 84633 84651 84653 84655 84660 84663 84664 84685 (Utah Co).
--
-- Audit facts this plan is built on (production-verified before applying):
--  * 17 of the 18 city rows carry ZERO directly-tagged meetings/alerts — all
--    their content lives on the county root; each holds only its council topic.
--  * Eagle Mountain (84005) is a chain ROOT (parent_id null) carrying 25
--    meetings, 13 alerts, and 7 topics itself. It keeps that role as parent.
--  * user_subscriptions referencing the 18 city ids: 0. Subscription anchoring
--    (communityGovTopics rootId) walks the FULL chain → root unchanged
--    (county / Eagle Mountain) for every ZIP.
--  * Sitemap + all page URLs are keyed by ZIP, not community id → unchanged.
--  * The ONLY two one-hop-up consumers were fixed to chain walks in the same
--    change: lib/data.js meetings() (ancestor-chain ids — identity for every
--    zip→county page) and app_refresh_zip's _root (recursive chain-top walk —
--    identity for every existing page, incl. Eagle Mountain via coalesce).
--
-- ORDER OF OPERATIONS (no regression window):
--  1. Merge/deploy the lib/data.js meetings() chain walk (GitHub Pages).
--  2. Apply this migration (rows + function).
--  3. Re-run app_refresh_zip for the 18 ZIPs.
--  4. Verify (queries at bottom + verify-communities + verify-maps-rollout CI).
-- ============================================================================

-- ---------- 1. One level='zip' row per pilot ZIP ----------------------------
-- parent_id = the city row that carried the ZIP (true hierarchy: zip → city →
-- county; Eagle Mountain: zip → EM root). government_topics = [] — a ZIP has no
-- government of its own; it inherits city council + county via the cascade.
-- Name uses the standard zip-page convention "<place> (<ZIP>)"; slug
-- "<city-slug>-<zip>" (0 collisions). The ZIP deliberately STAYS in the city
-- row's zip_codes array (established pattern — e.g. county arrays also carry
-- their ZIPs); most-specific resolution ranks zip > city so the new row wins.
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug)
select c.name || ' (' || z.zip || ')', c.county, c.state, array[z.zip], 'zip', c.id, array[]::text[],
       c.slug || '-' || z.zip
from public.communities c, unnest(c.zip_codes) z(zip)
where c.level = 'city'
  and z.zip in ('84302','84337','84003','84004','84005','84013','84042','84043',
                '84045','84062','84633','84651','84653','84655','84660','84663','84664','84685')
  and not exists (
    select 1 from public.communities zc
    where zc.level = 'zip' and zc.zip_codes @> array[z.zip]);

-- ---------- 2. app_refresh_zip: _root = chain TOP (was: parent of _cid) -----
-- Replace, inside app_refresh_zip, the line
--     select parent_id into _root from public.communities where id = _cid;
-- with the recursive chain-top walk below. Identity for every pre-existing
-- page (a zip row's parent was already the root; Eagle Mountain's null parent
-- behaved as root via coalesce(_root,_cid)); for the 18 normalized ZIPs it
-- anchors civic content at the county / Eagle Mountain root exactly as before.
--     with recursive up as (
--       select id, parent_id, 0 as d from public.communities where id = _cid
--       union all
--       select c.id, c.parent_id, up.d+1 from public.communities c
--         join up on c.id = up.parent_id where up.d < 6)
--     select id into _root from up order by d desc limit 1;
-- (Full function body applied in production migration
--  `app_refresh_zip_chain_root`; see supabase migration history.)

-- ---------- 3. Point Maps metadata at the new most-specific rows ------------
update public.app_community_meta m
set community_id = zc.id
from public.communities zc, unnest(zc.zip_codes) z(zip)
where zc.level = 'zip' and z.zip = m.zip
  and m.zip in ('84302','84337','84003','84004','84005','84013','84042','84043',
                '84045','84062','84633','84651','84653','84655','84660','84663','84664','84685')
  and m.community_id <> zc.id;

-- ---------- 4. Re-materialize the 18 (run after 1-3) ------------------------
-- select public.app_refresh_zip(z) from unnest(array[
--   '84302','84337','84003','84004','84005','84013','84042','84043','84045',
--   '84062','84633','84651','84653','84655','84660','84663','84664','84685']) z;

-- ---------- 5. Verification (all must hold) ---------------------------------
-- a) every user-facing ZIP has exactly ONE level='zip' row:
--    select count(*) from (select z.zip, count(*) n from communities c, unnest(zip_codes) z(zip)
--      where level='zip' group by z.zip having count(*) > 1) d;             -- = 0
-- b) 0 covered ZIPs whose most-specific community is not level='zip':
--    (most-specific = min rank over containing rows; every app_community_meta zip
--     must have a level='zip' containing row)
-- c) one Maps meta row per ZIP (pk on zip) and 0 missing pages.
-- d) per-ZIP before/after: meetings visible on the page (chain-scoped count),
--    app_projects / app_changes counts, subscriptions count — all unchanged.
