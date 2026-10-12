import sys
s = open(sys.argv[1]).read()
a = "when (select s.invalid from s) > 0                then 'invalid_row_generation'"
b = "when false                then 'invalid_row_generation'"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
