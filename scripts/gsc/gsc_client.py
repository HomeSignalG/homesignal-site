#!/usr/bin/env python3
"""Read-only Google Search Console client (URL Inspection + site list).

Scope: https://www.googleapis.com/auth/webmasters.readonly ONLY. No sitemap or
indexing submission code exists here. The API returns STORED inspection data,
not a live render test; an absent field means "not returned", nothing more.

Credentials (never in git, never printed): a service-account key supplied by
the environment's secret storage as ONE of
  GSC_SERVICE_ACCOUNT_JSON   the key JSON itself
  GSC_SERVICE_ACCOUNT_FILE   path to a key file outside the repo
The service account's email must be added as a (Restricted) user on the
Search Console property. Needs egress to oauth2.googleapis.com and
searchconsole.googleapis.com.

  gsc_client.py sites
  gsc_client.py inspect URL
  gsc_client.py pilot [--arm treatment|control|both] [--limit N] [--max-age-hours H]
  gsc_client.py diff OLD.json NEW.json
"""
import argparse, csv, datetime as dt, json, os, sys, time
import jwt          # PyJWT (RS256 needs `cryptography`)
import requests

SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://searchconsole.googleapis.com"
PROPERTY = os.environ.get("GSC_PROPERTY", "sc-domain:jodytracks.com")
HOST = "https://jodytracks.com"
OUT_DIR = os.environ.get("GSC_OUT_DIR", os.path.expanduser("~/gsc-snapshots"))
DAILY_CAP = int(os.environ.get("GSC_DAILY_CAP", "200"))  # our own cap, API allows 2,000/property/day
MANIFEST = os.path.join(os.path.dirname(__file__), "..", "..", "data", "seo-map-pilot.json")
FIELDS = ["url", "group", "observed_at", "verdict", "coverage_state", "last_crawl_time",
          "google_canonical", "user_canonical", "robots_txt_state", "indexing_state",
          "page_fetch_state", "crawled_as", "inspection_link", "error"]


def _key():
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON")
    path = os.environ.get("GSC_SERVICE_ACCOUNT_FILE")
    if raw:
        return json.loads(raw)
    if path:
        with open(path) as f:
            return json.load(f)
    sys.exit("NO CREDENTIAL: set GSC_SERVICE_ACCOUNT_JSON or GSC_SERVICE_ACCOUNT_FILE "
             "(environment secret). Nothing was called.")


_tok = {"v": None, "exp": 0}


def token():
    if _tok["v"] and time.time() < _tok["exp"] - 60:
        return _tok["v"]
    k = _key()
    now = int(time.time())
    assertion = jwt.encode({"iss": k["client_email"], "scope": SCOPE, "aud": TOKEN_URL,
                            "iat": now, "exp": now + 3000}, k["private_key"], algorithm="RS256")
    r = requests.post(TOKEN_URL, data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                       "assertion": assertion}, timeout=30)
    if r.status_code != 200:   # body has an error code, never the key
        sys.exit(f"TOKEN REFUSED {r.status_code}: {r.text[:300]}")
    _tok["v"], _tok["exp"] = r.json()["access_token"], now + 3000
    return _tok["v"]


def call(method, path, body=None, tries=4):
    for i in range(tries):
        try:
            r = requests.request(method, API + path, json=body, timeout=60,
                                 headers={"Authorization": "Bearer " + token()})
        except requests.RequestException as e:
            r = None
            err = str(e)
        if r is not None and r.status_code == 200:
            return r.json()
        if r is not None and r.status_code not in (429, 500, 502, 503, 504):
            return {"_error": f"HTTP {r.status_code}: {r.text[:300]}"}
        time.sleep(2 ** (i + 1))
    return {"_error": "gave up after retries: " + (err if r is None else f"HTTP {r.status_code}")}


def sites():
    return call("GET", "/webmasters/v3/sites")


def check_property():
    s = sites()
    if "_error" in s:
        sys.exit("SITES LIST FAILED: " + s["_error"])
    have = {e["siteUrl"]: e["permissionLevel"] for e in s.get("siteEntry", [])}
    if PROPERTY not in have:
        sys.exit(f"PROPERTY {PROPERTY} NOT AUTHORIZED. Authorized: {have or 'none'}")
    return have


