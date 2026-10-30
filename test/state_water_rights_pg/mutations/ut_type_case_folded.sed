# Case folded: an uppercase number would read as a change application.
s/when left(btrim(p_chexnum), 1) = 'a' then/when lower(left(btrim(p_chexnum), 1)) = 'a' then/
