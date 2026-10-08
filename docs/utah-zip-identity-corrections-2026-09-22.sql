-- ============================================================================
-- Utah ZIP identity corrections — APPLIED 2026-09-22
-- migration: utah_zip_identity_corrections_from_pinned_usps_20260922
-- ============================================================================
-- Four of Utah's 310 ZIP pages disagreed with the PINNED SOURCE OF TRUTH
-- (`zipcodes` PyPI v3.0.0 — the bundled offline USPS dataset every state build
-- from Michigan onward was GENERATED from). Utah and Colorado predate that
-- convention, so their ZIP identities were hand-derived.
--
--   zip    was                              now                     what moved
--   84665  Lake Shore / Utah County         Sterling (84665)        COUNTY + PARENT
--          slug lake-shore                  slug sterling-84665     -> Sanpete
--   84059  Orem (84059) / parent Orem city  Vineyard (84059)        PARENT -> county
--   84332  Richmond (84332)                 Providence (84332)      name + slug
--   84333  River Heights (84333)            Richmond (84333)        name + slug
--
-- 84665 WAS THE ONE THAT REACHED RESIDENTS. Its page cascaded UTAH COUNTY
-- government to a resident whose county is SANPETE. The decisive evidence was
-- not the package alone but an INTERNAL CONTRADICTION: the page's own stored
-- map centroid (development_reports.home_lat/home_lng = 39.1936,-111.6924) is
-- exactly the package's Sterling point. The development pipeline consumed the
-- pinned source and got it right; the hand-typed community row did not. When
-- two halves of the system disagree, the generated half is the witness.
--
-- 84059 carried a second, quieter defect: it was parented to the Orem CITY row
-- carrying "City government (Orem)", so a Vineyard resident was served Orem's
-- council — a sibling-exclusion leak. Vineyard has no modeled city row and no
-- verified feed, so it re-parents to the COUNTY and inherits by cascade
-- (standing answer: defer city councils until their feed is verified).
--
-- 84332/84333 were a one-slot shift in Cache County: Richmond sat on 84332
-- (really Providence), displacing Richmond off 84333, which held "River
-- Heights" — a place whose mail is served by 84321 and which has no ZIP of
-- its own.
--
-- SAFETY, MEASURED BEFORE APPLYING: all four rows carried 0 subscriptions,
-- 0 users, 0 alerts, 0 meetings, 0 children, so nothing was orphaned and no
-- subscriber was switched between communities. `communities.js` carries only
-- the two legacy bootstrap slugs (box-elder, eagle-mountain) and no source
-- file referenced any of the four slugs, so the renames are DB-only.
--
-- ⛔ 84684 AND 84685 ARE ABSENT FROM THE PINNED SOURCE AND ARE DELIBERATELY
--    NOT TOUCHED. Unverifiable is not the same as wrong, and inventing a place
--    name is fabrication. (An earlier pass of this very audit hand-typed
--    "Benjamin" for 84684 into a scratch query and manufactured a finding that
--    did not exist — claims rule 7, met the hard way. Generate the comparison,
--    never transcribe it.)
--
-- SCOPE: exactly ONE county disagreement exists across all 310 Utah pages, so
-- this is a genuine one-off, not a pattern. COLORADO IS A SEPARATE, LARGER
-- UNIT and is deliberately NOT bundled here — see the CLAUDE.md note.
-- ============================================================================

do $$
declare
  v_n int; v_before text; v_sanpete uuid; v_utah uuid;
  v_after text; v_dups int; v_ut_pages int; v_topics int;
