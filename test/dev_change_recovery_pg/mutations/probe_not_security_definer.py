import sys
s = open(sys.argv[1]).read()
a = 'language sql stable security definer set search_path = public, pg_temp as $fn$\n  with c as'
b = 'language sql stable set search_path = public, pg_temp as $fn$\n  with c as'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
