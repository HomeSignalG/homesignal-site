-- Rule #0a: the MAPS component of the resident fingerprint moved between 18:59Z and 19:42Z.
-- Name the rows and the writer before believing any comparison. Read-only.
select
  (select json_agg(json_build_object('column', column_name, 'type', data_type) order by column_name collate "C")
     from information_schema.columns where table_schema='public' and table_name='social_posts'
      and (data_type like 'timestamp%' or column_name in ('status','content_family','zip','source_table','source_id'))) as cols,
  (select json_agg(row_to_json(x)) from (
     select id, status, zip, updated_at, created_at, image_bucket_path, left(post_text, 90) as text_head,
            evidence->>'theme' as theme, evidence->>'capture_key' as capture_key
       from public.social_posts
      where content_family = 'MAPS' and updated_at >= '2026-09-22 19:43:00+00'
      order by updated_at) x) as changed_since_1943,
  (select count(*) from public.social_posts where content_family='MAPS') as maps_total,
  (select max(updated_at) from public.social_posts where content_family='MAPS') as maps_max_updated;
