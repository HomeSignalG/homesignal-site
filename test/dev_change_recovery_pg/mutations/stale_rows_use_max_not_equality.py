import sys
s = open(sys.argv[1]).read()
a = 'm.g is not null and m.g is distinct from (select c.refreshed_at from c)'
b = 'm.g is not null and m.g > (select c.refreshed_at from c)'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
