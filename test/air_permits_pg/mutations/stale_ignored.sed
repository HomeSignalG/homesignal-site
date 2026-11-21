s/v_status := case when v_last is null or v_last < now() - make_interval(hours => src.max_age_hours) then 'unavailable' else 'complete' end;/v_status := 'complete';/
