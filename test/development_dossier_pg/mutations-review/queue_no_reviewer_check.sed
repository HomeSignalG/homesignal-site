# Anyone signed in can read the review queue.
s/^  if uid is null or not exists (select 1 from public.development_reviewer r where r.user_id = uid and r.revoked_at is null) then$/  if false then/
