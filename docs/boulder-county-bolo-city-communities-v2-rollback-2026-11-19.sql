-- ROLLBACK for boulder-county-bolo-city-communities-v2-2026-11-19.sql. NOT APPLIED. Needs its own approval.
-- Scoped to the ids the apply actually reported as 'inserted' (paste them below). It never deletes by slug alone, never touches a row the apply
-- reported 'already_exact', and REFUSES (changing nothing) if anything has since been attached to a row.
-- Same runner semantics as the apply file: one implicit transaction, no explicit BEGIN/COMMIT, SET LOCAL.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $do$
declare
  v_ids uuid[] := array[]::uuid[];   -- PASTE the 'inserted' ids from the apply receipt, e.g. array['...','...']::uuid[]
  c_parent_id constant uuid := '0df863af-f218-4177-a885-fbffa17a5ec3';
  c_slugs constant text[] := array['louisville-co','superior-co','lafayette-co','boulder-co'];
  t text; n bigint; v_deleted int; v_found int;
  -- uuid community_id tables, FK-backed (a plain DELETE would also be refused by the FK) and not FK-backed
  c_uuid_tables constant text[] := array['alerts','meetings','projects','user_subscriptions','self_reports','users','email_events','social_posts','local_news_holds',
    'alert_confirmations','app_changes','app_community_meta','app_projects','events','feed_candidates','resolved_projects','local_news_enrichment',
    'local_news_geo_retractions','social_post_rejections','social_posts_legacy','user_subscriptions_pre_migration','ingest_rejected_candidates'];
begin
  if cardinality(v_ids) = 0 then raise exception 'rollback refused: paste the inserted ids from the apply receipt'; end if;
  -- every id is one of the four rows, exactly as the apply created them
  select count(*) into v_found from public.communities c
   where c.id = any(v_ids) and c.slug = any(c_slugs) and c.level = 'city' and c.parent_id = c_parent_id and c.zip_codes = array[]::text[]
     and c.government_topics = array[]::text[] and c.county = 'Boulder' and c.state = 'CO';
  if v_found <> cardinality(v_ids) then raise exception 'rollback refused: % of % ids do not match a BOLO city community as created', cardinality(v_ids) - v_found, cardinality(v_ids); end if;
  -- anything attached since? self_reports would be DELETED BY CASCADE, so it is checked like the rest
  foreach t in array c_uuid_tables loop
    execute format('select count(*) from public.%I where community_id = any($1)', t) into n using v_ids;
    if n > 0 then raise exception 'rollback refused: % row(s) in public.% reference these communities', n, t; end if;
  end loop;
  select count(*) into n from public.communities where parent_id = any(v_ids); if n > 0 then raise exception 'rollback refused: % child communities', n; end if;
  -- feeds reference a community by TEXT id and by slug, with NO foreign key: a plain delete would orphan them silently
  select count(*) into n from public.feeds where community_id = any(array(select unnest(v_ids)::text)) or jurisdiction_slug = any(c_slugs);
  if n > 0 then raise exception 'rollback refused: % feed row(s) name these communities (no FK protects them)', n; end if;
  select count(*) into n from public.hearing_source_evidence where jurisdiction_slug = any(c_slugs);
  if n > 0 then raise exception 'rollback refused: % hearing_source_evidence row(s) name these slugs', n; end if;
  delete from public.communities where id = any(v_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted <> cardinality(v_ids) then raise exception 'deleted % of % rows', v_deleted, cardinality(v_ids); end if;
end
$do$;
select count(*) as remaining_bolo_city_rows from public.communities where slug in ('louisville-co','superior-co','lafayette-co','boulder-co');
