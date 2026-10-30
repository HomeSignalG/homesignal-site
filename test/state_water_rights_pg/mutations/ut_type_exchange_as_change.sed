# An exchange reads as a change application.
s/when left(btrim(p_chexnum), 1) in ('E', 'X') then 'Exchange application'/when left(btrim(p_chexnum), 1) in ('E', 'X') then 'Change application'/
