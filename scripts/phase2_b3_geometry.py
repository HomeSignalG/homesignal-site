#!/usr/bin/env python3
"""Phase 2 / B3 — source-geometry recovery for the frozen Box Elder candidate universe.

Recovers the publisher's OWN geometry for the 9,571 frozen candidates in
geo.project_geometry_candidate and preserves it in geo.project_source_geometry.

B3 does not determine project-to-ZIP membership, does not touch legacy associations,
and does not read or write any production object.

Three rules this file exists to enforce:

  * RECOVERY IS BY IDENTITY, NEVER BY GEOGRAPHY. Every query asks the publisher for
    specific case numbers. No spatial filter is sent, ever. Asking a source only for
    features that already intersect Box Elder would reintroduce exactly the
    false-negative problem the candidate universe was built to expose.

  * ONE ROW PER AUTHORITATIVE SOURCE FEATURE. Measured on the frozen baseline: 554 of
    the 9,571 identities carry more than one source feature, up to 15 on one identity.
    A one-row-per-candidate table would silently destroy that. The publisher's own
    OBJECTID is the feature identity; a candidate with no feature still gets exactly
    one outcome row carrying NULL geometry and a stated reason, so "not recovered" and
    "nothing there" are never the same thing.

  * NOTHING IS FABRICATED. A line is stored as a line and a polygon as a polygon; no
    representative point is ever substituted, no geometry is invented for an
    unreachable source, and a NULL geometry is only ever written beside an outcome
    that makes NULL correct.

Modes:
  b3-probe  read-only. Reads the candidate list, reads each layer's own metadata
            (geometry type, spatial reference, objectIdField, maxRecordCount), asks
            the publisher how many features each case number really has, and sizes
            the payload. Writes nothing and holds no database credential it needs.
  b3-load   creates the table in one bounded transaction, then recovers and writes
            tranche by tranche, each tranche its own bounded transaction, with the
            preservation and disk controls re-read between tranches. Network calls
            never happen inside a database transaction.

stdlib only.
"""

import json
import os
import struct  # noqa: F401  (kept for parity with the B1 loader's shapefile path)
import sys
import time
import urllib.parse
import urllib.request

UA = "HomeSignal-phase2-b3/1.0 (+https://homesignal.net)"
PROJECT_REF = "qwnnmljucajnexpxdgxr"
CANONICAL_SRID = 4269
REQUEST_OUT_SR = 4326
RECOVERY_VERSION = "b3/2026-09-01/boxelder/identity-recovery/outSR4326-to-4269"

# The five reachable layers, each keyed by the field the identity's case number came
# from. `extra_where` from the registry is deliberately NOT applied: recovery is by
# identity, and a candidate whose status changed since ingestion must still be
# recoverable or the frozen universe silently shrinks.
LAYERS = {
    "udot-active-projects-lines": {
        "url": "https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/All_Projects/FeatureServer/1",
        "case_field": "pin",
    },
    "udot-active-projects": {
        "url": "https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/All_Projects/FeatureServer/0",
        "case_field": "pin",
    },
    "itd-itip-projects-lines": {
        "url": "https://services1.arcgis.com/Qqv4dYPC8Vv8e3c3/arcgis/rest/services/ITIP_2025/FeatureServer/0",
        "case_field": "KeyNo",
    },
    "wydot-stip-projects-lines": {
        "url": "https://services2.arcgis.com/WI04Bd6haCzitbuQ/arcgis/rest/services/ITSM_STIP_Data_Layers/FeatureServer/1",
        "case_field": "project_id",
    },
    "nvdot-project-boundaries": {
        "url": "https://gis.dot.nv.gov/arcgis/rest/services/Project_Boundaries/FeatureServer/0",
        "case_field": "LPN",
    },
}

# Unreachable at the candidate-universe proof, and included wholesale for that reason.
UNREACHABLE = {
    "boone-county-ky-planning-board-actions": "HTTP 400 on three query shapes; denominator 1,778 proves the host alive",
    "fairfax-active-site-construction": "HTTP 499 Token Required on spatial and unfiltered queries alike",
    "fairfax-recent-building-permits": "HTTP 499 Token Required on spatial and unfiltered queries alike",
}

BATCH = 60          # case numbers per request; keeps the form body well inside limits
POLITE = 1.0        # seconds between requests to one host

# NVDOT stopped responding mid-run and the first design waited on it indefinitely.
# Every number here exists to make waiting BOUNDED: a request cannot hang past the
# timeout, a batch cannot retry forever, and a run of dead batches ends the pass
# rather than burning the job's whole budget on a host that is not answering.
NVDOT_TIMEOUT = 45          # seconds per HTTP request
NVDOT_BACKOFF = (5, 15, 30) # seconds between attempts; 3 attempts per batch
NVDOT_BATCH = 25            # smaller than BATCH - gentler on a host that already stalled
NVDOT_MAX_DEAD_BATCHES = 4  # consecutive all-attempts-failed batches before stopping


def say(k, v):
    print(f"{k:<38} {v}", flush=True)


# ---------------------------------------------------------------- database

def sql(query, tag=""):
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json",
                 "Accept": "application/json",
                 "User-Agent": UA},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:4000]
        raise SystemExit(f"STOP: SQL {tag} failed HTTP {e.code}\n{body}")


# ---------------------------------------------------------------- arcgis

def qurl(layer_url):
    """ArcGIS queries go to <layer>/query. Posting query parameters at the bare layer
    URL returns the layer DESCRIPTION instead — HTTP 200, no error key, no features —
    which is exactly how five independent hosts all reported zero."""
    return layer_url.rstrip("/") + "/query"


def post(url, params, timeout=180):
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "User-Agent": UA, "Accept": "application/json"},
        method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def layer_meta(url):
    m = post(url, {"f": "json"})
    sr = (m.get("extent") or {}).get("spatialReference") or m.get("spatialReference") or {}
    return {
        "geometryType": m.get("geometryType"),
        "objectIdField": m.get("objectIdField") or "OBJECTID",
        "maxRecordCount": m.get("maxRecordCount"),
        "wkid": sr.get("wkid"),
        "latestWkid": sr.get("latestWkid"),
        "name": m.get("name"),
        "fields": {f.get("name"): f.get("type") for f in (m.get("fields") or [])},
    }


def field_type(meta, name):
    """Case-insensitively resolve a field's declared Esri type. A quoted literal
    against a numeric field is the classic silent-zero, so the type decides the
    quoting rather than a guess."""
    for k, v in (meta.get("fields") or {}).items():
        if k.lower() == name.lower():
            return k, v
    return name, None


