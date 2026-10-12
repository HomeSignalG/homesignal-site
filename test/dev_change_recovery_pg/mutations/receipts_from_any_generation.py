import sys
s = open(sys.argv[1]).read()
a = 'where (select want.on from want) and sc.zip = p_zip and sc.last_tick_at = (select c.refreshed_at from c)'
b = 'where (select want.on from want) and sc.zip = p_zip'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
