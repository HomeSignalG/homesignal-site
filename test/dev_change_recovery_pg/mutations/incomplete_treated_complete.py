import sys
s = open(sys.argv[1]).read()
a = "or not s.complete then ''hold''"
b = "then ''hold''"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