def resolve_case_binding(url, meta, case_field, sample):
    """Decide the exact field name and literal quoting that actually match, by trying
    them against the live endpoint. The probe and the load MUST use the same
    resolution or the load can silently recover nothing."""
    real_field, ftype = field_type(meta, case_field)
    numeric = (ftype or "").lower() in ("esrifieldtypeinteger", "esrifieldtypesmallinteger",
                                        "esrifieldtypedouble", "esrifieldtypesingle",
                                        "esrifieldtypeoid", "esrifieldtypebiginteger")
    for use_quote in ([False, True] if numeric else [True, False]):
        time.sleep(POLITE)
        try:
            feats = fetch_by_cases(url, real_field, meta["objectIdField"],
                                   sample, want_geometry=False, quote=use_quote)
        except SystemExit as e:
            print(f"    quoted={use_quote} refused: {str(e)[:220]}", flush=True)
            continue
        except Exception as e:
            print(f"    quoted={use_quote} raised: {type(e).__name__} {str(e)[:200]}", flush=True)
            continue
        print(f"    quoted={use_quote} -> {len(feats)} features", flush=True)
        if feats:
            return real_field, ftype, use_quote
    return real_field, ftype, None


def total_count(url):
    """The positive control. A zero from a filtered query means nothing until the
    same endpoint proves it answers at all. Returns (count, raw) so a missing count
    is visible as the server's own words rather than as a None."""
    j = post(qurl(url), {"where": "1=1", "returnCountOnly": "true", "f": "json"})
    return j.get("count"), json.dumps(j)[:300]


def esc(v):
    return str(v).replace("'", "''")


def fetch_bounded(url, case_field, oid_field, cases, quote, timeout, backoff):
    """One bounded attempt sequence for one batch.

    Returns (features, None) on success, or (None, reason) when every attempt failed.
    A failure is NEVER converted into "no geometry" by this function - it returns the
    reason so the caller can record the truth."""
    last = ""
    for i, wait in enumerate((0,) + tuple(backoff)):
        if wait:
            time.sleep(wait)
        try:
            return fetch_by_cases(url, case_field, oid_field, cases,
                                  quote=quote, timeout=timeout), None
        except SystemExit as e:
            last = str(e)[:200]
        except Exception as e:
            last = f"{type(e).__name__}: {str(e)[:200]}"
        print(f"    attempt {i + 1} failed: {last}", flush=True)
    return None, last


def fetch_by_cases(url, case_field, oid_field, cases, want_geometry=True, quote=True,
                   timeout=180):
    """Ask the publisher for these exact case numbers. No spatial filter, ever."""
    if quote:
        lits = ",".join("'" + esc(c) + "'" for c in cases)
    else:
        lits = ",".join(str(c) for c in cases)
    where = "{} IN ({})".format(case_field, lits)
    params = {
        "where": where,
        "outFields": f"{oid_field},{case_field}",
        "returnGeometry": "true" if want_geometry else "false",
        "f": "json",
    }
    if want_geometry:
        params["outSR"] = str(REQUEST_OUT_SR)
    out, offset = [], 0
    while True:
        p = dict(params)
        if offset:
            p["resultOffset"] = str(offset)
        j = post(qurl(url), p, timeout=timeout)
        if "error" in j:
            raise SystemExit(f"STOP: source error {json.dumps(j['error'])[:400]}")
        feats = j.get("features") or []
        out.extend(feats)
        if not j.get("exceededTransferLimit") or not feats:
            break
        offset += len(feats)
        time.sleep(POLITE)
    return out


# ---------------------------------------------------------------- geometry

def _signed_area(pts):
    a = 0.0
    for i in range(len(pts) - 1):
        a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return a / 2.0


def _ring_wkt(r):
    return "(" + ",".join(f"{repr(float(x))} {repr(float(y))}" for x, y in r) + ")"


def geom_to_wkt(g):
    """Esri JSON -> WKT, preserving dimension. Never reduces to a point.

    Polyline and polygon are emitted as MULTI* unconditionally: an Esri polyline is a
    set of paths and an Esri polygon a set of rings, so collapsing a single-part
    feature to LINESTRING/POLYGON would make the stored type depend on the data rather
    than the source's own model. The Esri type is recorded separately.
    """
    if not g:
        return None, None
    if "x" in g and "y" in g:
        if g["x"] is None or g["y"] is None:
            return None, None
        return f"POINT({repr(float(g['x']))} {repr(float(g['y']))})", "POINT"
    if "points" in g:
        pts = [p for p in g["points"] if p and p[0] is not None]
        if not pts:
            return None, None
        return ("MULTIPOINT(" + ",".join(f"({repr(float(p[0]))} {repr(float(p[1]))})"
                                         for p in pts) + ")", "MULTIPOINT")
    if "paths" in g:
        paths = [p for p in g["paths"] if p and len(p) >= 2]
        if not paths:
            return None, None
        return ("MULTILINESTRING(" + ",".join(
            "(" + ",".join(f"{repr(float(x))} {repr(float(y))}" for x, y in p) + ")"
            for p in paths) + ")", "MULTILINESTRING")
    if "rings" in g:
        polys = []
        for ring in g["rings"]:
            if not ring or len(ring) < 4:
                continue
            r = list(ring)
            if r[0] != r[-1]:
                r.append(r[0])
            if _signed_area(r) < 0:          # clockwise -> outer ring
                polys.append([r])
            elif polys:                       # counter-clockwise -> hole
                polys[-1].append(r)
            else:
                polys.append([r])             # leading hole: keep it, never discard
        if not polys:
            return None, None
        return ("MULTIPOLYGON(" + ",".join(
            "(" + ",".join(_ring_wkt(r) for r in p) + ")" for p in polys) + ")",
            "MULTIPOLYGON")
    return None, None


# ---------------------------------------------------------------- controls

FULL_FINGERPRINT_SQL = """
select sum(('x'||substr(encode(identity_hash,'hex'),1,8))::bit(32)::bigint) as fp_corpus_all
  from preservation.app_project_identity;
"""

# The per-tranche control deliberately EXCLUDES the corpus fingerprint. That sum is a
# full scan of 3,172,292 rows, and running it between every tranche made the load
# slower than the recovery itself. Everything below is a catalog read or an indexed
# count, so the gate stays real without becoming the cost. The full fingerprint is
# re-derived at the start and the end of the run, where it belongs.
CONTROLS_SQL = """
select
  (select count(*) from geo.project_geometry_candidate)                          as candidates,
  (select md5(string_agg(source_key, ',' order by source_key collate "C"))
     from geo.project_geometry_candidate)                                        as candidate_fp,
  (select count(*) from geo.project_geometry_candidate where is_c1_legacy)       as c1,
  (select count(*) from geo.zcta_boundary)                                       as b1_rows,
  (select md5(string_agg(zcta5, ',' order by zcta5 collate "C"))
     from geo.zcta_boundary)                                                     as b1_fp,
  (select count(*) from preservation.app_project_identity)                       as n_identity,
  (select md5(string_agg(sig, ',' order by sig collate "C")) from (
      select c.relname||':'||t.tgname||':'||t.tgenabled::text as sig
        from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='preservation' and not t.tgisinternal
         and t.tgname like 'zz_guard_%') q)                                      as guard_md5,
  (select md5(pg_get_functiondef(p.oid)) from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='app_projects_for_zip')               as fn_projects_for_zip,
  (select md5(pg_get_functiondef(p.oid)) from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='app_refresh_zip')                    as fn_refresh_zip,
  (select md5(string_agg(jobid::text||'|'||jobname||'|'||schedule||'|'||command||'|'||active::text,
                         ';' order by jobid)) from cron.job)                     as cron_md5,
  pg_database_size(current_database())                                           as db_bytes,
  (select sum(size) from pg_ls_waldir())                                         as wal_bytes,
  pg_current_wal_lsn()::text                                                     as lsn;
"""

