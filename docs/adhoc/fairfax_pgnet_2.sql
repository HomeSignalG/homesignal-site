select
  (select json_agg(json_build_object('id', r.id, 'status', r.status_code, 'timed_out', r.timed_out,
            'error', r.error_msg, 'len', length(r.content), 'head', left(r.content, 400)) order by r.id)
     from net._http_response r where r.id in (6311, 6312)) as responses,
  (select json_agg(json_build_object('registry_id', registry_id, 'rows', n, 'first_created', fc,
            'last_seen', ls) order by registry_id collate "C")
     from (select registry_id, count(*) n, min(created_at) fc, max(last_seen_at) ls
             from public.app_projects where registry_id like 'fairfax%' group by registry_id) x) as fairfax_rows;
