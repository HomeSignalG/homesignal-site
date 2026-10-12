import sys
s = open(sys.argv[1]).read()
a = 'from st where st.sk = any(p_keys)'
b = 'from st'
if s.count(a) < 1:
    sys.exit("anchor missing: " + a[:70])
sys.stdout.write(s.replace(a, b))