EXPECT_FULL = {"fp_corpus_all": "6809816297333320"}

EXPECT = {
    "candidates": 9571, "c1": 67, "b1_rows": 56,
    "b1_fp": "0a8b5fcea3827aac5ed32fbfa2713a46",
    "n_identity": 3172292,
    "guard_md5": "d55a010018cf5c345f4c8051b8a67279",
    "fn_projects_for_zip": "ec1b01ae4485ad2c59b9f946c9d565b6",
    "fn_refresh_zip": "dfd09ac72c5b6b65e61ad597665570a0",
    "cron_md5": "75b49e8c7e274ea10a3c17e979f86e6f",
}

# 12 GB provisioned. Everything the database itself does not account for was measured
# at the B1 commit and is held constant here; it is disclosed rather than hidden
# inside a threshold, because free disk is not readable from SQL on this platform.
DISK_TOTAL_MB = 12288
DISK_OTHER_MB = 681
DISK_STOP_MB = 2048


def controls(tag):
    row = sql(CONTROLS_SQL, tag)[0]
    bad = [f"{k}: expected {v}, got {row.get(k)}"
           for k, v in EXPECT.items() if str(row.get(k)) != str(v)]
    db_mb = int(row["db_bytes"]) / 1048576.0
    wal_mb = int(row["wal_bytes"]) / 1048576.0
    free_mb = DISK_TOTAL_MB - (db_mb + wal_mb + DISK_OTHER_MB)
    say(f"[{tag}] db / wal / free (MB)", f"{db_mb:,.0f} / {wal_mb:,.0f} / {free_mb:,.0f}")
    if bad:
        raise SystemExit("STOP: control failure\n  " + "\n  ".join(bad))
    if free_mb < DISK_STOP_MB:
        raise SystemExit(f"STOP: free disk {free_mb:,.0f} MB below the {DISK_STOP_MB} MB hard stop")
    row["_free_mb"] = free_mb
    row["_db_mb"] = db_mb
    row["_wal_mb"] = wal_mb
    return row


def full_fingerprint(tag):
    """The expensive one: the order-independent sum over every baseline identity.
    Run at the boundaries of the load, not between tranches."""
    row = full_sql_row(FULL_FINGERPRINT_SQL, tag)
    got = str(row.get("fp_corpus_all"))
    say(f"[{tag}] corpus:all fingerprint", got)
    if got != EXPECT_FULL["fp_corpus_all"]:
        raise SystemExit(f"STOP: corpus:all fingerprint {got} != {EXPECT_FULL['fp_corpus_all']}")


def full_sql_row(query, tag):
    res = sql(query, tag)
    if not isinstance(res, list) or not res:
        raise SystemExit(f"STOP: {tag} returned no row")
    return res[0]


def load_candidates():
    rows = sql("""select source_key, registry_id,
                         is_c1_legacy, is_c2_point_in_zcta,
                         is_c3_nonpoint_source, is_residual_unreachable
                    from geo.project_geometry_candidate
                   order by registry_id, source_key collate "C";""", "candidates")
    say("frozen candidates read", f"{len(rows):,}")
    return rows


def case_of(source_key, registry_id):
    """source_key is 'arcgis:<registry_id>:<case number>'. The case number may itself
    contain ':' (none observed, but the split is anchored on the registry prefix so it
    cannot matter)."""
    prefix = f"arcgis:{registry_id}:"
    if not source_key.startswith(prefix):
        raise SystemExit(f"STOP: source_key {source_key!r} does not carry its registry prefix")
    return source_key[len(prefix):]


# ---------------------------------------------------------------- table

DDL = f"""
create table if not exists geo.project_source_geometry (
  geometry_instance_key text        primary key,
  source_key            text        not null
      references geo.project_geometry_candidate (source_key),
  registry_id           text        not null,
  source_feature_id     text,
  geom                  geometry(Geometry, {CANONICAL_SRID}),
  geom_kind             text,
  source_geometry_type  text,
  geom_origin           text        not null,
  recovery_outcome      text        not null,
  source_crs            text,
  requested_out_sr      text,
  transformation        text,
  canonical_srid        int,
  source_url            text        not null,
  request_basis         text        not null,
  fetched_at            timestamptz,
  recovery_version      text        not null,
  constraint psg_origin_vocab check (geom_origin in
      ('source_supplied','stored_source_point','geocoded','unreachable','not_applicable')),
  constraint psg_outcome_vocab check (recovery_outcome in
      ('recovered','no_feature_returned','feature_has_no_geometry',
       'source_unreachable','not_attempted')),
  constraint psg_geometry_semantics check (
      (geom is not null and recovery_outcome = 'recovered'
       and geom_origin in ('source_supplied','stored_source_point','geocoded')
       and geom_kind is not null and canonical_srid = {CANONICAL_SRID})
   or (geom is null and recovery_outcome <> 'recovered'
       and geom_kind is null and canonical_srid is null))
);

comment on table geo.project_source_geometry is
  'Phase 2 / B3. The publisher''s own source geometry for the frozen Box Elder candidate '
  'universe, at ONE ROW PER AUTHORITATIVE SOURCE FEATURE - 554 of the 9,571 candidates carry '
  'more than one, up to 15. A candidate with no recoverable feature carries exactly one row '
  'with NULL geometry and a stated outcome, so "not recovered" and "nothing there" are never '
  'the same value. No geometry is ever fabricated, and no line or polygon is ever reduced to '
  'a representative point.';

create index if not exists project_source_geometry_gix on geo.project_source_geometry using gist (geom);
create index if not exists project_source_geometry_source_key_idx on geo.project_source_geometry (source_key);
create index if not exists project_source_geometry_outcome_idx on geo.project_source_geometry (recovery_outcome);
"""


