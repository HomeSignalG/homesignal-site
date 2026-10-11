import sys
s = open(sys.argv[1]).read()
a = 'where r.zip = p_zip and r.registry_id = coalesce(o.registry_id'
b = 'where r.registry_id = coalesce(o.registry_id'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
