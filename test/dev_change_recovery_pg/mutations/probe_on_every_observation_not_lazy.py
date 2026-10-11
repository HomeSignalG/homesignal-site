import sys
s = open(sys.argv[1]).read()
a = 'select array_agg(o.identity_key) into _rec_keys'
b = "select coalesce(array_agg(o.identity_key), ''{}''::text[]) into _rec_keys"
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
