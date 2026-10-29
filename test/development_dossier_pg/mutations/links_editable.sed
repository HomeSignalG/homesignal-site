# Link rows can be edited in place (history lost).
s/^create trigger development_link_append_only before update or delete on public.development_project_link/create trigger development_link_append_only before truncate on public.development_project_link/
s/^  for each row execute function public.development_append_only();$/  for each statement execute function public.development_append_only();/
