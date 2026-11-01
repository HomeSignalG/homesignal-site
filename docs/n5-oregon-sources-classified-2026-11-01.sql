-- Map 1 draws the five Oregon sources wired 2026-11-01 (#2487).
--
-- WHAT. A source with no row in geo.n5_accepted_source is frozen as UNCLASSIFIED and Map 1 draws none of its records
-- (same reason as the Skagit and Douglas CO rows). Founder cleared these five on 2026-11-01.
--
-- TREATMENT.
--   PROVEN    the four point layers: every row's point is the publisher's own geometry (Tigard x2, Beaverton, Portland 1298).
--   RECOVERY  eugene-or-current-capital-projects: a POLYGON layer, so N5 re-reads the polygon (the Clark County precedent).
--
-- TAKES EFFECT with the next generation that opens. Apply only while no generation is BUILDING.

do $$
declare
  v_building int;
  v_after int;
begin
  select count(*) into v_building from geo.n5_generation where state = 'BUILDING';
  if v_building > 0 then
    raise exception 'a generation is BUILDING; apply after it finishes';
  end if;

  insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs)
  -- projects/pairs are 0: nothing is cached yet when this runs, and counting app_projects by registry_id (3M rows, no index)
  -- ran past a minute. They are informational; N5 reads only the treatment.
  select v.id, v.t, 0, 0
    from (values ('tigard-or-active-building-permits', 'PROVEN'),
                 ('tigard-or-active-planning-cases', 'PROVEN'),
                 ('beaverton-or-site-development-permits', 'PROVEN'),
                 ('portland-neighborhood-contact-applications', 'PROVEN'),
                 ('eugene-or-current-capital-projects', 'RECOVERY')) v(id, t)
  on conflict (registry_id) do nothing;

  select count(*) into v_after from geo.n5_accepted_source
   where (registry_id, treatment) in (('tigard-or-active-building-permits', 'PROVEN'), ('tigard-or-active-planning-cases', 'PROVEN'),
     ('beaverton-or-site-development-permits', 'PROVEN'), ('portland-neighborhood-contact-applications', 'PROVEN'),
     ('eugene-or-current-capital-projects', 'RECOVERY'));
  if v_after <> 5 then
    raise exception 'post-check failed: % of 5 Oregon sources classified as intended', v_after;
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING):
--   delete from geo.n5_accepted_source where registry_id in ('tigard-or-active-building-permits','tigard-or-active-planning-cases',
--     'beaverton-or-site-development-permits','portland-neighborhood-contact-applications','eugene-or-current-capital-projects');
