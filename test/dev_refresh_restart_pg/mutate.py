#!/usr/bin/env python3
"""Print a mutated copy of the restart-heal migration. Each mutation is a change the
suite must catch. Usage: mutate.py NAME FILE"""
import sys
MUTATIONS = {
    # the stale cursor is emptied instead of set to the counter (the 2026-09-27 flood)
    'heal-sets-null': ('set last_collected_response_id =\n           (select case when s.is_called then s.last_value else s.last_value - 1 end\n              from net.http_request_queue_id_seq s)\n   where',
                       'set last_collected_response_id = null\n   where'),
    # a counter that has issued nothing since restart is read as having issued last_value
    'heal-ignores-is-called': ('case when s.is_called then s.last_value else s.last_value - 1 end', 's.last_value', 2),
    # the heal never matches anything (the defect as it stands today)
    'heal-never-fires': ('where d.last_collected_response_id >\n', 'where false and d.last_collected_response_id >\n'),
    # every cursor is pulled to the counter, not only stale ones
    'heal-touches-every-cursor': ('where d.last_collected_response_id >\n', 'where d.last_collected_response_id >= 0 or 0 >\n'),
    # --- batch cap (docs/dev-refresh-collect-batch-cap.sql) ---
    # the newest answers are taken first, so the oldest can age out of the window unseen
    'cap-newest-first': ('  order by c.id\n  limit 16) e;', '  order by c.id desc\n  limit 16) e;'),
    # a larger cap, consistently everywhere the file names it
    'cap-is-17': ('limit 16) e;', 'limit 17) e;', 3),
    # the cap text is kept but the LIMIT is gone
    'cap-without-limit': ('  order by c.id\n  limit 16) e;', '  order by c.id\n  ) e;'),
}
name, path = sys.argv[1], sys.argv[2]
a, b, *n = MUTATIONS[name]
n = n[0] if n else 1
src = open(path).read()
if src.count(a) != n:
    sys.exit(f'anchor for {name} found {src.count(a)} times')
print(src.replace(a, b), end='')
