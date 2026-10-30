# The data-center lifecycle reads every observation, not only the current one.
/^    join public.dc_current_observation cx on cx.home_signal_observation_id = eo.home_signal_observation_id$/d
