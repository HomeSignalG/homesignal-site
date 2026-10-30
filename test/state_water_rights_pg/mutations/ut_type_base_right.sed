# The base right's TYPE_OF_RIGHT labels a change filing again (the a55167 defect).
s/w.filing_type := public.water_rights_ut_filing_type(a ->> 'CHEXNUM', a ->> 'TYPE_OF_RIGHT');/w.filing_type := nullif(btrim(a ->> 'TYPE_OF_RIGHT'), '');/