begin
  -- (a) FAIL CLOSED on the exact state this change was written against.
  select count(*),
         md5(string_agg(c.zip_codes[1]||'|'||c.name||'|'||c.slug||'|'||c.county||'|'||coalesce(p.name,'~'),
             ',' order by c.zip_codes[1] collate "C"))
    into v_n, v_before
    from public.communities c left join public.communities p on p.id = c.parent_id
   where c.level='zip' and c.zip_codes[1] in ('84059','84332','84333','84665');
  if v_n <> 4 or v_before is distinct from 'a6c19deba1f6f9689131b96120d21339' then
    raise exception 'PRECONDITION FAILED: expected 4 rows / a6c19deba1f6f9689131b96120d21339, got % / % — another writer moved these rows; re-measure before applying', v_n, v_before;
  end if;

  -- (b) Resolve parents by IDENTITY, never by a transcribed uuid (claims rule 7).
  select id into strict v_sanpete from public.communities
   where level='county' and county='Sanpete' and state in ('Utah','UT');
  select id into strict v_utah    from public.communities
   where level='county' and county='Utah'    and state in ('Utah','UT');

  -- (c) The four corrections. 84332 before 84333 so no slug ever collides mid-transaction.
  update public.communities set name='Vineyard (84059)',   slug='vineyard-84059',   parent_id=v_utah
   where level='zip' and zip_codes[1]='84059';
  update public.communities set name='Providence (84332)', slug='providence-84332'
   where level='zip' and zip_codes[1]='84332';
  update public.communities set name='Richmond (84333)',   slug='richmond-84333'
   where level='zip' and zip_codes[1]='84333';
  update public.communities set name='Sterling (84665)',   slug='sterling-84665',
         county='Sanpete', parent_id=v_sanpete
   where level='zip' and zip_codes[1]='84665';

  -- (d) VERIFY field by field rather than trusting that the updates reported success.
  select string_agg(c.zip_codes[1]||'='||c.name||'/'||c.slug||'/'||c.county||'/'||coalesce(p.name,'~'),
         ' ; ' order by c.zip_codes[1] collate "C")
    into v_after
    from public.communities c left join public.communities p on p.id = c.parent_id
   where c.level='zip' and c.zip_codes[1] in ('84059','84332','84333','84665');

  if v_after is distinct from
     '84059=Vineyard (84059)/vineyard-84059/Utah/Utah County ; '
   ||'84332=Providence (84332)/providence-84332/Cache/Cache County ; '
   ||'84333=Richmond (84333)/richmond-84333/Cache/Cache County ; '
   ||'84665=Sterling (84665)/sterling-84665/Sanpete/Sanpete County'
  then
    raise exception 'POSTCONDITION FAILED: %', v_after;
  end if;

  -- (e) Invariants that would catch collateral damage.
  select count(*) into v_dups from (
    select slug from public.communities where slug is not null group by slug having count(*) > 1
  ) d;
  if v_dups <> 0 then raise exception 'duplicate slugs introduced: %', v_dups; end if;

  select count(*) into v_ut_pages from public.communities
   where level='zip' and state in ('Utah','UT');
  if v_ut_pages <> 310 then raise exception 'Utah ZIP page count moved: % (expected 310)', v_ut_pages; end if;

  select coalesce(sum(coalesce(array_length(government_topics,1),0)),0) into v_topics
    from public.communities where level='zip' and zip_codes[1] in ('84059','84332','84333','84665');
  if v_topics <> 0 then raise exception 'a corrected ZIP row carries its own government_topics: %', v_topics; end if;

  raise notice 'OK: 4 Utah ZIP identities corrected against zipcodes v3.0.0; 310 pages intact, 0 duplicate slugs';
end $$;

-- ============================================================================
-- REMATERIALIZE — the step that gets forgotten. Correcting the row changes
-- nothing a resident sees until the page is rebuilt; 84665's rendered rows
-- were built against the UTAH COUNTY chain.
--   select public.app_refresh_zip('84059');
--   select public.app_refresh_zip('84332');
--   select public.app_refresh_zip('84333');
--   select public.app_refresh_zip('84665');
--
-- VERIFIED AFTER (2026-09-22 00:40:07Z), on app_changes.community_id — the
-- column that actually drives behaviour, not on title, which collides across
-- ZIPs on generic permit wording and inverted the first reading:
--   84665 -> Sterling (84665) 12 + Sanpete County 9, ZERO Utah County rows
--   84059 -> Vineyard (84059) 12 + Utah County  18, ZERO Orem rows
-- Statewide after: 310 pages, notices 310/310, local news 310/310,
-- meetings 310/310, 0 missing metadata, 0 missing dev cache, 0 dup slugs.
-- ============================================================================
