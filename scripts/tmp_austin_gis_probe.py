#!/usr/bin/env python3
# TEMPORARY read-only probe. Public GET only. Isolated PostGIS service container (no production database).
import json, subprocess, sys, urllib.parse, urllib.request

UA = {'User-Agent': 'HomeSignal-readonly-probe/1.0 (contact: hello@homesignal.net)'}
L1 = 'https://maps.austintexas.gov/gis/rest/Shared/ReviewCases/MapServer/6'
L2 = 'https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/PLANNINGCADASTRE_site_plan_case/FeatureServer/0'
CASES = [  # name, case, folder, stored publisher point (lng, lat) from app_projects/n5 fixture
    ('Lightsey Residences', 'SP-2026-0279C', '13765505', (-97.77712356, 30.23963078)),
    ('Del Curto Multifamily Condos', 'SP-2026-0102CSL', '13680604', (-97.77761596, 30.24352679)),
    ('South Lamar Blvd Street and Utility Improvements Plan', 'SP-2026-0155D', '13709897', (-97.78188099, 30.24429006)),
]
SUBJECT = (-97.77712356, 30.246147796654597)  # the constructed control subject used in acceptance

def get(url, cap=4000, quiet=False):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60)
        b = r.read().decode('utf-8', 'replace')
        if not quiet:
            print('GET %s -> %s (%d bytes)' % (url[:200], r.status, len(b)))
        return r.status, b
    except Exception as e:
        print('GET %s -> ERROR %r' % (url[:200], e))
        return None, ''

def q(base, where, fmt='geojson'):
    p = {'where': where, 'outFields': '*', 'returnGeometry': 'true', 'outSR': '4326', 'f': fmt}
    return get(base + '/query?' + urllib.parse.urlencode(p))

print('===== LAYER METADATA =====')
for name, base in (('L1 ReviewCases/6', L1), ('L2 PLANNINGCADASTRE/0', L2)):
    s, b = get(base + '?f=json')
    try:
        j = json.loads(b)
        print(name, 'name=', j.get('name'), 'type=', j.get('type'), 'geometryType=', j.get('geometryType'))
        print('  copyrightText=', repr(j.get('copyrightText')))
        print('  description=', repr((j.get('description') or '')[:600]))
        print('  serviceItemId=', j.get('serviceItemId'), ' editFieldsInfo=', j.get('editFieldsInfo'))
        print('  fields=', [(f['name'], f['type']) for f in j.get('fields', [])])
    except Exception as e:
        print(name, 'metadata not JSON:', repr(e), b[:300])

features = {}  # (layer, case) -> geojson geometry + props
print('\n===== CASE QUERIES (exact CASE_NUMBER, then exact FOLDERRSN, then LIKE fallback) =====')
for layer, base in (('L1', L1), ('L2', L2)):
    for name, case, folder, pt in CASES:
        hit = None
        for label, where in (('CASE_NUMBER', "CASE_NUMBER='%s'" % case), ('FOLDERRSN str', "FOLDERRSN='%s'" % folder), ('FOLDERRSN num', 'FOLDERRSN=%s' % folder), ('LIKE', "CASE_NUMBER LIKE '%%%s%%'" % case[3:])):
            s, b = q(base, where)
            try:
                j = json.loads(b)
            except Exception:
                j = {}
            n = len(j.get('features', [])) if isinstance(j, dict) else 0
            print('  [%s] %s | %s -> %d feature(s)%s' % (layer, case, label, n, ' ERROR ' + json.dumps(j.get('error')) if isinstance(j, dict) and j.get('error') else ''))
            if n:
                hit = (label, j)
                break
        if not hit:
            print('  [%s] %s: NO MATCHING POLYGON RETURNED by any exact predicate' % (layer, case))
            continue
        label, j = hit
        for i, f in enumerate(j['features']):
            print('  [%s] %s match #%d via %s: properties=%s' % (layer, case, i, label, json.dumps(f.get('properties'), default=str)[:1500]))
            g = f.get('geometry')
            print('     geometry type=%s, first 400 chars=%s' % (g and g.get('type'), json.dumps(g)[:400]))
            if g:
                features[(layer, case, i)] = (name, folder, pt, f)

