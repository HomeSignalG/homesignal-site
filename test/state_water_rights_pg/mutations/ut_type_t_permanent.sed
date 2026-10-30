# A temporary change reads as permanent.
s/when left(btrim(p_chexnum), 1) = 't' then 'Temporary change application'/when left(btrim(p_chexnum), 1) = 't' then 'Permanent change application'/
