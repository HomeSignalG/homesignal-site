select jsonb_pretty(jsonb_build_object(
 'videos', (select jsonb_agg(jsonb_build_object('id',j.id,'slug',j.slug,'file',j.file_key,'hold',j.hold_reason,'yt',j.youtube_url,'text_len',length(j.post_text),'alt_len',length(j.alt_text),'approved',j.approved_at,
     'review_yt',(select r.youtube_url from public.youtube_video_reviews r where r.slug=j.slug),
     'channel',(select jsonb_agg(jsonb_build_object('vid',c.video_id,'title',c.title,'file',c.file_key,'state',c.match_state,'link',c.link_state,'privacy',c.privacy_status,'public_at',c.public_verified_at)) from public.youtube_channel_videos c where c.slug=j.slug)))
   from public.video_bluesky_jobs j where j.status='held'),
 'z64166_posts', (select jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'created',p.created_at,'visual',p.evidence->'visual'->>'state','pid',p.evidence->>'project_id')) from public.social_posts p where p.content_family='MAPS' and p.zip='64166'),
 'z64166_order', (select count(*) from public.maps_zip_order where zip='64166'),
 'z64166_members', (select count(*) from geo.n5_serving_membership where zcta5='64166'),
 'z64166_projects', (select count(*) from public.app_projects where zip='64166' and record_kind='development'),
 'last_maps_runs', (select jsonb_agg(to_jsonb(x)) from (select * from public.maps_generation_request order by 1 desc limit 3) x)
));
