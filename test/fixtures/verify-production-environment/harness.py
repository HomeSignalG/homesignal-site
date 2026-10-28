"""Run the embedded script of .github/workflows/verify-production-environment.yml offline.

Used by test/verify-production-environment-deferred.test.mjs. urllib and psql are stubbed, so no
request leaves the machine and every secret value is a fake.

usage: python3 -I harness.py <script.py> <case>   (cwd = repo root, so config.js is readable)
cases: absent, blank, set, flag_false, absent_one_fail
"""
import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

script_path, case = sys.argv[1], sys.argv[2]
body = open(script_path, encoding="utf-8").read()
REF = "qwnnmljucajnexpxdgxr"
SERVICE = "svc-FAKE-7f3a"
TOKEN = "sbp_FAKE_9c1d"

if case == "flag_false":
    if body.count("DB_URL_DEFERRED = True") != 1:
        sys.exit("HARNESS: DB_URL_DEFERRED = True not found exactly once")
    body = body.replace("DB_URL_DEFERRED = True", "DB_URL_DEFERRED = False")

os.environ["PROJECT_REF"] = REF
os.environ["SERVICE_KEY"] = SERVICE
os.environ["ACCESS_TOKEN"] = TOKEN
os.environ["GITHUB_STEP_SUMMARY"] = os.path.join(os.path.dirname(os.path.abspath(script_path)), "summary.md")
os.environ.pop("PROD_DB_URL", None)
if case == "set":
    os.environ["PROD_DB_URL"] = "postgresql://postgres.%s:p%%40ss-FAKE@aws-0-us-west-2.pooler.supabase.com:5432/postgres" % REF
elif case == "blank":
    os.environ["PROD_DB_URL"] = "   \n\t"


class Resp:
    def __init__(self, status, payload):
        self.status = status
        self._raw = json.dumps(payload).encode()

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def answer(url, headers):
    auth = headers.get("Authorization", "")
    is_service = auth == "Bearer " + SERVICE
    if url.startswith("https://%s.supabase.co/rest/v1/canonical_zip_registry" % REF):
        return 200, [{"zip": "84302"}]
    if url.startswith("https://%s.supabase.co/rest/v1/app_zip_source_ids" % REF):
        return (200, []) if is_service else (401, {"message": "permission denied"})
    if url == "https://%s.supabase.co/storage/v1/bucket" % REF:
        return (200, [{"id": "a"}, {"id": "b"}]) if is_service else (200, [])
    api = "https://api.supabase.com/v1/projects/%s" % REF
    if url == api:
        if auth == "Bearer " + TOKEN and case != "absent_one_fail":
            return 200, {"id": REF, "ref": REF, "status": "ACTIVE_HEALTHY"}
        return 401, {"message": "Unauthorized"}
    if url == api + "/functions":
        return (200, [{"slug": "x"}]) if auth == "Bearer " + TOKEN else (401, {})
    raise AssertionError("unexpected URL " + url)


class FakeOpener:
    def open(self, req, timeout=None):
        if req.get_method() != "GET":
            raise AssertionError("non-GET request " + req.get_method())
        status, payload = answer(req.full_url, dict(req.header_items()))
        if 200 <= status < 300:
            return Resp(status, payload)
        raise urllib.error.HTTPError(req.full_url, status, "x", {}, io.BytesIO(json.dumps(payload).encode()))


def fake_build_opener(*handlers):
    if len(handlers) != 1 or handlers[0].__name__ != "NoRedirect":
        raise AssertionError("opener built without exactly the NoRedirect handler")
    return FakeOpener()


urllib.request.build_opener = fake_build_opener
psql_calls = []


def fake_run(argv, env=None, capture_output=None, text=None, timeout=None):
    if argv[0] != "psql":
        raise AssertionError("unexpected subprocess " + argv[0])
    psql_calls.append((argv, {k: v for k, v in (env or {}).items() if k.startswith("PG")}))
    return subprocess.CompletedProcess(argv, 0, "1,12744,on\n", "")


subprocess.run = fake_run

code = 0
try:
    exec(compile(body, "verify_script.py", "exec"), {"__name__": "__main__"})
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else 1
print("HARNESS psql calls: %d" % len(psql_calls))
for argv, pgenv in psql_calls:
    print("HARNESS password in argv: %s" % any("p@ss" in a or "p%40ss" in a for a in argv))
    print("HARNESS PGPASSWORD decoded: %s" % (pgenv.get("PGPASSWORD") == "p@ss-FAKE"))
print("HARNESS exit=%d" % code)
sys.exit(code)
