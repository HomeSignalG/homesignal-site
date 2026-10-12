import sys
s = open(sys.argv[1]).read()
a = "when (select k.unmatched from k) > 0              then 'requested_key_not_in_current_generation'"
b = "when false              then 'requested_key_not_in_current_generation'"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
