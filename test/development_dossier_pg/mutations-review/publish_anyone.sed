# Anyone signed in can start a publish.
s/^  if uid is null or not public.development_reviewer_can(uid, 'project') then$/  if false then/
