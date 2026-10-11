import sys
s = open(sys.argv[1]).read()
a = 'where b.zip = p_zip and b.tick_at > rd.vat and b.tick_at < (select c.refreshed_at from c)'
b = 'where false and b.zip = p_zip and b.tick_at > rd.vat and b.tick_at < (select c.refreshed_at from c)'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
