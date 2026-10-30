# Anyone (a job, a non-reviewer) can write a decided row directly.
s/  if new.link_state <> 'candidate' and not public.development_reviewer_can(new.decided_by, new.object_kind) then/  if false then/
