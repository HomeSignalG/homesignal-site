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
for (const f of ['../lib/map.js', '../lib/maps-social-theme.js', '../lib/maps-capture-policy.js', '../lib/maps-capture-binding.js', '../lib/residential-qualify.js', '../lib/n5-radius.js', '../lib/zip-authoritative.js']) {
  (0, eval)(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
}
const HS = globalThis.window.HS;

// The four capture states, from the SHIPPED module the Acquisition Dashboard reads. Taken
// from it rather than re-declared here, so the job and the approval gate cannot come to
// hold different opinions about what "ready" means.
const { WAITING, READY, FAILED, INELIGIBLE } = HS.MAPS_CAPTURE_STATES;



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

// ── THE POLICY MODULE, INJECTED INTO THE THROWAWAY BROWSER ───────────────────────────
// lib/maps-capture-policy.js is the ONE definition of the map state a Data Center Theme
// screenshot must show. It is injected here rather than copied, so this job and
// test/maps-datacenter-capture-state.browser.test.mjs drive IDENTICAL code — a test that
// re-typed the manoeuvre would pass while production stayed broken, which is exactly what
// the previous browser suite did.
//
// `addScriptTag` (not `eval`): homesignalmap.html's CSP is
// `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net` — inline is allowed and
// `unsafe-eval` is not. Injected into this throwaway DOM only, never into the deployed
// site, the same established pattern as the selection halo.
const POLICY_SRC = fs.readFileSync(new URL('../lib/maps-capture-policy.js', import.meta.url), 'utf8');

/**
 * Put Map 1 into the Data Center Theme capture state, THROUGH THE REAL CONTROLS.
 *
 * Every status control on, Data center the only PROJECT TYPE, the REGULATORY overlay off —
 * all three dimensions, because a filter panel in a screenshot is a claim about WHICH
 * RECORDS ARE ON SCREEN and three dimensions decide that. The previous version set ONE of
 * them and published whatever the other two happened to be.
 *
 * Nothing here writes a filter value directly and nothing fakes a chip's appearance: each
 * control's own checkbox gets `.checked` plus a `change` event, which runs the page's own
 * setStage / setType / setRegulatory -> applyFilter. The checkmarks in the image are the
 * controls' real state.
 */
async function applyDataCenterCapturePolicy(page, targetKey) {
  return page.evaluate(
    ([key]) => window.HS.mapsDcCaptureApplyPolicy({ targetKey: key }),
    [targetKey],
  );
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

/**
 * ONLY these two columns may ever be written by this module.
 *
 * The arm gate this job used to carry existed to keep "automatic MAPS generation and
 * publication are held" true. Running on a schedule does not touch that hold — but the
 * hold must stop resting on the job being hard to start, so it is enforced HERE, in the
 * one place every write goes through. Approval, scheduling and publication live in
 * `status`, `approved_at`, `scheduled_slot` and `published_at`; none of them is writable
 * from this module, and a patch body naming any other column throws before it is sent.
 */
const WRITABLE = ['image_bucket_path', 'evidence'];

function assertWriteScope(body) {
  const keys = Object.keys(body || {});
  const bad = keys.filter((k) => !WRITABLE.includes(k));
  if (bad.length) {
    throw new Error(`REFUSING WRITE: this module may only set ${WRITABLE.join(', ')} — `
      + `patch body also named ${bad.join(', ')}. Approval/scheduling/publication are not `
      + 'this job\'s to move.');
  }
  return body;
}

// ── BOUNDED RETRY ──────────────────────────────────────────────────────────────────────
// The ladder and the due-predicate live in lib/maps-capture-binding.js, NOT here. They are
// the answer to "which drafts does a run touch", which has to be identical in the runner
// and in anything that audits the queue — and a predicate that only exists inside a script
// that imports playwright and calls main() at module load cannot be executed by a test.
// Taking them from the shipped module is what makes the retry behaviour provable offline.
const { MAX_ATTEMPTS, INELIGIBLE_RETRY_HOURS } = HS.MAPS_CAPTURE_RETRY;
const nextAttemptAt = (attempts) => HS.mapsCaptureNextAttemptAt(attempts);

/**
 * Drafts that need a capture on THIS run, newest first, hard-capped at LIMIT.
 *
 * DUPLICATE PROTECTION IS THE BINDING KEY, not the presence of a path. A draft whose
 * stored image is bound to its current inputs is skipped — that is the common case and it
 * costs one comparison, no browser and no request. A draft whose inputs have MOVED is
 * re-selected even though it has a path, which is the case the old selector could not see.
 *
 * The read is deliberately wider than the work: PostgREST cannot express "capture_key
 * inside evidence differs from a value computed in JS", so the filtering that needs the
 * shipped classifier happens here, and LIMIT is applied AFTER it. `--ids` bypasses the
 * retry clock (an operator naming a row has already decided) but never the write scope.
 */
async function selectDrafts() {
  const idFilter = ONLY_IDS.length ? `&id=in.(${ONLY_IDS.join(',')})` : '';
  const rows = await api('social_posts?select=id,zip,tile,post_text,evidence,image_bucket_path,status,content_family,revision'
    + `&content_family=eq.MAPS&status=eq.draft${idFilter}`
    // Newest first. A freshly generated candidate is the one worth a picture, and it is also
    // the one most likely to be in its ZIP's authoritative set — the two moved together.
    + '&order=created_at.desc&limit=500');

  const now = Date.now();
  const due = [];
  const skipped = { bound: 0, backoff: 0, exhausted: 0 };
  for (const d of rows) {
    // THE SHIPPED PREDICATE, not a second opinion about it.
    const verdict = HS.mapsCaptureDue(d, now, { ignoreClock: ONLY_IDS.length > 0 });
    if (!verdict.due) {
      // Reported separately so "already has its picture", "waiting out a backoff" and "has
      // burned its attempt budget" never read as one number.
      if (Object.prototype.hasOwnProperty.call(skipped, verdict.skip)) skipped[verdict.skip]++;
      continue;
    }
    due.push(d);
    if (due.length >= LIMIT) break;
  }
  console.log(`maps-social-image: ${rows.length} MAPS draft(s) read · `
    + `${skipped.bound} already bound · ${skipped.backoff} inside backoff · `
    + `${skipped.exhausted} past ${MAX_ATTEMPTS} attempts (long floor) · ${due.length} due this run`);
  return due;
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
  // THE POLICY MODULE RIDES WITH THE PAGE, never a copy of it in this file.
  await page.addScriptTag({ content: POLICY_SRC });

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
  //
  // ⚠️ THE POLICY IS APPLIED WITH NO TARGET, ON PURPOSE. ZIP mode issues the cached report and
  // the authoritative whole-ZIP read TOGETHER, and the authoritative merge — the one carrying
  // `zip_project_ref` — can land after a first pass has already settled. Asking the policy to
  // judge "is the target drawn?" here would turn that race into a capture failure with a
  // truthful-sounding but WRONG reason ("not shown under this policy") for a project the page
  // simply had not drawn yet. So this step sets and settles the three control dimensions; the
  // target's own visibility is waited for below and then ASSERTED at the shutter, where it is
  // a statement about the image.
  let policyApply = null;
  if (theme === 'datacenter') {
    policyApply = await applyDataCenterCapturePolicy(page, null);
    if (!policyApply.ok) {
      return { ok: false, reason: `Data Center map-state policy could not be applied: ${policyApply.reason}` };
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
  //
  // For a theme capture it waits for the marker to be ON THE MAP, not merely present in
  // `window.siteMarkers` — the filter is already applied by now, and array membership is
  // byte-identical either side of it, so the weaker condition would be satisfied by a marker
  // the map is not showing.
  if (proj) {
    await page.waitForFunction(
      ([key, needOnMap]) => (window.siteMarkers || []).some(
        (x) => x && x.s && (x.s.zip_project_ref || x.s.source_id) === key
          && (!needOnMap || !!(x.m && x.m._map)),
      ),
      [proj.source_key, theme === 'datacenter'],
      { timeout: 90000, polling: 700 },
    ).catch(() => {});
  }

  const drew = await page.evaluate(() => (window.siteMarkers || []).length);
  // ⚠️ A ZIP-SCOPE CAPTURE IS ALLOWED TO DRAW NOTHING, AND THAT IS THE WHOLE POINT.
  // The absence post says there is no data centre activity in this ZIP; a map with no
  // data-centre markers on it is the honest picture of exactly that claim, not a failure.
  // A PROJECT-scope capture still refuses, because a project that draws nothing cannot be
  // the subject of a project-specific image.
  if (!drew && proj) return { ok: false, reason: 'map drew no markers for this ZIP' };

  // ── PROJECT SCOPE vs ZIP SCOPE ──────────────────────────────────────────────────────
  // Everything in this block locates ONE record, frames on it, opens its popup and haloes
  // it. None of it has a subject in ZIP scope, where the picture is the ZIP's own map. The
  // ZIP branch therefore keeps the page's own framing — Map 1 already fits the ZIP — and
  // adds no halo and opens no popup, so nothing in the image points at a record the post
  // does not name.
  let found = null;
  let framed = { ok: true, scope: 'zip' };
  if (proj) {
    // Find the marker the page drew for THIS project. The join is the PROJECT KEY, which the
    // page carries under two names depending on which half of ZIP mode drew the site:
    //   zip_project_ref — authoritative whole-ZIP development (lib/zip-authoritative.js), the
    //                     path that now REPLACES the cached report's development points;
    //   source_id       — the cached development_reports site (facilities, area notices).
    // Both are byte-identical to app_projects.source_key. Coordinates are corroboration and
    // never the key: siteLL() may return a fanned DISPLAY position for co-located points, so a
    // marker's drawn latlng is not always its record's latlng.
    found = await page.evaluate(([sourceKey]) => {
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
    framed = await page.evaluate(([idx, zoom]) => {
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
  }

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
  // Project scope only: in ZIP scope there is deliberately no popup and no halo, because
  // there is no single record the image is about.
  if (proj && (!clean.popupOpen || !clean.haloPresent)) {
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

  // ── RE-READ THE CONTROLS AND THE DRAWN LAYER, AT THE SHUTTER ───────────────────────
  // ⚠️ THE READING TAKEN WHEN THE FILTER WAS APPLIED IS NOT A STATEMENT ABOUT THE IMAGE.
  // Between there and here the capture calls `map.setView(...)`, opens the marker's popup
  // and injects a stylesheet — each of which re-enters the page and any of which could, in
  // principle, run a handler that moves a control or redraws the layer. So the policy is
  // verified AGAIN, immediately before `el.screenshot()`, and a failure refuses the capture
  // rather than saving an image whose panel and whose markers disagree with the record.
  let policyRecord = null;
  if (theme === 'datacenter') {
    const verify = await page.evaluate(
      ([key]) => window.HS.mapsDcCaptureVerifyAtShutter(key),
      [proj ? proj.source_key : null],
    );
    // The scope rides WITH the measurement into the stored record, so the validator and the
    // server guard both learn from the evidence itself whether a target was ever expected.
    verify.scope = proj ? 'project' : 'zip';
    if (!verify.ok) {
      return { ok: false, reason: `the Data Center map state did not hold to the shutter: ${verify.reason}` };
    }
    policyRecord = await page.evaluate(
      ([a, v]) => window.HS.mapsDcCapturePolicyRecord(a, v),
      [policyApply, verify],
    );
    // The row will only be treated as bound if this record validates, so validating it HERE
    // — before an image is written or uploaded — turns a would-be silently-unusable capture
    // into a named refusal. The SHIPPED validator, never a second opinion about it.
    const ev = HS.mapsDcCapturePolicyEvidence({ capture_policy: policyRecord });
    if (!ev.ok) {
      return { ok: false, reason: `the measured map state does not satisfy policy ${HS.MAPS_DC_CAPTURE_POLICY.key}: ${ev.problems.join('; ')}` };
    }
  }

  const sel = theme === 'datacenter' ? '.card.mapcard' : '#map';
  const el = await page.$(sel);
  if (!el) return { ok: false, reason: `no ${sel} element` };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${draft.zip}-${proj ? String(proj.id).slice(0, 8) : 'zip'}.png`);
  await el.screenshot({ path: file });

  return {
    ok: true, file, clip: sel,
    scope: proj ? 'project' : 'zip',
    // ABSENT, NOT NULL, in ZIP scope. There is no marker and no project-framed view, and a
    // null would read as "measured and empty" rather than "no such thing here".
    ...(proj ? {
      marker: { label: found.label, lat: found.site_lat, lng: found.site_lng,
        of: found.total, how: found.how, fanned: found.fanned, delta_m: found.delta_m },
      framed: { zoom: framed.zoom, center: framed.center },
    } : { markers_drawn: drew }),
    checks: clean,
    theme: theme || null,
    policyRecord,
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
  const drafts = await selectDrafts();
  if (has('--list')) {
    for (const d of drafts) {
      console.log(` ${d.id} zip=${d.zip} state=${HS.mapsCaptureState(d)} ${d.evidence?.project_name}`);
    }
    return;
  }
  if (!drafts.length) { await proveNothingApproved(); return; }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: IMG_W, height: IMG_H },
    deviceScaleFactor: SCALE,
  });
  // ── EACH CAPTURE STARTS FROM THE PRODUCT'S OWN DEFAULT STATE ───────────────────────
  // lib/map.js persists the PROJECT TYPE and REGULATORY selections in `sessionStorage`
  // (`hs.map.categoryFilters`) and this job reuses ONE browser context for every draft in a
  // run, so without this the SECOND capture inherits the FIRST's filter state. That is not
  // hypothetical: the shipped Mesa evidence records `type_filter_before` byte-identical to
  // `type_filter_after` (datacenter true, six falses) — a "before" no fresh page can produce.
  // For a theme capture the policy overwrites all three dimensions anyway, so what this
  // protects is the ORDINARY MAPS capture that follows one, which sets no filters at all and
  // would otherwise be photographed through the previous draft's Data-center-only view.
  //
  // It clears the CAPTURE browser's own ephemeral session, never a resident's: this context
  // is created and destroyed inside this function, and nothing here touches localStorage or
  // any stored preference of the deployed site.
  await ctx.addInitScript(() => {
    try {
      window.sessionStorage.removeItem('hs.map.categoryFilters');
      window.sessionStorage.removeItem('hs.map.statusFilters');
    } catch (e) { /* storage blocked -> the page already falls back to its defaults */ }
  });
  const page = await ctx.newPage();
  const results = [];

  for (const d of drafts) {
    const pid = d.evidence?.project_id;
    const label = `${d.zip} ${d.evidence?.project_name || ''}`.trim();

    // ⚖️ EVERY POST GETS A MAP — FOUNDER RULING. Each condition below used to end the
    // draft's run with no picture at all, and the recorded reason said so in its own words:
    // "No PROJECT-SPECIFIC Map 1 visual could be produced truthfully." That was true and it
    // was the wrong conclusion. Not being able to pin ONE record is a reason to photograph
    // the ZIP, not a reason to ship a post with no map. Measured before this change: 46 of
    // 55 MAPS drafts were CAPTURE_INELIGIBLE and only 9 carried an image — including every
    // one of the 18 absence posts, whose whole subject is a ZIP rather than a project.
    //
    // So these are now a DEMOTION to ZIP scope, never a refusal. `proj` stays null, the
    // capture frames on the ZIP, and the evidence records `scope: "zip"` so nothing can
    // later read the picture as proof that a particular project was shown.
    let proj = null;
    let auth = { markers: null };
    let zipReason = null;

    if (!pid) {
      zipReason = 'the draft names no project (an absence post), so the map is of the ZIP';
    } else {
      const live = await liveProject(pid);
      if (!live) zipReason = 'the project row is no longer in app_projects';
      else if (live.record_kind !== 'development') zipReason = 'the live row is not a development record';
      else if (live.lat == null || live.lng == null) zipReason = 'the project has no coordinates, so Map 1 draws no marker for it';
      else if (!nearly(live.lat, d.evidence?.lat) || !nearly(live.lng, d.evidence?.lng)) {
        zipReason = 'the live coordinates differ from the draft evidence, so a pin would not be of this draft';
      } else {
        const a = await authoritativePresence(d.zip, live.source_key);
        if (!a.present) {
          zipReason = a.status !== 'boundary_complete'
            ? `the ZIP's authoritative whole-ZIP boundary is not complete (status: ${a.status})`
            : `the project is not in the ZIP's authoritative development set (${a.markers} markers there)`;
        } else { proj = live; auth = a; }
      }
    }

    // THEME — from the SHIPPED predicate the Acquisition Dashboard uses, so the image this
    // row gets is decided by the same rule that put the row in the Data Center Theme queue.
    const theme = HS.mapsSocialThemeKey ? HS.mapsSocialThemeKey(d) : null;

    let r;
    try { r = await capture(page, d, proj, theme); }
    catch (e) { r = { ok: false, reason: `capture threw: ${String(e.message || e).slice(0, 160)}` }; }

    if (!r.ok) {
      const w = DRY ? { ok: true, rows: 0 } : await recordOutcome(d, FAILED, r.reason, theme);
      results.push({ id: d.id, label, ok: false, state: FAILED, reason: r.reason, theme,
        ...(w.ok ? {} : { stale: true, note: 'the draft changed during this run; nothing was written' }) });
      continue;
    }

    // THE OBJECT PATH CARRIES THE BINDING KEY'S OWN FINGERPRINT, so a re-capture after the
    // draft moved writes a NEW object instead of silently overwriting the old one through
    // `x-upsert`. Two consequences worth having: `image_bucket_path` changes when the
    // picture changes, which is what makes the dashboard's per-row blob cache correct; and
    // the superseded image survives, so a capture can be compared with the one it replaced.
    const objectPath = `maps/${d.zip}/${proj ? String(proj.id) : 'zip'}-${keyStamp(d)}.png`;
    if (DRY) { results.push({ id: d.id, label, ok: true, dry: true, state: READY, file: r.file, marker: r.marker }); continue; }
    r.authMarkers = auth.markers;
    if (zipReason) r.zip_reason = zipReason;
    // THE UPLOAD LANDS FIRST AND IS HARMLESS ON ITS OWN. The object path carries this
    // draft's own key fingerprint, so an orphan object is unreferenced bytes — it is not a
    // picture attached to a row, and nothing reads the bucket except through
    // `image_bucket_path`. Uploading after a successful attach would be worse: the row would
    // name an object that does not exist yet.
    await upload(objectPath, r.file);
    const wrote = await attach(d, objectPath, r, proj);
    if (!wrote.ok) {
      // The row moved while we were photographing it. Report it, leave the previous image and
      // the previous evidence untouched, and let the next run re-select it against whatever
      // the draft is NOW. Forcing the write is the one thing that must not happen here.
      console.warn(`maps-social-image: ${d.id} — SKIPPED (stale): the draft changed during this `
        + `capture (status or revision ${d.revision} moved). Nothing was written; the uploaded `
        + `object ${objectPath} is unreferenced.`);
      results.push({ id: d.id, label, ok: false, state: WAITING, stale: true,
        reason: 'the draft changed during this capture; the result was not attached' });
      continue;
    }
    results.push({ id: d.id, label, ok: true, state: READY, path: objectPath, marker: r.marker, framed: r.framed });
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  const okN = results.filter((x) => x.ok).length;
  const byState = (s) => results.filter((x) => x.state === s).length;
  console.log(`maps-social-image: ${okN} real map visual(s) · ${byState(FAILED)} capture failure(s) · `
    + `${byState(INELIGIBLE)} ineligible — none of which is a finding about a ZIP`);
  if (!DRY) await proveNothingApproved(results.map((x) => x.id));
}

/**
 * A short, stable stamp of the binding key for use inside an object name.
 *
 * Object paths are not a place for a 120-character readable key, so this is the one spot
 * where a digest is right. It is NOT the binding record — `evidence.visual.capture_key`
 * holds the readable key and is what every comparison uses. This only has to make two
 * different keys produce two different file names.
 */
function keyStamp(draft) {
  const key = HS.mapsCaptureKey(draft) || '';
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    h1 = Math.imul(h1 ^ key.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + key.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12);
}

/**
 * RE-READ THE ROWS THIS RUN TOUCHED AND PROVE IT MOVED NOTHING IT MAY NOT MOVE.
 *
 * `assertWriteScope` refuses a bad patch body before it is sent; this asks the DATABASE
 * afterwards, which is the only instrument that can catch a write this module did not know
 * it made.
 *
 * ⚠️ SCOPED TO THE ROWS THIS RUN TOUCHED, NEVER TO THE WHOLE QUEUE. Asserting that NO MAPS
 * row anywhere carries approval state would be true today — 0 of 49 are approved — and
 * would turn this job red the first time the founder legitimately approves one. A guard
 * that fails on the system working correctly gets switched off, and then it is not a guard.
 * The selector only ever returns `status=draft`, so every id here was a draft before the
 * run; still being one after it is the actual invariant.
 *
 * It RAISES. A capture job that has approved something has done the one thing the hold
 * exists to prevent, and a green run that merely mentioned it in a log would be worse than
 * a red one.
 */
async function proveNothingApproved(ids) {
  if (!ids || !ids.length) { console.log('maps-social-image: approval-scope check — 0 rows touched, nothing to re-read'); return; }
  const rows = await api('social_posts?select=id,status,approved_at,scheduled_slot,published_at'
    + `&id=in.(${ids.join(',')})&limit=500`);
  const moved = rows.filter((r) => r.status !== 'draft' || r.approved_at || r.scheduled_slot || r.published_at);
  console.log(`maps-social-image: approval-scope check re-read ${rows.length} touched row(s) — `
    + `${moved.length} left draft state`);
  if (moved.length) {
    for (const m of moved) console.error(`  ${m.id} status=${m.status} approved_at=${m.approved_at} scheduled=${m.scheduled_slot} published=${m.published_at}`);
    throw new Error('REFUSING TO REPORT SUCCESS: a row this capture run touched no longer '
      + 'reads as a draft. Capture must never move approval, scheduling or publication.');
  }
}

// ── THE ATTACH IS CONDITIONAL, IN ONE STATEMENT ──────────────────────────────────────
//
// A capture reads a draft, spends 30-90 seconds in a browser, and then writes. In that
// window the row can legitimately move: the founder can approve it, a recompose can rewrite
// its text, another run can attach a newer image. A read followed by an unconditional write
// is not a guard — it is a race with a comment on it.
//
// So every write this module makes carries its preconditions IN THE `WHERE` CLAUSE, which
// PostgREST expresses as filters on the PATCH. One statement, evaluated by Postgres:
//
//   id       — this draft
//   status   — STILL a draft. Approval is not this job's to move, and an approved row's
//              payload fingerprint is bound to the image it was approved with, so writing a
//              new image under it would break that binding (the publication guard would then
//              refuse to publish at all).
//   revision — STILL the revision the capture was planned against. `social_posts_bump_revision`
//              increments it whenever post_text, embed, embed_kind, image_bucket_path,
//              source_url, hashtags or evidence changes, so equality here means NOTHING this
//              module merges from its snapshot has moved underneath it.
//
// `return=representation` is what makes the refusal VISIBLE: zero rows back means a
// precondition failed. The run reports the draft as skipped/stale and leaves the old image
// and the old evidence exactly as they are. It never re-reads and retries, and it never
// drops a filter to make the write land.
async function guardedPatch(draft, body) {
  const q = `social_posts?id=eq.${draft.id}&status=eq.draft&revision=eq.${Number(draft.revision)}`;
  const rows = await api(q, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(assertWriteScope(body)),
  });
  const n = Array.isArray(rows) ? rows.length : 0;
  return { ok: n === 1, rows: n };
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
    // SCOPE IS RECORDED ON THE VISUAL ITSELF, not only inside capture_policy, so a reader
    // of the row knows what the picture is of without parsing the policy block.
    scope: r.scope,
    ...(r.zip_reason ? { zip_scope_reason: r.zip_reason } : {}),
    ...(r.scope === 'project' ? {
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
    } : { markers_on_map: r.markers_drawn }),
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
      // THE MEASURED MAP STATE — all three filter dimensions, read off the controls
      // themselves and off the drawn Leaflet layer, so the checkmarks visible in the image
      // and the markers visible in the image are both accounted for. Built by the SHIPPED
      // lib/maps-capture-policy.js, which is also what validates it on the way back out.
      capture_policy: r.policyRecord,
      // Kept under their historical names so anything already reading them keeps working.
      // They are the TYPE half of `capture_policy`, not a second measurement.
      type_filter_before: r.policyRecord && r.policyRecord.observed_before
        && r.policyRecord.observed_before.types,
      type_filter_after: r.policyRecord && r.policyRecord.applied && r.policyRecord.applied.types,
      panel_in_frame: r.panel,
      card_header_text: r.panel && r.panel.card_header_text,
      theme_note: 'Captured in the shipped embed mode (?embed=1) and clipped to the Map 1 '
        + 'product card under map-state policy ' + HS.MAPS_DC_CAPTURE_POLICY.key + ': all four '
        + 'STATUS controls on, Data center the only PROJECT TYPE, the REGULATORY overlay OFF — '
        + 'set THROUGH THE REAL CONTROLS (a change event on each control\'s own checkbox, which '
        + 'runs the page\'s setStage/setType/setRegulatory and its applyFilter). The project\'s '
        + 'marker was located AFTER that policy was applied and the controls plus the drawn '
        + 'layer were re-read at the shutter. No control state is faked and no marker is drawn '
        + 'by this module. This records what the CONTROLS said; it is not a digest of the PNG.',
    } : {}),
    note: 'Screenshot of the live Map 1 ZIP page, framed on the project\'s own coordinates '
      + 'with its real marker popup open and a screen-pixel selection halo. ZIP mode draws no '
      + 'radius ring and no home marker, and both absences are asserted before the shutter. '
      + 'Surrounding development is left visible. Nothing is drawn, moved or invented.',
  };
  // THE BINDING RECORD. `capture_key` is what every later reader compares against the
  // draft's own inputs, so the picture can never quietly outlive the draft it was taken
  // for. `state` is the founder-facing fact; the historical `status` literal is kept above
  // so nothing that already tests for REAL_MAP_VISUAL changes behaviour.
  visual.state = READY;
  visual.capture_key = HS.mapsCaptureKey(draft);
  visual.attempts = 0;
  visual.next_attempt_at = null;
  // A success clears the previous failure text rather than leaving it beside a real image,
  // where the next reader would have to work out which one is current.
  delete visual.failure_reason;
  delete visual.failed_at;

  return guardedPatch(draft, {
    image_bucket_path: objectPath,
    evidence: { ...(draft.evidence || {}), visual },
  });
}

/**
 * Record a non-success on the draft. The factual text/link draft is left intact.
 *
 * FAILED and INELIGIBLE are written as different states with different retry clocks,
 * because they are different facts: one says our instrument did not work, the other says
 * this project cannot be photographed on its ZIP page as things stand. Neither is ever a
 * statement that the ZIP has no development — see the copy in lib/maps-capture-binding.js.
 */
async function recordOutcome(draft, state, reason, theme) {
  const prev = draft.evidence || {};
  const prevVisual = prev.visual || {};
  // An ineligible outcome does not burn an attempt: attempts measure how often our capture
  // was tried and failed, and no number of retries fixes a project that is not in the ZIP's
  // authoritative set. It gets the long floor instead.
  const attempts = state === FAILED ? ((prevVisual.attempts || 0) + 1) : (prevVisual.attempts || 0);
  const nextAt = state === FAILED
    ? nextAttemptAt(attempts)
    : new Date(Date.now() + INELIGIBLE_RETRY_HOURS * 3600 * 1000).toISOString();
  return guardedPatch(draft, {
      evidence: {
        ...prev,
        visual: {
          ...prevVisual,
          state,
          attempts,
          next_attempt_at: nextAt,
          // The draft's inputs AT THE MOMENT OF THE REFUSAL. If they move, the key moves,
          // and the row is re-selected immediately instead of waiting out a backoff that
          // was set against a state of the world that no longer holds.
          attempted_key: HS.mapsCaptureKey(draft),
          status: 'NO_PROJECT_SPECIFIC_VISUAL',
          failure_reason: reason,
          failed_at: new Date().toISOString(),
          theme: theme || null,
          // ONE SENTENCE THAT NAMES THE INSTRUMENT, stored beside the reason so the
          // distinction survives into anything that later reads this row. Neither state's
          // copy can be read as "no data centres here": that inference is exactly what a
          // conflated failure state invites, and it would be a claim about the world
          // manufactured out of a screenshot that did not happen.
          state_note: HS.mapsCaptureStateCopy(state),
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
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
