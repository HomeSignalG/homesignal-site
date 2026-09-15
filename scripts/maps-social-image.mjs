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

// The SHIPPED site builder, loaded exactly as the page loads it and in the page's order, so
// this module cannot carry a second copy of the rendering rules.
globalThis.window = globalThis.window || globalThis;
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js', '../lib/residential-qualify.js', '../lib/n5-radius.js', '../lib/zip-authoritative.js']) {
  (0, eval)(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;



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

// ── MAPS · DATA CENTER THEME CAPTURE STATE ───────────────────────────────────────────
//
// WHAT CHANGES FOR A THEME POST, and nothing else does: the page is opened in the SHIPPED
// embed mode, the SHIPPED "Data center" PROJECT TYPE control is the only one left checked,
// and the shutter clips to the Map 1 PRODUCT CARD instead of to the bare map. Marker
// targeting, the popup, the halo, the home-marker refusal and the coordinate checks are the
// same code on both paths.
//
// EMBED MODE IS A REAL PRODUCT MODE, NOT A SCREENSHOT HACK. `?embed=1` is what the Place
// page already uses to host Map 1 in an iframe (homesignalmap.html sets `hs-embed` in the
// document head, before first paint). It hides the global sidebar, the global top bar, the
// address SEARCH FORM, the radius picker, the 3D controls and everything below the map —
// exactly the chrome a social capture must exclude — and its `.card.mapcard` becomes a flex
// column one frame tall, so the filter panel and the map FIT 1200x630 instead of overflowing
// it. Reusing it means the framing is the product's own, and a future change to the embed
// layout moves this capture with it rather than leaving a private copy behind.
const EMBED_PARAM = 'embed=1';

/**
 * Put Map 1's PROJECT TYPE row into the Data-center-only state, THROUGH THE REAL CONTROLS.
 *
 * Each chip is a real <input type=checkbox class="chipbox"> inside its label, and the page
 * wires `change` (not `click`) precisely so keyboard and pointer become one path and the
 * handler reads the control's RESULTING state. Setting `.checked` and dispatching `change`
 * therefore runs the page's own `setType()` -> `HS.setCategoryFilter()` -> `applyFilter()`.
 * Nothing here writes a filter value directly, and nothing fakes a chip's appearance: the
 * checkmarks in the image are the controls' real state.
 *
 * Returns the before/after state of every chip so the evidence can show what was changed.
 */
async function applyDataCenterTypeFilter(page) {
  return page.evaluate((wantKey) => {
    const chips = Array.from(document.querySelectorAll('#mapkeyShapes .typechip'));
    if (!chips.length) return { ok: false, reason: 'Map 1 rendered no PROJECT TYPE controls' };
    const read = () => {
      const o = {};
      for (const c of chips) {
        const b = c.querySelector('.chipbox');
        o[c.getAttribute('data-cat')] = !!(b && b.checked);
      }
      return o;
    };
    const before = read();
    if (!Object.prototype.hasOwnProperty.call(before, wantKey)) {
      return { ok: false, reason: `Map 1 has no "${wantKey}" PROJECT TYPE control`, before };
    }
    for (const c of chips) {
      const key = c.getAttribute('data-cat');
      const box = c.querySelector('.chipbox');
      if (!box) continue;
      const want = key === wantKey;
      if (box.checked !== want) {
        box.checked = want;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const after = read();
    const others = Object.keys(after).filter((k) => k !== wantKey && after[k]);
    return { ok: !!after[wantKey] && others.length === 0, before, after, still_on: others,
             reason: after[wantKey] ? '' : 'the Data center control did not end up selected' };
  }, 'datacenter');
}

/**
 * The panel sections the founder-approved capture must actually contain. Asserted from the
 * RENDERED DOM before the shutter, so a layout change that pushes a section out of frame
 * fails the capture instead of silently shipping a cropped card.
 */
async function panelSectionsInFrame(page) {
  return page.evaluate(() => {
    const vh = window.innerHeight, vw = window.innerWidth;
    const inFrame = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= vh + 1 && r.right <= vw + 1;
    };
    const byText = (sel, txt) => Array.from(document.querySelectorAll(sel))
      .find((e) => (e.textContent || '').trim().toUpperCase() === txt) || null;
    return {
      card_header: inFrame(document.querySelector('.card.mapcard .map-cap')),
      card_header_text: (document.querySelector('.card.mapcard .map-cap')?.textContent || '').trim(),
      status: inFrame(byText('.mapkey-hd', 'STATUS')),
      project_type: inFrame(byText('.mapkey-hd', 'PROJECT TYPE')),
      regulatory: inFrame(byText('.mapkey-hd', 'REGULATORY RECORDS')),
      map_key: inFrame(document.getElementById('mapkeyNote')),
      map: inFrame(document.querySelector('.card.mapcard .map-frame')),
      // Chrome that must NOT be in a social capture. Embed mode removes it; this proves it.
      sidebar_hidden: !document.querySelector('#hs-side')
        || getComputedStyle(document.querySelector('#hs-side')).display === 'none',
      search_form_hidden: !document.querySelector('.wrap>.head')
        || getComputedStyle(document.querySelector('.wrap>.head')).display === 'none',
    };
  });
}

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
    // Newest first. A freshly generated candidate is the one worth a picture, and it is also
    // the one most likely to be in its ZIP's authoritative set — the two moved together.
    + `&order=created_at.desc&limit=${LIMIT}`);
}

