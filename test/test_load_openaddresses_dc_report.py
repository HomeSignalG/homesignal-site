"""The dry-run match preview of scripts/load-openaddresses.py (read-only measurement). Run: python3 test/test_load_openaddresses_dc_report.py
Proves it reports what the LADDER would actually do: an exact-key hit counts, a unit-stripped-only hit does NOT, and
the controls (a present address, an absent one, an empty loaded set) each come out the way they must."""
import importlib.util, os, sys
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "x")
spec = importlib.util.spec_from_file_location("oa", os.path.join(os.path.dirname(__file__), "..", "scripts", "load-openaddresses.py"))
oa = importlib.util.module_from_spec(spec); spec.loader.exec_module(oa)
fails = 0
def chk(name, got, want):
    global fails
    ok = got == want
    print(("PASS — " if ok else "FAIL — ") + name + ("" if ok else f"  [got {got!r}, want {want!r}]"))
    fails += (not ok)

A = oa.canonical_addr("7725 W Reno Ave, Oklahoma City, OK 73127")
B = oa.canonical_addr("21155 Whitfield Pl, Sterling, VA 20166")
C = oa.canonical_addr("7725 W Reno Ave, Suite 304, Oklahoma City, OK 73127")
D = oa.canonical_addr("1 Nowhere Rd, Hillsboro, OR 97124")
chk("strip_unit removes a suite and nothing else", oa.strip_unit(C), A)
chk("strip_unit leaves a unit-free address alone", oa.strip_unit(A), A)
chk("strip_unit does not eat 'STE' out of STERLING", oa.strip_unit(B), B)
chk("strip_unit handles '#' and 'Ste' forms", (oa.strip_unit(oa.canonical_addr("5 Main St, Ste 12, Dallas, TX 75201")), oa.strip_unit(oa.canonical_addr("5 Main St #12, Dallas, TX 75201"))), (oa.canonical_addr("5 Main St, Dallas, TX 75201"),) * 2)
loaded = {A, B}
r = oa.dc_hit_report({"q-a": A, "q-b": B, "q-c": C, "q-d": D}, loaded)
chk("exact hits are the two unit-free present addresses", sorted(r["exact"]), ["q-a", "q-b"])
chk("a suite address whose stripped form is loaded is unit_only, NOT a hit", r["unit_only"], ["q-c"])
chk("an absent address is neither", "q-d" in r["exact"] + r["unit_only"], False)
chk("failing and with_unit are counted", (r["failing"], r["with_unit"]), (4, 1))
chk("control: an empty loaded set reports zero hits", oa.dc_hit_report({"q-a": A}, set())["exact"], [])
chk("control: a loaded unit-bearing key IS an exact hit", oa.dc_hit_report({"q-c": C}, {C})["exact"], ["q-c"])
sys.exit(1 if fails else 0)
