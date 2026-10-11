import sys
s = open(sys.argv[1]).read()
a = 'and f.zip = p_zip and f.seen_at = (select c.refreshed_at from c)'
b = "and f.zip = p_zip and f.seen_at > now() - interval '100 years'"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
