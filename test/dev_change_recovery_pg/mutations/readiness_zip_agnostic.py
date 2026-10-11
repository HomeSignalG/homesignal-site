import sys
s = open(sys.argv[1]).read()
a = 'where (select want.on from want) and sr.zip = p_zip'
b = 'where (select want.on from want)'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
