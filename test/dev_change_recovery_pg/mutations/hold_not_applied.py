import sys
s = open(sys.argv[1]).read()
a = "then ''hold''"
b = "then ''recover''"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
