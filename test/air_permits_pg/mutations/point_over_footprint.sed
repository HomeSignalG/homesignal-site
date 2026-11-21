s/where w\.lat is not null and not exists (select 1 from public\.air_permit_footprints x where x\.record_id = w\.record_id)/where w.lat is not null/
