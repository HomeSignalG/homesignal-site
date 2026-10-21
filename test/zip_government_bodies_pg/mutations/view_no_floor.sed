s/    where p.place_geoid in (select g.place_geoid from public.zip_government_places g where g.zip = p_zip)/    where true/
