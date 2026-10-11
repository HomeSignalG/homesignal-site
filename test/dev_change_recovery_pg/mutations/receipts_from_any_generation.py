import sys
s = open(sys.argv[1]).read()
a = "r.tick_at = (select c.refreshed_at from c)\n     order by r.registry_id"
b = "r.tick_at <= (select c.refreshed_at from c)\n     order by r.registry_id"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
