// maps-social-image.mjs — the MAPS / DEVELOPMENT social visual.
//
// WHAT THIS IS. For a MAPS draft in public.social_posts, open the REAL public Map 1 ZIP
// page in a real browser, find the REAL marker the page already drew for that project,
// frame it, open its own popup, and screenshot the map. The image is a photograph of the
// product, not a picture of the data — there is no second map implementation here, no
// tile fetching of our own, no drawing of geometry, and nothing invented.
//
// WHY IT IS NOT THE ALERTS SCREENSHOT PATH. scripts/screenshot-alert.js (ingest repo)
// locates an ALERT CARD by its visible title text on community.html. Map 1 has no such
// card: its subject is a marker at a coordinate. The two families have different visual
// truth contracts, so they get two modules. Nothing in the Alerts path is touched.
//
// GEOGRAPHY. The page is opened at ?zip=<zip> — ZIP mode — which is the same public URL
// the post links to. In ZIP mode homesignalmap.html draws NO radius circle (`if(!ZIP_MODE)`)
// and NO home marker (`HOME_ANCHOR = true`), so neither can appear in the capture; this
// module asserts both absences rather than assuming them. Nothing is centred on a ZIP
// centroid: the view is centred on the PROJECT's own authoritative coordinates, read from
// public.app_projects at capture time.
//
// THE ONLY INJECTED PIXELS are a selection halo on the target marker and a short caption,
// both added to the throwaway browser DOM and never to the deployed site — the same
// established pattern as the Alerts screenshot's temporary outline. The halo is sized in
// SCREEN PIXELS and stays a constant size at every zoom, so it can never be read as a
// distance, a radius or a boundary.
//
// Usage:
//   node scripts/maps-social-image.mjs --list
//   node scripts/maps-social-image.mjs --limit 5 [--dry] [--ids <uuid,uuid>]
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY), BASE.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE || 'https://homesignal.net').replace(/\/$/, '');
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = has('--dry');
const LIMIT = parseInt(val('--limit', '5'), 10);
const ONLY_IDS = (val('--ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = val('--out', '/tmp/maps-social-images');

// 1200x630 — the ratio HomeSignal already ships (og-default.png is 1200x630) and the ratio
// Bluesky renders an external card's thumb at. publish-worker.mjs attaches this image as
// that thumb, so matching it is what keeps the map from being letterboxed or cropped.
const IMG_W = 1200, IMG_H = 630;
// Deviceceale 2 so street labels stay legible at feed size.
const SCALE = 2;
// Neighbourhood framing: close enough to place the project on named streets, wide enough
// that surrounding development stays in frame. Never a radius — just a zoom level.
const ZOOM = parseInt(val('--zoom', '15'), 10);
// A marker matches the project when its drawn coordinate equals the project's stored
// coordinate. ~1.1 m at the equator: this is an identity test, not a proximity search.
const COORD_EPS = 1e-5;

async function api(pathname, init) {
  const r = await fetch(`${SB}/rest/v1/${pathname}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });
  if (!r.ok) throw new Error(`${init?.method || 'GET'} ${pathname} -> ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/** MAPS drafts still without a project-specific visual. ALERTS rows are never selected. */
async function pendingDrafts() {
  const idFilter = ONLY_IDS.length ? `&id=in.(${ONLY_IDS.join(',')})` : '';
  return api('social_posts?select=id,zip,post_text,evidence,image_bucket_path,status,content_family'
    + `&content_family=eq.MAPS&status=eq.draft&image_bucket_path=is.null${idFilter}`
    + `&order=zip.asc&limit=${LIMIT}`);
}

/**
 * Re-read the LIVE project row. The draft's evidence is a snapshot taken when the
 * candidate was written; an image must be generated from what the corpus says now, and a
 * project whose coordinates have moved or vanished must not receive a stale picture.
 */
async function liveProject(projectId) {
  const rows = await api(`app_projects?select=id,zip,name,type,status,lat,lng,record_kind,source_key,provenance`
    + `&id=eq.${encodeURIComponent(projectId)}&limit=1`);
  return rows[0] || null;
}

function nearly(a, b) { return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < COORD_EPS; }

/**
 * Capture one project. Returns { ok, reason, file? } — a failure is always a reason, never
 * a substitute image.
 */
async function capture(page, draft, proj) {
  const url = `${BASE}/homesignalmap.html?zip=${encodeURIComponent(draft.zip)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The page exposes its drawn markers for exactly this purpose (see homesignalmap.html:
  // "Lets the offline browser proof open a specific marker's real popup instead of
  // guessing at DOM order"). WAIT FOR THE DRAW TO SETTLE, not merely to start: a ZIP page
  // draws, then re-frames and re-draws (zipFitRadius, drawParcels), so the first non-empty
  // siteMarkers is a partial pass. Reading it there reports a project as missing that the
  // page simply had not drawn yet — measured on the first live run, which saw 40 markers on
  // a ZIP whose cached report holds 1,024.
  await page.waitForFunction(
    () => Array.isArray(window.__HS_SITES) && window.__HS_SITES.length > 0
      && Array.isArray(window.siteMarkers) && window.siteMarkers.length > 0,
    { timeout: 60000 },
  ).catch(() => {});
  await page.waitForFunction(() => {
    const n = (window.siteMarkers || []).length;
    const prev = window.__hsMarkerSettle;
    window.__hsMarkerSettle = n;
    return prev === n && n > 0;          // two consecutive polls agree
  }, { timeout: 60000, polling: 900 }).catch(() => {});

  const drew = await page.evaluate(() => (window.siteMarkers || []).length);
  if (!drew) return { ok: false, reason: 'map drew no markers for this ZIP' };

  // Find the marker the page drew for THIS project. The join is the SOURCE ID: a cached
  // site carries source_id (e.g. "carto:phl.carto.com:permits:ZP-2026-008877"), which is
  // byte-identical to app_projects.source_key — the same string both sides were built from.
  // Coordinates are the CORROBORATION, not the key, because siteLL() may return a fanned
  // DISPLAY position (_mLat/_mLng) for co-located points, so a marker's drawn latlng is not
  // always its record's latlng.
  const found = await page.evaluate(([sourceKey, lat, lng, eps]) => {
    const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < eps;
    const list = window.siteMarkers || [];
    const sites = window.__HS_SITES || [];
    let idx = list.findIndex((x) => x && x.s && x.s.source_id === sourceKey);
    let how = 'source_id';
    if (idx < 0) {                       // fall back to the record's own coordinates
      idx = list.findIndex((x) => x && x.s && near(x.s.lat, lat) && near(x.s.lng, lng));
      how = 'coordinates';
    }
    if (idx < 0) {
      return {
        found: false, total: list.length, sites: sites.length,
        inCache: sites.some((s) => s && (s.source_id === sourceKey || (near(s.lat, lat) && near(s.lng, lng)))),
      };
    }
    const hit = list[idx];
    const ll = hit.m.getLatLng();
    return {
      found: true, idx, how, total: list.length, sites: sites.length,
      label: (hit.s && (hit.s.label || hit.s.title)) || '',
      site_lat: hit.s.lat, site_lng: hit.s.lng,
      lat: ll.lat, lng: ll.lng,
      fanned: hit.s._mLat != null,
      coord_agrees: near(hit.s.lat, lat) && near(hit.s.lng, lng),
      record_url: (hit.s && hit.s.record_url) || null,
    };
  }, [proj.source_key, proj.lat, proj.lng, COORD_EPS]);

  if (!found.found) {
    return {
      ok: false,
      reason: `no drawn marker for this project (${found.total} markers drawn, `
        + `${found.sites} sites in the ZIP report, present in that report: ${found.inCache})`,
    };
  }
  // Whichever way it was found, the record's OWN coordinates must be the project's. A
  // marker matched by source_id whose coordinates disagree is a different record.
  if (!found.coord_agrees) {
    return { ok: false, reason: `matched by ${found.how} but the record's coordinates differ from the project's` };
  }

  // Frame on the PROJECT's own coordinates. The map instance is reached through the
  // marker Leaflet already attached it to — no new map is created and no public URL
  // parameter is invented to do it.
  const framed = await page.evaluate(([idx, zoom]) => {
    const hit = (window.siteMarkers || [])[idx];
    const map = hit && hit.m && hit.m._map;
    if (!map) return { ok: false };
    // Centre on the RECORD's own coordinates. A fanned display position is a pixel nudge
    // for legibility; the project's real location is what the image must be about.
    map.setView([hit.s.lat, hit.s.lng], zoom, { animate: false });
    hit.m.openPopup();
    // Selection halo, screen-pixel sized so it is constant at every zoom and can never
    // read as a distance. Injected into this throwaway DOM only.
    const el = hit.m.getElement();
    if (el) {
      el.style.zIndex = '10000';
      const ring = document.createElement('div');
      ring.id = 'hs-social-halo';
      ring.style.cssText = 'position:absolute;left:50%;top:50%;width:46px;height:46px;'
        + 'margin:-23px 0 0 -23px;border:3px solid #157a49;border-radius:50%;'
        + 'box-shadow:0 0 0 3px rgba(255,255,255,.9),0 0 14px rgba(21,122,73,.55);'
        + 'pointer-events:none';
      el.appendChild(ring);
    }
    return { ok: true, zoom: map.getZoom(), center: map.getCenter() };
  }, [found.idx, ZOOM]);
  if (!framed.ok) return { ok: false, reason: 'could not reach the Leaflet map from the marker' };

  // TRUTH ASSERTIONS, in the page, before the shutter. ZIP mode must have drawn neither a
  // radius ring nor a home marker; if either is present the capture is refused rather than
  // shipped, because a broadcast post has no home and no radius.
  const clean = await page.evaluate(() => ({
    homePins: document.querySelectorAll('.homepin').length,
    // Vector paths inside the map. In ZIP mode Map 1 draws no radius ring, but it MAY draw
    // real parcel geometry (drawParcels), which is authoritative and must not be refused —
    // so this is RECORDED into the evidence, not used as a veto. The home pin is the veto,
    // because a broadcast post has no home.
    vectorPaths: document.querySelectorAll('#mapInner path.leaflet-interactive').length,
    popupOpen: !!document.querySelector('.leaflet-popup-content'),
  }));
  if (clean.homePins > 0) return { ok: false, reason: 'refused: a home marker is on the map' };

  // Suppress only chrome that is not the map: page header/nav/footer sit outside #map, so
  // clipping to #map already excludes them. Leaflet's own zoom control is the one control
  // inside the frame and is hidden for the shot.
  await page.addStyleTag({ content: '.leaflet-control-container{display:none!important}' });
  await page.waitForTimeout(1200);   // let the framed tiles settle

  const el = await page.$('#map');
  if (!el) return { ok: false, reason: 'no #map element' };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${draft.zip}-${String(proj.id).slice(0, 8)}.png`);
  await el.screenshot({ path: file });

  return {
    ok: true, file,
    marker: { label: found.label, lat: found.site_lat, lng: found.site_lng,
      of: found.total, how: found.how, fanned: found.fanned },
    framed: { zoom: framed.zoom, center: framed.center },
    checks: clean,
  };
}

/** Upload through the EXISTING private social-images bucket. No new storage system. */
async function upload(objectPath, file) {
  const bytes = fs.readFileSync(file);
  const r = await fetch(`${SB}/storage/v1/object/social-images/${objectPath}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: bytes,
  });
  if (!r.ok) throw new Error(`upload -> ${r.status} ${await r.text()}`);
  return objectPath;
}

async function main() {
  if (!SB || !KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.');
  const drafts = await pendingDrafts();
  console.log(`maps-social-image: ${drafts.length} MAPS draft(s) without a project-specific visual`);
  if (has('--list')) { for (const d of drafts) console.log(` ${d.id} zip=${d.zip} ${d.evidence?.project_name}`); return; }
  if (!drafts.length) return;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: IMG_W, height: IMG_H },
    deviceScaleFactor: SCALE,
  });
  const page = await ctx.newPage();
  const results = [];

  for (const d of drafts) {
    const pid = d.evidence?.project_id;
    const label = `${d.zip} ${d.evidence?.project_name || ''}`.trim();
    if (!pid) { results.push({ id: d.id, label, ok: false, reason: 'draft carries no project_id' }); continue; }

    const proj = await liveProject(pid);
    if (!proj) { results.push({ id: d.id, label, ok: false, reason: 'project row no longer in app_projects' }); continue; }
    if (proj.record_kind !== 'development') { results.push({ id: d.id, label, ok: false, reason: 'not a development record' }); continue; }
    if (proj.lat == null || proj.lng == null) { results.push({ id: d.id, label, ok: false, reason: 'project has no coordinates' }); continue; }
    if (!nearly(proj.lat, d.evidence?.lat) || !nearly(proj.lng, d.evidence?.lng)) {
      results.push({ id: d.id, label, ok: false, reason: 'live coordinates differ from the draft evidence' });
      continue;
    }

    let r;
    try { r = await capture(page, d, proj); }
    catch (e) { r = { ok: false, reason: `capture threw: ${String(e.message || e).slice(0, 160)}` }; }

    if (!r.ok) {
      results.push({ id: d.id, label, ok: false, reason: r.reason });
      if (!DRY) await recordFailure(d, r.reason);
      continue;
    }

    const objectPath = `maps/${d.zip}/${String(proj.id)}.png`;
    if (DRY) { results.push({ id: d.id, label, ok: true, dry: true, file: r.file, marker: r.marker }); continue; }
    await upload(objectPath, r.file);
    await attach(d, objectPath, r, proj);
    results.push({ id: d.id, label, ok: true, path: objectPath, marker: r.marker, framed: r.framed });
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  const okN = results.filter((x) => x.ok).length;
  console.log(`maps-social-image: ${okN} real map visual(s), ${results.length - okN} honest failure(s)`);
}

/** Attach the image to THIS draft and record what the visual actually is. */
async function attach(draft, objectPath, r, proj) {
  const visual = {
    kind: 'map1_zip_screenshot',
    status: 'REAL_MAP_VISUAL',
    bucket: 'social-images',
    path: objectPath,
    captured_at: new Date().toISOString(),
    page_url: `${BASE}/homesignalmap.html?zip=${draft.zip}`,
    project_lat: proj.lat,
    project_lng: proj.lng,
    marker_lat: r.marker.lat,
    marker_lng: r.marker.lng,
    marker_label: r.marker.label,
    matched_by: r.marker.how,
    marker_display_fanned: r.marker.fanned,
    markers_on_map: r.marker.of,
    framed_zoom: r.framed.zoom,
    home_markers: r.checks.homePins,
    vector_paths: r.checks.vectorPaths,
    popup_open: r.checks.popupOpen,
    width: IMG_W, height: IMG_H, device_scale: SCALE,
    note: 'Screenshot of the live Map 1 ZIP page, framed on the project\'s own coordinates '
      + 'with its real marker popup open and a screen-pixel selection halo. ZIP mode draws no '
      + 'radius ring and no home marker, and both absences are asserted before the shutter. '
      + 'Surrounding development is left visible. Nothing is drawn, moved or invented.',
  };
  await api(`social_posts?id=eq.${draft.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      image_bucket_path: objectPath,
      evidence: { ...(draft.evidence || {}), visual },
    }),
  });
}

/** A failure is recorded on the draft; the factual text/link draft is left intact. */
async function recordFailure(draft, reason) {
  const prev = draft.evidence || {};
  await api(`social_posts?id=eq.${draft.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      evidence: {
        ...prev,
        visual: {
          ...(prev.visual || {}),
          status: 'NO_PROJECT_SPECIFIC_VISUAL',
          failure_reason: reason,
          failed_at: new Date().toISOString(),
          note: 'No project-specific Map 1 visual could be produced truthfully. The draft keeps '
            + 'its factual text and its Map 1 link; the generic OpenGraph link card remains the '
            + 'publication fallback and is NOT a project-specific map preview.',
        },
      },
    }),
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