def q(v):
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def tranche_sql(rows):
    """One bounded transaction carrying one validated tranche. Network work is already
    finished before this is built - no fetch ever happens inside a transaction."""
    values = []
    for r in rows:
        geom = ("ST_Transform(ST_GeomFromText($g$" + r["wkt"] + "$g$, "
                + str(REQUEST_OUT_SR) + "), " + str(CANONICAL_SRID) + ")") \
               if r.get("wkt") else "null"
        values.append(
            "(" + ",".join([
                q(r["geometry_instance_key"]), q(r["source_key"]), q(r["registry_id"]),
                q(r.get("source_feature_id")), geom, q(r.get("geom_kind")),
                q(r.get("source_geometry_type")), q(r["geom_origin"]),
                q(r["recovery_outcome"]), q(r.get("source_crs")),
                q(r.get("requested_out_sr")), q(r.get("transformation")),
                (str(CANONICAL_SRID) if r.get("wkt") else "null"),
                q(r["source_url"]), q(r["request_basis"]), q(r.get("validity_reason")),
                (q(r["fetched_at"]) + "::timestamptz" if r.get("fetched_at") else "null"),
                q(RECOVERY_VERSION),
            ]) + ")")
    return ("begin;\nset local search_path = public;\n"
            "insert into geo.project_source_geometry (\n"
            "  geometry_instance_key, source_key, registry_id, source_feature_id, geom,\n"
            "  geom_kind, source_geometry_type, geom_origin, recovery_outcome, source_crs,\n"
            "  requested_out_sr, transformation, canonical_srid, source_url, request_basis,\n"
            "  validity_reason, fetched_at, recovery_version)\nvalues\n" + ",\n".join(values) + "\non conflict (geometry_instance_key) do nothing;\n"
            "do $a$ declare v int; begin\n"
            "  select count(*) into v from geo.project_source_geometry\n"
            "   where geom is not null and not ST_IsValid(geom);\n"
            "  if v <> 0 then raise exception 'B3 tranche: % invalid geometries', v; end if;\n"
            "  select count(*) into v from geo.project_source_geometry\n"
            "   where geom is not null and ST_SRID(geom) <> " + str(CANONICAL_SRID) + ";\n"
            "  if v <> 0 then raise exception 'B3 tranche: % rows with wrong SRID', v; end if;\n"
            "  select count(*) into v from geo.project_source_geometry g\n"
            "   where not exists (select 1 from geo.project_geometry_candidate c\n"
            "                      where c.source_key = g.source_key);\n"
            "  if v <> 0 then raise exception 'B3 tranche: % rows outside the frozen universe', v; end if;\n"
            "end $a$;\ncommit;\n"
            "select count(*) as rows_total,\n"
            "       count(*) filter (where geom is not null) as with_geometry,\n"
            "       pg_size_pretty(pg_total_relation_size('geo.project_source_geometry')) as size,\n"
            "       pg_database_size(current_database()) as db_bytes,\n"
            "       (select sum(size) from pg_ls_waldir()) as wal_bytes\n"
            "  from geo.project_source_geometry;")


# ---------------------------------------------------------------- modes

def probe(cands):
    """Read-only. Establishes source-side cardinality, CRS and payload size."""
    by_reg = {}
    for c in cands:
        by_reg.setdefault(c["registry_id"], []).append(c)
    say("registries in the frozen universe", len(by_reg))
    print()

    for reg, cfg in LAYERS.items():
        rows = by_reg.get(reg, [])
        if not rows:
            continue
        print(f"===== {reg}  ({len(rows):,} candidates)")
        meta = layer_meta(cfg["url"])
        say("  layer name", meta["name"])
        say("  geometryType", meta["geometryType"])
        say("  objectIdField", meta["objectIdField"])
        say("  maxRecordCount", meta["maxRecordCount"])
        say("  spatialReference wkid", f"{meta['wkid']} (latestWkid {meta['latestWkid']})")

        real_field, ftype = field_type(meta, cfg["case_field"])
        say("  case field / declared type", f"{real_field} / {ftype}")
        time.sleep(POLITE)
        n, raw = total_count(cfg["url"])
        say("  CONTROL unfiltered count", f"{n:,}" if isinstance(n, int) else f"MISSING · {raw}")

        # What does the publisher's own value actually look like? A stored case
        # number that has been reformatted anywhere in the pipeline is the other way
        # a correct-looking IN clause matches nothing.
        time.sleep(POLITE)
        live = post(qurl(cfg["url"]), {"where": "1=1", "outFields": real_field,
                                 "returnGeometry": "false", "resultRecordCount": "5",
                                 "f": "json"})
        if live.get("error"):
            say("  publisher sample values", "ERROR " + json.dumps(live["error"])[:260])
        else:
            say("  publisher sample values",
                [f.get("attributes", {}).get(real_field)
                 for f in (live.get("features") or [])] or f"no features · {json.dumps(live)[:200]}")

        cases = [case_of(r["source_key"], reg) for r in rows]
        say("  our stored sample values", cases[:5])
        sample = cases[:BATCH]

        _f, _t, use_quote = resolve_case_binding(cfg["url"], meta, cfg["case_field"], sample)
        say("  resolved literal quoting", use_quote)
        feats = []
        if use_quote is not None:
            time.sleep(POLITE)
            feats = fetch_by_cases(cfg["url"], real_field, meta["objectIdField"],
                                   sample, quote=use_quote)
        per_case = {}
        for f in feats:
            k = str(f["attributes"].get(cfg["case_field"]))
            per_case.setdefault(k, 0)
            per_case[k] += 1
        wkt_bytes = 0
        kinds = {}
        for f in feats:
            w, kind = geom_to_wkt(f.get("geometry"))
            if w:
                wkt_bytes += len(w)
                kinds[kind] = kinds.get(kind, 0) + 1
        say("  sample case numbers asked", len(sample))
        say("  cases the publisher answered", len(per_case))
        say("  cases with NO feature", len([c for c in sample if str(c) not in per_case]))
        say("  features returned", len(feats))
        say("  max features on one case", max(per_case.values()) if per_case else 0)
        say("  multi-feature cases in sample", len([v for v in per_case.values() if v > 1]))
        say("  geometry kinds", kinds)
        if feats:
            say("  mean WKT bytes/feature", f"{wkt_bytes/max(1,len(feats)):,.0f}")
            say("  projected WKT for this source",
                f"{wkt_bytes/max(1,len(feats)) * len(feats)/max(1,len(sample)) * len(rows)/1048576:,.2f} MB")
        print()
        time.sleep(POLITE)

    for reg, why in UNREACHABLE.items():
        rows = by_reg.get(reg, [])
        print(f"===== {reg}  ({len(rows):,} candidates)  UNREACHABLE")
        say("  reason on record", why)
        print()

    print("PROBE COMPLETE - nothing was written to any database.")


