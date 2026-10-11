import sys
s = open(sys.argv[1]).read()
a = "case when v.reason = 'ok' and (select k.requested from k) > 0 then"
b = "case when v.reason = 'ok' then"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
