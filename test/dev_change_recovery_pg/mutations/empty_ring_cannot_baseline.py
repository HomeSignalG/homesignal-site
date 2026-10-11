import sys
s = open(sys.argv[1]).read()
a = "where (s.scope = ''expanded'' and s.complete) or coalesce(n.held, 0) > 0"
b = "where ((s.scope = ''expanded'' and s.complete) and exists (select 1 from _dc_scopecls)) or coalesce(n.held, 0) > 0"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