def inspect(url, group=""):
    d = call("POST", "/v1/urlInspection/index:inspect",
             {"inspectionUrl": url, "siteUrl": PROPERTY, "languageCode": "en-US"})
    row = {k: "" for k in FIELDS}
    row.update(url=url, group=group, observed_at=dt.datetime.now(dt.timezone.utc).isoformat())
    if "_error" in d:
        row["error"] = d["_error"]
        return row
    res = d.get("inspectionResult", {})
    ix = res.get("indexStatusResult", {})
    row.update(verdict=ix.get("verdict", ""), coverage_state=ix.get("coverageState", ""),
               last_crawl_time=ix.get("lastCrawlTime", ""), google_canonical=ix.get("googleCanonical", ""),
               user_canonical=ix.get("userCanonical", ""), robots_txt_state=ix.get("robotsTxtState", ""),
               indexing_state=ix.get("indexingState", ""), page_fetch_state=ix.get("pageFetchState", ""),
               crawled_as=ix.get("crawledAs", ""), inspection_link=res.get("inspectionResultLink", ""))
    return row


def save(rows, name):
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = os.path.join(OUT_DIR, f"{name}-{stamp}")
    json.dump(rows, open(base + ".json", "w"), indent=1)
    with open(base + ".csv", "w", newline="") as f:
        w = csv.DictWriter(f, FIELDS)
        w.writeheader()
        w.writerows(rows)
    return base


def _cache():
    """Latest successful row per url from earlier pilot snapshots, plus today's call count."""
    latest, today, d0 = {}, 0, dt.datetime.now(dt.timezone.utc).date().isoformat()
    if os.path.isdir(OUT_DIR):
        for fn in sorted(os.listdir(OUT_DIR)):
            if fn.endswith(".json") and fn.startswith(("pilot-", "inspect-")):
                for r in json.load(open(os.path.join(OUT_DIR, fn))):
                    if not r.get("error"):
                        latest[r["url"]] = r
                    if r["observed_at"][:10] == d0:
                        today += 1
    return latest, today


def pilot(arm, limit, max_age_h):
    check_property()
    m = json.load(open(MANIFEST))
    arms = ["treatment", "control"] if arm == "both" else [arm]
    items = [(f"{HOST}/map/{z}/", a) for a in arms for z in m[a]]
    if limit:   # interleave arms so a small limit still compares both
        items = sorted(items, key=lambda t: (items.index(t) % max(1, len(m[arms[0]])), t[1]))[:limit]
    cache, today = _cache()
    now, rows, calls = dt.datetime.now(dt.timezone.utc), [], 0
    for url, a in items:
        c = cache.get(url)
        if c and (now - dt.datetime.fromisoformat(c["observed_at"])).total_seconds() < max_age_h * 3600:
            rows.append({**c, "group": a})
            continue
        if today + calls >= DAILY_CAP:
            print(f"DAILY CAP {DAILY_CAP} reached; stopping", file=sys.stderr)
            break
        rows.append(inspect(url, a)); calls += 1
    print(f"inspected {calls} new, {len(rows) - calls} from cache")
    return rows


def diff(a, b):
    A = {r["url"]: r for r in json.load(open(a))}
    n = 0
    for r in json.load(open(b)):
        o = A.get(r["url"])
        if not o:
            print("NEW", r["url"]); continue
        ch = {k: (o[k], r[k]) for k in FIELDS[3:11] if o[k] != r[k]}
        if ch:
            n += 1; print(r["url"], ch)
    print(f"{n} url(s) changed")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    s = p.add_subparsers(dest="cmd", required=True)
    s.add_parser("sites")
    i = s.add_parser("inspect"); i.add_argument("url")
    q = s.add_parser("pilot"); q.add_argument("--arm", default="both", choices=["treatment", "control", "both"])
    q.add_argument("--limit", type=int, default=0); q.add_argument("--max-age-hours", type=float, default=24)
    d = s.add_parser("diff"); d.add_argument("old"); d.add_argument("new")
    a = p.parse_args()
    if a.cmd == "sites":
        print(json.dumps(sites(), indent=1))
    elif a.cmd == "inspect":
        check_property(); r = inspect(a.url); print(json.dumps(r, indent=1)); print(save([r], "inspect"))
    elif a.cmd == "pilot":
        rows = pilot(a.arm, a.limit, a.max_age_hours); print(save(rows, "pilot"))
    else:
        diff(a.old, a.new)