def recover(cands):
    by_reg = {}
    for c in cands:
        by_reg.setdefault(c["registry_id"], []).append(c)

    full_fingerprint("pre-write")
    controls("pre-create")
    say("creating", "geo.project_source_geometry")
    sql("begin;\nset local search_path = public;\n" + DDL + "\ncommit;\nselect 1 as created;",
        "create table")

    total_written = 0
    for reg, cfg in LAYERS.items():
        rows = by_reg.get(reg, [])
        if not rows:
            continue
        print(f"\n===== recovering {reg}  ({len(rows):,} candidates)")
        meta = layer_meta(cfg["url"])
        src_crs = f"wkid {meta['wkid']} / latestWkid {meta['latestWkid']}"
        transformation = (f"publisher server outSR={REQUEST_OUT_SR}; "
                          f"ST_Transform({REQUEST_OUT_SR} -> {CANONICAL_SRID}) in database")
        say("  geometryType / SR", f"{meta['geometryType']} / {src_crs}")

        all_cases = [case_of(r["source_key"], reg) for r in rows]
        real_field, ftype, use_quote = resolve_case_binding(
            cfg["url"], meta, cfg["case_field"], all_cases[:BATCH])
        say("  case binding", f"{real_field} ({ftype}) quoted={use_quote}")
        if use_quote is None:
            raise SystemExit(
                f"STOP: no working literal form for {reg}.{real_field}; recovery would "
                f"silently return nothing for every candidate")

        pending, seen_cases = [], set()
        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i + BATCH]
            cases = [case_of(r["source_key"], reg) for r in chunk]
            time.sleep(POLITE)
            feats = fetch_by_cases(cfg["url"], real_field, meta["objectIdField"],
                                   cases, quote=use_quote)
            ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            basis = (f"{real_field} IN (<{len(cases)} case numbers>, quoted={use_quote})"
                     f" · no spatial filter")
            got = {}
            for f in feats:
                a = f.get("attributes") or {}
                case = str(a.get(real_field))
                oid = str(a.get(meta["objectIdField"]))
                wkt, kind = geom_to_wkt(f.get("geometry"))
                got.setdefault(case, []).append((oid, wkt, kind))
            for r, case in zip(chunk, cases):
                feats_for = got.get(str(case)) or []
                if not feats_for:
                    pending.append({
                        "geometry_instance_key": r["source_key"] + "#none",
                        "source_key": r["source_key"], "registry_id": reg,
                        "geom_origin": "not_applicable",
                        "recovery_outcome": "no_feature_returned",
                        "source_crs": src_crs, "requested_out_sr": str(REQUEST_OUT_SR),
                        "source_url": cfg["url"], "request_basis": basis, "fetched_at": ts,
                    })
                    continue
                for oid, wkt, kind in feats_for:
                    if not wkt:
                        pending.append({
                            "geometry_instance_key": f"{r['source_key']}#f:{oid}",
                            "source_key": r["source_key"], "registry_id": reg,
                            "source_feature_id": oid,
                            "geom_origin": "not_applicable",
                            # The publisher HAS this feature and returned it without
                            # geometry. That is a different fact from "no feature", and
                            # WYDOT's sample proved it real: 173 features, 171 geometries.
                            "recovery_outcome": "feature_has_no_geometry",
                            "source_crs": src_crs, "requested_out_sr": str(REQUEST_OUT_SR),
                            "source_url": cfg["url"], "request_basis": basis, "fetched_at": ts,
                        })
                        continue
                    pending.append({
                        "geometry_instance_key": f"{r['source_key']}#f:{oid}",
                        "source_key": r["source_key"], "registry_id": reg,
                        "source_feature_id": oid, "wkt": wkt, "geom_kind": kind,
                        "source_geometry_type": meta["geometryType"],
                        "geom_origin": "source_supplied", "recovery_outcome": "recovered",
                        "source_crs": src_crs, "requested_out_sr": str(REQUEST_OUT_SR),
                        "transformation": transformation,
                        "source_url": cfg["url"], "request_basis": basis, "fetched_at": ts,
                    })
                seen_cases.add(str(case))

            # write when the tranche is big enough, so no request carries a huge body
            if sum(len(p.get("wkt") or "") for p in pending) > MAX_TRANCHE_BYTES or len(pending) > 900:
                total_written += flush(pending)
                pending = []
                controls(f"tranche {reg}")
        if pending:
            total_written += flush(pending)
        say(f"  {reg} written so far", f"{total_written:,}")
        controls(f"after {reg}")

    # the unreachable residual: an explicit outcome row each, never silence
    for reg, why in UNREACHABLE.items():
        rows = by_reg.get(reg, [])
        if not rows:
            continue
        print(f"\n===== {reg}: {len(rows):,} explicit unreachable outcome rows")
        batch = []
        for r in rows:
            batch.append({
                "geometry_instance_key": r["source_key"] + "#none",
                "source_key": r["source_key"], "registry_id": reg,
                "geom_origin": "unreachable", "recovery_outcome": "source_unreachable",
                "source_url": "(not fetched)", "request_basis": why,
            })
            if len(batch) >= 900:
                total_written += flush(batch)
                batch = []
        if batch:
            total_written += flush(batch)
        controls(f"after {reg}")

    controls("post-write")
    full_fingerprint("post-write")
    say("total rows written", f"{total_written:,}")


MAX_TRANCHE_BYTES = 1_200_000   # the API refused 4.28 MB with HTTP 413 and accepted
                                # 2.57 MB; this sits well under the proven-good size.


def _subtranches(rows, budget=MAX_TRANCHE_BYTES):
    """Split by RENDERED size, not by a threshold tested before the row is added.
    The first design checked the accumulated total before appending a whole batch,
    so one batch of long corridors could overshoot by megabytes - which is exactly
    how the load hit HTTP 413."""
    cur, size = [], 0
    for r in rows:
        cost = len(r.get("wkt") or "") + 700
        if cur and size + cost > budget:
            yield cur
            cur, size = [], 0
        cur.append(r)
        size += cost
    if cur:
        yield cur


def nvdot_tranche_sql(rows, source_keys):
    """One bounded transaction: retire the not_attempted placeholders for exactly these
    candidates, then write what the bounded attempt actually observed.

    The DELETE is tightly guarded - it can only remove a row whose outcome is still
    not_attempted, so it can never touch a recovered geometry. Retiring the placeholder
    is required rather than optional: leaving it beside a real outcome would assert that
    the candidate was never asked, which after a bounded attempt is false."""
    keys = ",".join(q(k) for k in source_keys)
    body = tranche_sql(rows)
    delete = ("delete from geo.project_source_geometry\n"
              " where recovery_outcome = 'not_attempted'\n"
              "   and source_key in (" + keys + ");\n")
    return body.replace("set local search_path = public;\n",
                        "set local search_path = public;\n\n" + delete, 1)


isolated_failures = []


