/not exists (select 1 from public\.air_permit_footprints x where x\.record_id = r\.record_id);$/d
s/and v_county is not null and upper(r\.county) = upper(v_county)$/and v_county is not null and upper(r.county) = upper(v_county);/
