import sys
s = open(sys.argv[1]).read()
a = "else ''recover'' end"
b = "else case when o.submitted_at < current_date - 45 then ''recover'' else ''genuine'' end end"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
