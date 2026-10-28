-- A review row that exists BEFORE the queue DDL is applied: the manually published pilot.
insert into public.youtube_video_reviews (slug, title, status, files, meta)
values ('pilot', 'Pilot', 'rejected',
  '{"final":{"path":"pilot/final.mp4","bytes":1000,"sha256":"aa"},"short1":{"path":"pilot/short1.mp4","bytes":500,"sha256":"bb"},"short2":{"path":"pilot/short2.mp4","bytes":500,"sha256":"cc"}}', '{}');
insert into storage.objects (bucket_id, name, metadata) values
  ('jody-videos','pilot/final.mp4','{"size":1000}'),('jody-videos','pilot/short1.mp4','{"size":500}'),('jody-videos','pilot/short2.mp4','{"size":500}');