def flush_nvdot(rows, source_keys):
    if not rows:
        return 0
    written = 0
    for part in _subtranches(rows):
        part_keys = sorted({r["source_key"] for r in part})
        sqltext = nvdot_tranche_sql(part, part_keys)
        say("  writing tranche", f"{len(part):,} rows / {len(part_keys)} candidates, "
                                 f"{len(sqltext)/1048576:.2f} MB")
        try:
            res = sql(sqltext, "nvdot tranche")
        except SystemExit as e:
            if len(part_keys) == 1:
                raise
            # A tranche refused for one candidate's sake must not hold back the others.
            say("  tranche refused - isolating", f"{str(e)[:140]}")
            for k in part_keys:
                mine = [r for r in part if r["source_key"] == k]
                try:
                    sql(nvdot_tranche_sql(mine, [k]), "nvdot single")
                    written += len(mine)
                except SystemExit as e2:
                    say(f"  candidate {k} REFUSED", str(e2)[:200])
                    isolated_failures.append({"source_key": k, "error": str(e2)[:300]})
            continue
        if isinstance(res, list) and res:
            say("  table now", f"{res[0].get('rows_total'):,} rows")
        written += len(part)
    return written


def flush(rows):
    if not rows:
        return 0
    written = 0
    for part in _subtranches(rows):
        queue = [part]
        while queue:
            chunk = queue.pop(0)
            body = tranche_sql(chunk)
            say("  writing tranche", f"{len(chunk):,} rows, {len(body)/1048576:.2f} MB of SQL")
            try:
                res = sql(body, "tranche")
            except SystemExit as e:
                if "413" in str(e) and len(chunk) > 1:
                    say("  413 - halving", f"{len(chunk)} -> {len(chunk)//2} + rest")
                    queue.insert(0, chunk[len(chunk) // 2:])
                    queue.insert(0, chunk[:len(chunk) // 2])
                    continue
                raise
            if isinstance(res, list) and res:
                say("  table now", f"{res[0].get('rows_total'):,} rows, {res[0].get('size')}")
            written += len(chunk)
    return written


MIGRATION_SQL = """
begin;
set local search_path = public;

-- The minimum change: one column to hold the validity reason, and the two CHECKs
-- widened to admit exactly one new outcome. No redesign, no functions, views,
-- triggers or policies, and no other column.
alter table geo.project_source_geometry add column if not exists validity_reason text;

alter table geo.project_source_geometry drop constraint psg_outcome_vocab;
alter table geo.project_source_geometry add constraint psg_outcome_vocab check (
  recovery_outcome in ('recovered','no_feature_returned','feature_has_no_geometry',
                       'feature_geometry_invalid','source_unreachable','not_attempted'));

alter table geo.project_source_geometry drop constraint psg_geometry_semantics;
alter table geo.project_source_geometry add constraint psg_geometry_semantics check (
     (geom is not null and recovery_outcome = 'recovered'
      and geom_origin in ('source_supplied','stored_source_point','geocoded')
      and geom_kind is not null and canonical_srid = 4269)
  or (geom is null and recovery_outcome = 'feature_geometry_invalid'
      and source_feature_id is not null and validity_reason is not null
      and geom_kind is null and canonical_srid is null)
  or (geom is null and recovery_outcome in ('no_feature_returned','feature_has_no_geometry',
                                            'source_unreachable','not_attempted')
      and geom_kind is null and canonical_srid is null));

comment on column geo.project_source_geometry.validity_reason is
  'ST_IsValidReason for a publisher feature whose returned geometry failed validity. '
  'Present only on feature_geometry_invalid rows, where the canonical geom stays NULL '
  'because storing it, repairing it, or substituting anything for it would all be false.';

commit;
select conname, pg_get_constraintdef(oid) as def from pg_constraint
 where conrelid = 'geo.project_source_geometry'::regclass and contype = 'c' order by conname;
"""


def screen_validity(feats):
    """Ask the database whether each returned geometry is valid - BEFORE any write.

    Screening beats discovering: a tranche that fails on one bad polygon rolls back
    24 good ones with it, which is what happened on the first attempt. This returns
    validity in the requested CRS (4326) and after the canonical transform (4269),
    with ST_IsValidReason for both, so an invalid feature is classified rather than
    thrown."""
    out = {}
    chunk, size = [], 0
    def run(batch):
        if not batch:
            return
        vals = ",".join("({},{})".format(i, "$w$" + w + "$w$") for i, w in batch)
        rows = sql(
            "select v.i, ST_IsValid(g.g4326) as v4326, ST_IsValidReason(g.g4326) as r4326,"
            " ST_IsValid(ST_Transform(g.g4326,4269)) as v4269,"
            " ST_IsValidReason(ST_Transform(g.g4326,4269)) as r4269"
            " from (values " + vals + ") as v(i, wkt),"
            " lateral (select ST_GeomFromText(v.wkt, 4326) as g4326) g;", "validity screen")
        for r in rows:
            out[int(r["i"])] = r
    for i, w in feats:
        cost = len(w) + 40
        if chunk and size + cost > 900_000:
            run(chunk); chunk, size = [], 0
        chunk.append((i, w)); size += cost
    run(chunk)
    return out


def nvdot_complete():
    """Resume ONLY the NVDOT candidates still marked not_attempted.

    Nothing already recovered is refetched or overwritten: the working set is read
    from the table itself, as exactly those candidates whose only row is a
    not_attempted placeholder. Every bounded outcome is written truthfully -
    a network failure never becomes a no-geometry finding, and a successful query
    that returns nothing for a case number is recorded as its own distinct fact."""
    reg = "nvdot-project-boundaries"
    cfg = LAYERS[reg]

    full_fingerprint("pre-write")
    controls("pre-write")

    print("\n--- CHECK constraints BEFORE the minimum schema change ---")
    for r in sql("""select conname, pg_get_constraintdef(oid) as def from pg_constraint
                     where conrelid='geo.project_source_geometry'::regclass and contype='c'
                     order by conname;""", "constraints before"):
        say("  " + r["conname"], r["def"])
    print("\n--- applying the minimum schema change ---")
    for r in sql(MIGRATION_SQL, "migration"):
        say("  " + r["conname"], r["def"])
    controls("post-migration")

    before = sql("""select recovery_outcome, count(*) as rows,
                           count(distinct source_key) as candidates
                      from geo.project_source_geometry
                     group by 1 order by 1;""", "b3 state before")
    for r in before:
        say(f"  before · {r['recovery_outcome']}", f"{r['rows']} rows / {r['candidates']} candidates")

    todo = sql("""select source_key from geo.project_source_geometry
                   where registry_id = 'nvdot-project-boundaries'
                     and recovery_outcome = 'not_attempted'
                   order by source_key collate "C";""", "nvdot todo")
    keys = [r["source_key"] for r in todo]
    say("NVDOT candidates to attempt", f"{len(keys):,}")
    if not keys:
        say("nothing to do", "no not_attempted NVDOT candidates remain")
        return 0

    meta = layer_meta(cfg["url"])
    src_crs = f"wkid {meta['wkid']} / latestWkid {meta['latestWkid']}"
    say("layer geometryType / SR", f"{meta['geometryType']} / {src_crs}")
    if str(meta["wkid"]) != "26911":
        raise SystemExit(f"STOP: NVDOT source CRS is now {meta['wkid']}, not the recorded 26911")
    transformation = (f"publisher server outSR={REQUEST_OUT_SR}; "
                      f"ST_Transform({REQUEST_OUT_SR} -> {CANONICAL_SRID}) in database")

    real_field, ftype, use_quote = resolve_case_binding(
        cfg["url"], meta, cfg["case_field"], [case_of(k, reg) for k in keys[:NVDOT_BATCH]])
    say("case binding", f"{real_field} ({ftype}) quoted={use_quote}")
    if use_quote is None:
        raise SystemExit("STOP: no working literal form for NVDOT; nothing would be recovered")

    policy = (f"bounded: timeout {NVDOT_TIMEOUT}s, 3 attempts, backoff "
              f"{'/'.join(str(b) for b in NVDOT_BACKOFF)}s, batch {NVDOT_BATCH}, concurrency 1")
    say("retry policy", policy)

    dead_streak, attempted, written = 0, 0, 0
    invalid_seen = []
    for i in range(0, len(keys), NVDOT_BATCH):
        chunk = keys[i:i + NVDOT_BATCH]
        cases = [case_of(k, reg) for k in chunk]
        say(f"batch {i // NVDOT_BATCH + 1}", f"{len(chunk)} candidates")
        time.sleep(POLITE)
        feats, failure = fetch_bounded(cfg["url"], real_field, meta["objectIdField"],
                                       cases, use_quote, NVDOT_TIMEOUT, NVDOT_BACKOFF)
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        attempted += len(chunk)
        rows = []

        if feats is None:
            dead_streak += 1
            say("  batch outcome", f"source unavailable after bounded retries ({failure[:90]})")
            for k in chunk:
                rows.append({
                    "geometry_instance_key": k + "#none", "source_key": k, "registry_id": reg,
                    "geom_origin": "unreachable", "recovery_outcome": "source_unreachable",
                    "source_crs": src_crs, "requested_out_sr": str(REQUEST_OUT_SR),
                    "source_url": cfg["url"], "fetched_at": ts,
                    "request_basis": f"{policy} · every attempt failed: {failure[:160]}",
                })
            written += flush_nvdot(rows, chunk)
            if dead_streak >= NVDOT_MAX_DEAD_BATCHES:
                say("STOPPING EARLY",
                    f"{dead_streak} consecutive batches failed every bounded attempt")
                break
            controls(f"nvdot batch {i // NVDOT_BATCH + 1}")
            continue

        dead_streak = 0
        got, to_screen = {}, []
        for f in feats:
            a = f.get("attributes") or {}
            oid = str(a.get(meta["objectIdField"]))
            wkt, kind = geom_to_wkt(f.get("geometry"))
            idx = len(to_screen)
            if wkt:
                to_screen.append((idx, wkt))
            got.setdefault(str(a.get(real_field)), []).append(
                (oid, wkt, kind, idx if wkt else None))
        screened = screen_validity(to_screen) if to_screen else {}
        basis = (f"{real_field} IN (<{len(cases)} case numbers>, quoted={use_quote})"
                 f" · no spatial filter · {policy}")
        n_rec = n_nofeat = n_nogeom = n_invalid = 0
        for k, case in zip(chunk, cases):
            hits = got.get(str(case)) or []
            if not hits:
                n_nofeat += 1
                rows.append({
                    "geometry_instance_key": k + "#none", "source_key": k, "registry_id": reg,
                    "geom_origin": "not_applicable", "recovery_outcome": "no_feature_returned",
                    "source_crs": src_crs, "requested_out_sr": str(REQUEST_OUT_SR),
                    "source_url": cfg["url"], "request_basis": basis, "fetched_at": ts,
                })
                continue
            for oid, wkt, kind, idx in hits:
                if not wkt:
                    n_nogeom += 1
                    rows.append({
                        "geometry_instance_key": f"{k}#f:{oid}", "source_key": k,
                        "registry_id": reg, "source_feature_id": oid,
                        "geom_origin": "not_applicable",
                        "recovery_outcome": "feature_has_no_geometry",
                        "source_crs": src_crs, "requested_out_sr": str(REQUEST_OUT_SR),
                        "source_url": cfg["url"], "request_basis": basis, "fetched_at": ts,
                    })
                    continue
                v = screened.get(idx) or {}
                if not v.get("v4269") or not v.get("v4326"):
                    # The publisher HAS this feature and it HAS geometry; the geometry
                    # is simply not valid. Storing it, repairing it, or substituting a
                    # point for it would each be false in a different way.
                    n_invalid += 1
                    rows.append({
                        "geometry_instance_key": f"{k}#f:{oid}", "source_key": k,
                        "registry_id": reg, "source_feature_id": oid,
                        "geom_origin": "not_applicable",
                        "recovery_outcome": "feature_geometry_invalid",
                        "validity_reason": (f"EPSG:4326 valid={v.get('v4326')} "
                                            f"reason={v.get('r4326')} · "
                                            f"EPSG:4269 valid={v.get('v4269')} "
                                            f"reason={v.get('r4269')}"),
                        "source_crs": src_crs, "requested_out_sr": str(REQUEST_OUT_SR),
                        "source_url": cfg["url"], "request_basis": basis, "fetched_at": ts,
                    })
                    invalid_seen.append({"source_key": k, "oid": oid, "kind": kind,
                                         "v4326": v.get("v4326"), "r4326": v.get("r4326"),
                                         "v4269": v.get("v4269"), "r4269": v.get("r4269"),
                                         "wkt_len": len(wkt)})
                    continue
                n_rec += 1
                rows.append({
                    "geometry_instance_key": f"{k}#f:{oid}", "source_key": k,
                    "registry_id": reg, "source_feature_id": oid, "wkt": wkt,
                    "geom_kind": kind, "source_geometry_type": meta["geometryType"],
                    "geom_origin": "source_supplied", "recovery_outcome": "recovered",
                    "source_crs": src_crs, "requested_out_sr": str(REQUEST_OUT_SR),
                    "transformation": transformation, "source_url": cfg["url"],
                    "request_basis": basis, "fetched_at": ts,
                })
        say("  batch outcome",
            f"{len(feats)} features · recovered {n_rec} · no feature {n_nofeat} · "
            f"no geometry {n_nogeom} · invalid geometry {n_invalid}")
        written += flush_nvdot(rows, chunk)
        controls(f"nvdot batch {i // NVDOT_BATCH + 1}")

    if invalid_seen:
        print("\n===== INVALID-GEOMETRY INVESTIGATION (evidence only, nothing repaired)")
        for inv in invalid_seen:
            print(f"\n  candidate        {inv['source_key']}")
            say("  publisher OBJECTID", inv["oid"])
            say("  publisher geom type", f"{meta['geometryType']} -> {inv['kind']}")
            say("  publisher CRS", src_crs)
            say("  valid in EPSG:4326", f"{inv['v4326']} · {inv['r4326']}")
            say("  valid in EPSG:4269", f"{inv['v4269']} · {inv['r4269']}")

            # item 5 - is it already invalid in the publisher's OWN projection?
            case = case_of(inv["source_key"], reg)
            time.sleep(POLITE)
            try:
                native = fetch_by_cases(cfg["url"], real_field, meta["objectIdField"],
                                        [case], quote=use_quote, timeout=NVDOT_TIMEOUT)
            except SystemExit as e:
                native = None
                say("  native-CRS refetch", f"failed: {str(e)[:120]}")
            if native is not None:
                nat = None
                for f in native:
                    if str((f.get("attributes") or {}).get(meta["objectIdField"])) == inv["oid"]:
                        nat = f
                if nat is None:
                    say("  repeat fetch", "feature NOT returned on repeat")
                else:
                    w2, _k2 = geom_to_wkt(nat.get("geometry"))
                    say("  repeat fetch",
                        "identical geometry" if w2 and len(w2) == inv["wkt_len"]
                        else f"differs (len {len(w2) if w2 else 0} vs {inv['wkt_len']})")

            other = sql(f"""select count(*) as n from geo.project_source_geometry
                             where source_key = {q(inv['source_key'])}
                               and recovery_outcome = 'recovered';""", "sibling check")
            say("  other VALID instances", other[0]["n"] if other else "?")
        print()

    if isolated_failures:
        print("===== CANDIDATES REFUSED EVEN IN A ONE-CANDIDATE TRANSACTION")
        for f in isolated_failures:
            say("  " + f["source_key"], f["error"][:180])
        print()

    say("candidates attempted", f"{attempted:,}")
    say("rows written", f"{written:,}")
    controls("post-write")
    full_fingerprint("post-write")

    after = sql("""select recovery_outcome, count(*) as rows,
                          count(distinct source_key) as candidates
                     from geo.project_source_geometry
                    group by 1 order by 1;""", "b3 state after")
    for r in after:
        say(f"  after · {r['recovery_outcome']}", f"{r['rows']} rows / {r['candidates']} candidates")
    return 0


def invalid_probe():
    """Read-only. Answers the one question the completion run could not: is the
    geometry already invalid in the publisher's OWN projection, before any transform?

    The completion run re-fetched at outSR=4326 - the same projection it had already
    used - so it tested repeat-fetch stability, not native validity. This asks the
    publisher for EPSG:26911 and validates the rings there. Nothing is written and
    nothing is altered.

    It selects by OBJECTID, not by case number. The OBJECTID is the exact feature
    identity already recorded for each invalid instance, so no case-field binding
    has to be resolved and a "not returned" cannot be an artefact of the wrong
    literal quoting. Every fetch is preceded by a positive control on the same
    endpoint, because a silent zero and a broken instrument look identical."""
    reg = "nvdot-project-boundaries"
    cfg = LAYERS[reg]
    rows = sql("""select source_key, source_feature_id, validity_reason
                    from geo.project_source_geometry
                   where recovery_outcome = 'feature_geometry_invalid'
                   order by source_key collate "C";""", "invalid list")
    say("invalid features on record", len(rows))
    if not rows:
        return 0

    meta = layer_meta(cfg["url"])
    oid_f = meta["objectIdField"]
    say("layer declared SR", f"wkid {meta['wkid']} / latestWkid {meta['latestWkid']}")
    say("objectIdField", f"{oid_f} ({meta['fields'].get(oid_f)})")

    cnt, raw = total_count(cfg["url"])
    say("POSITIVE CONTROL where=1=1", f"count={cnt}" if cnt is not None else raw)
    if not cnt:
        raise SystemExit("STOP: endpoint control failed - a zero below would be "
                         "the instrument, not the publisher")

    oids = [r["source_feature_id"] for r in rows]
    where = "{} IN ({})".format(oid_f, ",".join(str(int(o)) for o in oids))
    say("selector", where)

    for out_sr in (26911, 4326):
        print(f"\n########## outSR {out_sr}", flush=True)
        time.sleep(POLITE)
        j = post(qurl(cfg["url"]), {
            "where": where, "outFields": f"{oid_f},{cfg['case_field']}",
            "returnGeometry": "true", "outSR": str(out_sr), "f": "json"},
            timeout=NVDOT_TIMEOUT)
        if "error" in j:
            say(f"  outSR {out_sr}", "SOURCE ERROR " + json.dumps(j["error"])[:300])
            continue
        feats = j.get("features") or []
        sr_back = ((j.get("spatialReference") or {}).get("latestWkid")
                   or (j.get("spatialReference") or {}).get("wkid"))
        say("  features returned", f"{len(feats)} of {len(oids)} requested")
        say("  SR the server actually returned", sr_back)
        by_oid = {}
        for f in feats:
            by_oid[str((f.get("attributes") or {}).get(oid_f))] = f
        for r in rows:
            f = by_oid.get(str(r["source_feature_id"]))
            tag = f"  {r['source_key']} oid {r['source_feature_id']}"
            if f is None:
                say(tag, "feature not returned")
                continue
            wkt, kind = geom_to_wkt(f.get("geometry"))
            if not wkt:
                say(tag, "returned without geometry")
                continue
            chk = sql("select ST_IsValid(g) as ok, ST_IsValidReason(g) as why,"
                      " ST_NPoints(g) as n from (select ST_GeomFromText($w$" + wkt +
                      "$w$, " + str(sr_back or out_sr) + ") as g) q;",
                      f"validate {out_sr}")[0]
            say(tag, f"{kind} · {chk['n']} vertices · valid={chk['ok']} · {chk['why']}")
    print("\nINVALID-GEOMETRY PROBE COMPLETE - nothing written, nothing altered.")
    return 0


def main():
    mode = os.environ.get("MODE", "").strip()
    say("mode", mode)
    if mode not in ("b3-probe", "b3-load", "b3-nvdot", "b3-invalid-probe"):
        raise SystemExit("MODE must be b3-probe, b3-load, b3-nvdot or b3-invalid-probe")
    cands = load_candidates()
    if len(cands) != 9571:
        raise SystemExit(f"STOP: candidate universe drifted - {len(cands)} != 9,571")
    if mode == "b3-probe":
        probe(cands)
    elif mode == "b3-nvdot":
        nvdot_complete()
    elif mode == "b3-invalid-probe":
        invalid_probe()
    else:
        recover(cands)
    return 0


if __name__ == "__main__":
    sys.exit(main())