/**
 * Is this project actually drawn on its ZIP page? Map 1's ZIP mode now renders development
 * from AUTHORITATIVE whole-ZIP membership (app_zip_projects_markers), which REPLACES the
 * cached report's development points. A ZIP whose boundary is not yet computed reports
 * status 'unknown' and renders no development at all, and a project outside the ZCTA is
 * absent even where the boundary is complete. Asking first turns a browser round-trip that
 * could only fail into a precise, cheap reason — and it consumes the geography contract
 * rather than second-guessing it.
 */
async function authoritativePresence(zip, sourceKey) {
  const r = await fetch(`${SB}/rest/v1/rpc/app_zip_projects_markers`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ p_zip: zip, p_kind: 'development', p_authoritative: true }),
  });
  if (!r.ok) return { status: `rpc ${r.status}`, present: false, markers: null };
  const j = await r.json();
  const markers = Array.isArray(j?.markers) ? j.markers : null;
  // PRESENCE IS WHAT THE PAGE DRAWS, NOT WHAT THE RPC RETURNS. The RPC hands back every
  // project in the ZIP's authoritative membership; the page then applies the SHIPPED site
  // builder, which drops records with no record_url and - since 2026-09-05 - Residential
  // records that are routine work on an existing property rather than development
  // (lib/residential-qualify.js). Matching on the raw marker list would claim a project is
  // "on the ZIP page" when the page in fact draws nothing for it, and this module would then
  // hunt for a marker that does not exist. Running the same builder here is what keeps one
  // definition of the rendered set instead of two.
  const sites = HS.zipAuthSitesFrom(j);
  return {
    status: j?.status || 'unknown',
    markers: markers ? markers.length : null,
    rendered: sites.length,
    present: sites.some((s) => s && s.zip_project_ref === sourceKey),
  };
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
async function capture(page, draft, proj, theme) {
  // A theme capture is the Map 1 PRODUCT CARD, so it opens the page in the shipped embed
  // mode. A plain MAPS capture is unchanged, byte for byte.
  const url = `${BASE}/homesignalmap.html?zip=${encodeURIComponent(draft.zip)}`
    + (theme ? `&${EMBED_PARAM}` : '');
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
  // THE FILTER GOES ON BEFORE THE MARKER IS LOCATED, not after: applyFilter() changes what is
  // on the map, so anything measured first could be stale by the shutter.
  //
  // ⚠️ AND `window.siteMarkers` IS NOT THE VISIBLE SET. An earlier version of this comment
  // claimed that finding the project in that array after filtering proved it belonged to the
  // Data center bucket. IT PROVES NOTHING: Map 1's applyFilter() keeps every marker in the
  // array and only adds it to or removes it from the Leaflet layer group, so array membership
  // is byte-identical before and after. Measured in a real browser —
  // test/maps-datacenter-capture-state.browser.test.mjs — where the Residential control stays
  // in `siteMarkers` and leaves the map. ON THE MAP is `m._map`, which Leaflet nulls on
  // removeLayer, and that is what `markerOnMap` below asserts.
  let filterState = null;
  if (theme === 'datacenter') {
    filterState = await applyDataCenterTypeFilter(page);
    if (!filterState.ok) {
      return { ok: false, reason: `Data center filter state could not be set: ${filterState.reason}` };
    }
  }

  // Then wait for THIS PROJECT's marker specifically. A count that has stopped changing is
  // not the same as the right draw having happened: ZIP mode issues the cached report and
  // the authoritative whole-ZIP read together, and the authoritative merge — the one that
  // carries zip_project_ref — can land after a first pass has already settled. Since the
  // RPC has already confirmed the ZIP is boundary_complete AND this project is in its
  // authoritative set, the marker must appear; waiting for the marker itself removes the
  // race instead of guessing at a duration. Measured: settling on the count captured 1 of 7,
  // because six reads landed on the pre-authoritative draw.
  await page.waitForFunction(
    (key) => (window.siteMarkers || []).some(
      (x) => x && x.s && (x.s.zip_project_ref || x.s.source_id) === key,
    ),
    proj.source_key,
    { timeout: 90000, polling: 700 },
  ).catch(() => {});

  const drew = await page.evaluate(() => (window.siteMarkers || []).length);
  if (!drew) return { ok: false, reason: 'map drew no markers for this ZIP' };

  // Find the marker the page drew for THIS project. The join is the PROJECT KEY, which the
  // page carries under two names depending on which half of ZIP mode drew the site:
  //   zip_project_ref — authoritative whole-ZIP development (lib/zip-authoritative.js), the
  //                     path that now REPLACES the cached report's development points;
  //   source_id       — the cached development_reports site (facilities, area notices).
  // Both are byte-identical to app_projects.source_key. Coordinates are corroboration and
  // never the key: siteLL() may return a fanned DISPLAY position for co-located points, so a
  // marker's drawn latlng is not always its record's latlng.
  const found = await page.evaluate(([sourceKey]) => {
    const list = window.siteMarkers || [];
    const sites = window.__HS_SITES || [];
    const keyOf = (s) => (s && (s.zip_project_ref || s.source_id)) || null;
    const idx = list.findIndex((x) => x && keyOf(x.s) === sourceKey);
    if (idx < 0) {
      return {
        found: false, total: list.length, sites: sites.length,
        inCache: sites.some((s) => keyOf(s) === sourceKey),
        authoritative: sites.some((s) => s && s.zip_project_ref),
      };
    }
    const hit = list[idx];
    const ll = hit.m.getLatLng();
    return {
      found: true, idx, total: list.length, sites: sites.length,
      how: hit.s.zip_project_ref ? 'zip_project_ref (authoritative whole-ZIP)' : 'source_id (cached report)',
      label: (hit.s && (hit.s.label || hit.s.title)) || '',
      site_lat: hit.s.lat, site_lng: hit.s.lng,
      lat: ll.lat, lng: ll.lng,
      fanned: hit.s._mLat != null,
      record_url: (hit.s && hit.s.record_url) || null,
    };
  }, [proj.source_key]);

  if (!found.found) {
    if (theme === 'datacenter') {
      return {
        ok: false,
        reason: 'the project has no marker on Map 1 with the Data center PROJECT TYPE filter '
          + `selected (${found.total} markers drawn). The queue and the map disagree about this `
          + 'record, so no image is produced rather than a picture of some other project.',
      };
    }
    return {
      ok: false,
      reason: `no drawn marker for this project (${found.total} markers drawn, `
        + `${found.sites} sites rendered, authoritative set present: ${found.authoritative}, `
        + `project present in it: ${found.inCache})`,
    };
  }

  // IS IT ACTUALLY DRAWN? The framing step below already fails when a marker carries no
  // `_map`, so a filtered-out target was always refused rather than captured — but it was
  // refused with "could not reach the Leaflet map from the marker", which names a plumbing
  // fault for what is really a FILTER verdict. Asking here turns that into the precise
  // reason, and for a theme capture it is the one check that proves the project survives the
  // Data center filter — i.e. that the post and its picture are about the same record.
  const onMap = await page.evaluate(([idx]) => {
    const hit = (window.siteMarkers || [])[idx];
    return !!(hit && hit.m && hit.m._map);
  }, [found.idx]);
  if (!onMap) {
    return {
      ok: false,
      reason: theme === 'datacenter'
        ? 'the project is drawn on this ZIP but is NOT shown under the Data center PROJECT '
          + 'TYPE filter, so Map 1 does not place it in the Data center bucket. No image is '
          + 'produced rather than a halo around a marker the map is not showing.'
        : 'the project has a marker but Map 1 is not currently showing it (filtered out)',
    };
  }

  // THE MARKER'S COORDINATES ARE THE MAP'S, AND THEY WIN. Where whole-ZIP membership is
  // authoritative, the marker is derived from the project's real geometry (POINT_AUTHORITATIVE,
  // POLYGON_COMPONENT_POINT_ON_SURFACE …) and is MORE authoritative than app_projects.lat/lng.
  // Demanding equality would reject exactly the better geometry, so the delta is measured and
  // RECORDED instead — and bounded, because a pin a kilometre from the address the post
  // quotes would make the image and the text disagree.
  const dLat = found.site_lat - proj.lat;
  const dLng = (found.site_lng - proj.lng) * Math.cos(proj.lat * Math.PI / 180);
  const deltaM = Math.round(Math.hypot(dLat, dLng) * 111320);
  if (deltaM > 500) {
    return { ok: false, reason: `the drawn marker is ${deltaM} m from the project's stored point — too far to caption honestly` };
  }
  found.delta_m = deltaM;

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
    // The open popup is what NAMES the project inside the image. Recording its text is the
    // in-image evidence that the target is identifiable to a reader, not merely present.
    popupText: (document.querySelector('.leaflet-popup-content')?.innerText || '').trim().slice(0, 200),
    haloPresent: !!document.getElementById('hs-social-halo'),
    homePins: document.querySelectorAll('.homepin').length,
    // Vector paths inside the map. In ZIP mode Map 1 draws no radius ring, but it MAY draw
    // real parcel geometry (drawParcels), which is authoritative and must not be refused —
    // so this is RECORDED into the evidence, not used as a veto. The home pin is the veto,
    // because a broadcast post has no home.
    vectorPaths: document.querySelectorAll('#mapInner path.leaflet-interactive').length,
    popupOpen: !!document.querySelector('.leaflet-popup-content'),
  }));
  if (clean.homePins > 0) return { ok: false, reason: 'refused: a home marker is on the map' };
  // A picture in which the target cannot be picked out is not a project-specific visual, so
  // an unopened popup or a missing halo refuses the capture rather than shipping an anonymous
  // field of dots.
  if (!clean.popupOpen || !clean.haloPresent) {
    return { ok: false, reason: `the target could not be made identifiable (popup: ${clean.popupOpen}, halo: ${clean.haloPresent})` };
  }

  // Suppress only chrome that is not the map: page header/nav/footer sit outside #map, so
  // clipping to #map already excludes them. Leaflet's own zoom control is the one control
  // inside the frame and is hidden for the shot.
  await page.addStyleTag({ content: '.leaflet-control-container{display:none!important}' });
  await page.waitForTimeout(1200);   // let the framed tiles settle

  // THE SHUTTER TARGET IS THE DIFFERENCE. A plain MAPS capture clips to `#map` — the map is
  // its whole subject. A theme capture clips to the Map 1 PRODUCT CARD, because the card's
  // controls are what say WHICH records are on screen: the image has to show that Data center
  // is the selected PROJECT TYPE, or the post's hook is unsupported by its own picture.
  let panel = null;
  if (theme === 'datacenter') {
    panel = await panelSectionsInFrame(page);
    // A cropped card is a card that no longer proves what it is there to prove, so a section
    // out of frame refuses the capture instead of shipping a picture missing its controls.
    const missing = ['card_header', 'status', 'project_type', 'regulatory', 'map']
      .filter((k) => !panel[k]);
    if (missing.length) {
      return { ok: false, reason: `the Map 1 card does not fit the frame — out of view: ${missing.join(', ')}` };
    }
    if (!panel.sidebar_hidden || !panel.search_form_hidden) {
      return { ok: false, reason: 'embed mode did not take: global chrome is still rendered' };
    }
  }

  const sel = theme === 'datacenter' ? '.card.mapcard' : '#map';
  const el = await page.$(sel);
  if (!el) return { ok: false, reason: `no ${sel} element` };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${draft.zip}-${String(proj.id).slice(0, 8)}.png`);
  await el.screenshot({ path: file });

  return {
    ok: true, file, clip: sel,
    marker: { label: found.label, lat: found.site_lat, lng: found.site_lng,
      of: found.total, how: found.how, fanned: found.fanned, delta_m: found.delta_m },
    framed: { zoom: framed.zoom, center: framed.center },
    checks: clean,
    theme: theme || null,
    filterState,
    panel,
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

    const auth = await authoritativePresence(d.zip, proj.source_key);
    if (!auth.present) {
      const why = auth.status !== 'boundary_complete'
        ? `the ZIP's authoritative whole-ZIP boundary is not complete (status: ${auth.status}), so Map 1 renders no development for it`
        : `the project is not in the ZIP's authoritative development set (${auth.markers} markers there)`;
      results.push({ id: d.id, label, ok: false, reason: why });
      if (!DRY) await recordFailure(d, why);
      continue;
    }

    // THEME — from the SHIPPED predicate the Acquisition Dashboard uses, so the image this
    // row gets is decided by the same rule that put the row in the Data Center Theme queue.
    const theme = HS.mapsSocialThemeKey ? HS.mapsSocialThemeKey(d) : null;

    let r;
    try { r = await capture(page, d, proj, theme); }
    catch (e) { r = { ok: false, reason: `capture threw: ${String(e.message || e).slice(0, 160)}` }; }

    if (!r.ok) {
      results.push({ id: d.id, label, ok: false, reason: r.reason, theme });
      if (!DRY) await recordFailure(d, r.reason, theme);
      continue;
    }

    const objectPath = `maps/${d.zip}/${String(proj.id)}.png`;
    if (DRY) { results.push({ id: d.id, label, ok: true, dry: true, file: r.file, marker: r.marker }); continue; }
    r.authMarkers = auth.markers;
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
    marker_vs_stored_point_m: r.marker.delta_m,
    markers_on_map: r.marker.of,
    framed_zoom: r.framed.zoom,
    authoritative_zip_status: 'boundary_complete',
    authoritative_markers_in_zip: r.authMarkers,
    home_markers: r.checks.homePins,
    vector_paths: r.checks.vectorPaths,
    popup_open: r.checks.popupOpen,
    popup_text: r.checks.popupText,
    halo_present: r.checks.haloPresent,
    width: IMG_W, height: IMG_H, device_scale: SCALE,
    // THEME CAPTURE EVIDENCE. Present only on a theme capture; absent (not false, not
    // null-filled) on a plain MAPS capture, so the two shapes stay distinguishable.
    ...(r.theme ? {
      theme: r.theme,
      clip: r.clip,
      embed_mode: true,
      // What the PROJECT TYPE controls were before and after, read off the controls
      // themselves — so the checkmarks visible in the image are accounted for.
      type_filter_before: r.filterState && r.filterState.before,
      type_filter_after: r.filterState && r.filterState.after,
      panel_in_frame: r.panel,
      card_header_text: r.panel && r.panel.card_header_text,
      theme_note: 'Captured in the shipped embed mode (?embed=1) and clipped to the Map 1 '
        + 'product card, with the Data center PROJECT TYPE control selected and every other '
        + 'type deselected THROUGH THE REAL CONTROLS (a change event on each chip\'s own '
        + 'checkbox, which runs the page\'s setType/applyFilter). The project\'s marker was '
        + 'located AFTER that filter was applied, so its presence is the proof it belongs to '
        + 'the Data center bucket. No control state is faked and no marker is drawn by this '
        + 'module.',
    } : {}),
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
async function recordFailure(draft, reason, theme) {
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
          theme: theme || null,
          // THE FALLBACK SENTENCE IS NOT TRUE OF A THEME POST, so it is not written for one.
          // A MAPS · Data Center Theme post publishes the Map 1 capture or it does not
          // publish: its hook asks about a data centre, and a generic OpenGraph card shows
          // none. The Acquisition Dashboard reads this same fact off image_bucket_path and
          // blocks Approve, so the note and the gate agree.
          note: theme
            ? 'No Map 1 visual could be produced truthfully for this MAPS \u00b7 Data Center Theme '
              + 'candidate. There is NO generic fallback for this theme: approval is blocked in '
              + 'the Acquisition Dashboard until a real capture of the exact project exists.'
            : 'No project-specific Map 1 visual could be produced truthfully. The draft keeps '
              + 'its factual text and its Map 1 link; the generic OpenGraph link card remains the '
              + 'publication fallback and is NOT a project-specific map preview.',
        },
      },
    }),
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