print('\n===== POSTGIS COMPARISON (isolated container; same expression shape as n5_projects_within_radius: 4269 -> 4326 geography, metres/1609.344) =====')

def psql(sql):
    r = subprocess.run(['psql', '-h', 'localhost', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-F', ' | ', '-c', sql], capture_output=True, text=True)
    return r.stdout + r.stderr

print(psql('select postgis_full_version()')[:300])
subj = 'st_setsrid(st_makepoint(%s,%s),4326)' % SUBJECT
for (layer, case, i), (name, folder, pt, f) in features.items():
    gj = json.dumps(f['geometry']).replace("'", "''")
    g = "st_transform(st_transform(st_setsrid(st_geomfromgeojson('%s'),4326),4269),4326)" % gj
    stored = 'st_setsrid(st_makepoint(%s,%s),4326)' % pt
    sql = ("select '%s' lyr, '%s' casen, %d feat, st_geometrytype(%s) gtype, st_isvalid(%s) valid, "
           "round(st_area(%s::geography)::numeric,0) area_m2, "
           "round((st_distance(%s::geography,%s::geography)/1609.344)::numeric,4) subject_to_polygon_mi, "
           "st_dwithin(%s::geography,%s::geography,0.5*1609.344) polygon_within_half_mile, "
           "round((st_distance(%s::geography,%s::geography)/1609.344)::numeric,4) subject_to_stored_point_mi, "
           "st_dwithin(%s::geography,%s::geography,0.5*1609.344) stored_within_half_mile, "
           "st_covers(%s,%s) stored_point_inside_polygon, "
           "round(st_distance(%s::geography,%s::geography)::numeric,1) stored_point_to_polygon_m, "
           "round(st_distance(st_centroid(%s)::geography,%s::geography)::numeric,1) polygon_centroid_to_stored_m"
           % (layer, case, i, g, g, g, g, subj, g, subj, stored, subj, stored, subj, g, stored, g, stored, g, stored))
    print(name, '|', psql(sql).strip())

print('\n===== SOURCE TERMS / ATTRIBUTION =====')
for u in ('https://data.austintexas.gov/api/views/mavg-96ck.json',):
    s, b = get(u, quiet=True)
    try:
        j = json.loads(b)
        print('Socrata mavg-96ck: license=', json.dumps(j.get('license')), 'attribution=', j.get('attribution'), 'attributionLink=', j.get('attributionLink'), 'licenseId=', j.get('licenseId'))
    except Exception as e:
        print('Socrata metadata not JSON', repr(e))
for u in ('https://data.austintexas.gov/stories/s/Open-Data-Terms-of-Use/ranj-cccq/', 'https://www.austintexas.gov/page/open-data-terms-use', 'https://data.austintexas.gov/', 'https://maps.austintexas.gov/gis/rest/Shared/ReviewCases/MapServer?f=json'):
    s, b = get(u, quiet=True)
    import re
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', b, flags=re.S)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    print('TERMS CANDIDATE', u, '->', s, 'len', len(b))
    for m in re.finditer(r'(?i)(terms of use|attribution|commercial|license|disclaimer)', t):
        a = max(0, m.start() - 150)
        print('   ...', t[a:m.start() + 350])
        break
    if 'MapServer?f=json' in u:
        try:
            j = json.loads(b)
            print('   service copyright=', repr(j.get('copyrightText')), 'description=', repr((j.get('serviceDescription') or '')[:500]))
        except Exception:
            pass
for base in (L2.rsplit('/', 1)[0] + '?f=json',):
    s, b = get(base)
    try:
        j = json.loads(b)
        print('FeatureServer copyright=', repr(j.get('copyrightText')), 'serviceDescription=', repr((j.get('serviceDescription') or '')[:500]), 'itemId=', j.get('serviceItemId'))
        iid = j.get('serviceItemId')
        if iid:
            s2, b2 = get('https://www.arcgis.com/sharing/rest/content/items/%s?f=json' % iid)
            j2 = json.loads(b2)
            print('AGO item: title=', j2.get('title'), 'owner=', j2.get('owner'), 'accessInformation=', repr(j2.get('accessInformation')), 'licenseInfo=', repr((j2.get('licenseInfo') or '')[:1500]), 'modified=', j2.get('modified'))
    except Exception as e:
        print('FeatureServer root metadata error', repr(e))
print('\nDONE')
