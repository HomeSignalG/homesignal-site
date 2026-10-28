s/insert into _wr select distinct on (point_key) \* from _wr_raw order by point_key, content_md5;/insert into _wr select * from _wr_raw;/
