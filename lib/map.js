// HomeSignal map helpers — the ONE map backbone shared by the app's map surfaces
// (maps.html full page + dashboard.html preview). homesignalmap.html (the
// development tracker) has its own separately-verified stack and does not read this.
//
// HONEST-LABELING CONTRACT (2026-07-16 backbone audit):
//   * Pin colors encode PERMIT STATUS (Proposed / Approved / Operating) — the only
//     per-record fact the data carries. NO "impact" tiers: the old impact legend
//     decoded to a status->constant lookup, its red "High impact" tier was
//     unreachable (max stored score 72 < the 75 threshold), and its green
//     "Positive" tier required fields that never render. Unknown statuses get the
//     neutral "On file" gray — never a guessed severity.
//   * A home marker / "Your home" label renders ONLY for a real resident home in
//     the viewed ZIP — never a centroid, sample address, or arbitrary record.
//   * Live engines degrade MapLibre GL -> Leaflet rasters (no WebGL needed) ->
//     schematic diagram, and a map failure never throws into the caller's init.
(function () {
  const HS = (window.HS = window.HS || {});

  // permit status -> pin color + legend label. Only EXACT known statuses are
  // colored ('Active'/'Built' are the materializer's built-bucket synonyms);
  // anything else renders the neutral "On file" — never a guessed tier.
  const STATUS_TIERS = {
    proposed:  { hex: '#c47a1a', label: 'Proposed' },
    approved:  { hex: '#3f7fb0', label: 'Approved' },
    operating: { hex: '#1f9d5c', label: 'Operating / built' },
    onfile:    { hex: '#6b7f76', label: 'On file' },
    facility:  { hex: '#6f42c1', label: 'Regulated facility' }
  };
  function statusTier(item) {
    // A regulated facility is an existing condition, not development activity — it gets
    // its OWN color key (purple), the only attribute distinguishing it now that it shares
    // the lettered-pin shape with projects. Keyed on record_kind, never on permit status.
    if (item && item.record_kind === 'facility')
      return Object.assign({ k: 'facility', c: STATUS_TIERS.facility.hex }, STATUS_TIERS.facility);
    const s = String((item && item.status) || '').toLowerCase();
    const k = (s === 'proposed') ? 'proposed'
            : (s === 'approved') ? 'approved'
            : (s === 'operating' || s === 'active' || s === 'built') ? 'operating'
            : 'onfile';
    return Object.assign({ k: k, c: STATUS_TIERS[k].hex }, STATUS_TIERS[k]);
  }
  HS.mapStatus = statusTier;

  // Reserve up to `floor` of the first `cap` (A–P) pin slots for regulated facilities,
  // so an existing condition near the resident (e.g. a facility at 1.5 mi) is never
  // pushed off the default view by closer development items. Operates on a
  // proximity-SORTED array (index = distance rank). It first DEDUPES co-located
  // same-name facilities (HS.fac.dedupe) so the floor counts DISTINCT sites and a
  // merged card occupies one slot. Then, if fewer than min(floor, #distinct facilities)
  // facilities sit in the top `cap`, it PROMOTES the closest out-of-window facilities
  // into the window, each displacing the FARTHEST in-window non-facility; everything
  // else keeps its proximity order. This is NOT a radius filter — nothing is dropped,
  // only the first-`cap` membership is adjusted. Returns a new array.
  HS.reserveFacilitySlots = function (sorted, cap, floor) {
    cap = cap || 16;
    const list = (HS.fac && HS.fac.dedupe) ? HS.fac.dedupe(sorted) : (sorted || []).slice();
    const isFac = x => x && x.record_kind === 'facility';
    const want = Math.min(floor || 0, list.filter(isFac).length);
    if (want <= 0 || list.length <= cap) return list;

    const win = list.slice(0, cap);
    const need = want - win.filter(isFac).length;
    if (need <= 0) return list;

    // Closest facilities beyond the window (the tail is already proximity-sorted).
    const promote = list.slice(cap).filter(isFac).slice(0, need);
    // Farthest non-facilities inside the window (scan from the far edge inward).
    const demote = [];
    for (let i = win.length - 1; i >= 0 && demote.length < promote.length; i--) {
      if (!isFac(win[i])) demote.push(win[i]);
    }
    const k = Math.min(promote.length, demote.length);
    if (k <= 0) return list;   // nothing to promote, or window is already all facilities

    const promoteK = promote.slice(0, k), demoteK = demote.slice(0, k);
    const promoteSet = new Set(promoteK), demoteSet = new Set(demoteK);
    const pq = promoteK.slice();              // closest promoted facility first
    const dq = demoteK.slice().reverse();     // closest demoted non-facility first
    // Walk the list once: a demoted window slot yields to the next promoted facility;
    // a promoted facility's old (beyond-window) slot takes the next demoted non-facility.
    return list.map(x => {
      if (demoteSet.has(x)) return pq.shift();
      if (promoteSet.has(x)) return dq.shift();
      return x;
    });
  };

  // The resident-home marker IS the HomeSignal logo mark (founder-specified):
  // the brand's green rounded tile with the white house glyph — same SVG as the
  // header logo in partials/shell.html. ONE builder, used by every map engine.
  const HOME_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:__SZ__px;height:__SZ__px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>';
  HS.homeMarkerHTML = function (size) {
    const inner = Math.round(size * 0.62);
    return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:' + Math.round(size * 0.28) + 'px;'
      + 'background:#157a49;border:2.5px solid #fff;box-shadow:0 0 0 5px rgba(21,122,73,.18),0 1px 4px rgba(0,0,0,.35);'
      + 'display:grid;place-items:center">' + HOME_GLYPH.replace(/__SZ__/g, inner) + '</div>';
  };

  // Popup body for the home pin — says WHICH address is logged, not just
  // "Your home" (the bare label left the pinned address a mystery). Shows only
  // the address actually saved on the row (HS.homeAddressLine — absent parts
  // stay absent), used by every map engine that pops the home marker.
  HS.homePopupHTML = function (p) {
    const line = HS.homeAddressLine ? HS.homeAddressLine(p) : ((p && p.address) || '');
    return '<div style="font:600 13px/1.3 var(--font)">Your home</div>'
      + (line ? '<div style="font-size:12px;color:#16211c;margin-top:2px">' + HS.esc(line) + '</div>' : '')
      + '<div style="font-size:11px;color:#5a6b63;margin-top:2px">The home address saved on your account</div>';
  };

  const MapProvider = {
    name: 'schematic',
    // render into `el`; returns [{letter,item,color}] in draw order for a synced pin list
    render(el, opts) {
      const { home, items = [], radiusMi = 1.5, showRadius = true, showHome = true, homeLabel = '', w = 780, h = 520 } = opts;
      const cx = w / 2, cy = h / 2, radiusPx = Math.min(w, h) * 0.29;
      const pxPerMile = radiusPx / radiusMi;
      const hLat = home ? home.lat : (items[0] && items[0].lat) || 0;
      const hLng = home ? home.lng : (items[0] && items[0].lng) || 0;
      const place = (lat, lng) => {
        const north = (lat - hLat) * 69;               // mi north
        const east = (lng - hLng) * 69 * Math.cos(hLat * Math.PI / 180); // mi east
        return { x: Math.max(20, Math.min(w - 20, cx + east * pxPerMile)),
                 y: Math.max(20, Math.min(h - 20, cy - north * pxPerMile)) };
      };
      const letters = 'ABCDEFGHIJKLMNOP';
      const shown = items.slice(0, letters.length);
      const pins = shown.map((it, i) => {
        const p = place(it.lat, it.lng), t = statusTier(it);
        return { letter: letters[i], item: it, color: t.hex, x: p.x, y: p.y };
      });
      const bg = `
        <rect width="${w}" height="${h}" fill="#e4eadd"/>
        <path d="M40 60 Q120 40 190 90 Q250 130 240 200 Q150 190 60 172 Q30 110 40 60 Z" fill="#d3e0c6"/>
        <rect x="${w-235}" y="${h-190}" width="185" height="160" rx="18" fill="#d3e0c6"/>
        <path d="M60 ${h*0.63} Q150 ${h*0.58} 215 ${h*0.66} Q255 ${h*0.72} 212 ${h*0.82} Q150 ${h*0.9} 72 ${h*0.87} Q22 ${h*0.77} 60 ${h*0.63} Z" fill="#bcd6e2"/>
        <path d="M0 ${cy+5} H${w}" stroke="#f4f2ec" stroke-width="14"/>
        <path d="M${cx} 0 V${h}" stroke="#f4f2ec" stroke-width="12"/>`;
      const radius = showRadius ? `
        <circle cx="${cx}" cy="${cy}" r="${radiusPx}" fill="#157a49" fill-opacity="0.07" stroke="#157a49" stroke-opacity="0.35" stroke-dasharray="7 7"/>
        <text x="${cx}" y="${cy-radiusPx-6}" font-size="11" fill="#157a49" text-anchor="middle" font-family="sans-serif" opacity="0.8">${radiusMi} mi radius</text>` : '';
      // Only mark a REAL resident home; a centroid stand-in is never labeled "Your home".
      // The mark is the HomeSignal LOGO (green rounded tile + white house glyph), drawn
      // LAST (class hs-home) so nearby pins/facilities never bury it — the label gets a
      // white halo so it stays readable over anything underneath. When the caller
      // passes homeLabel (the logged street address) it renders under "Your home",
      // so the diagram says WHICH address is pinned — only ever a saved address,
      // never derived here.
      const homeAddr = (showHome && homeLabel) ? `
        <text x="${cx}" y="${cy+48}" font-size="10.5" fill="#3d4c45" stroke="#fff" stroke-width="4" paint-order="stroke" text-anchor="middle" font-weight="600" font-family="sans-serif">${HS.esc(homeLabel)}</text>` : '';
      const homeMark = showHome ? `
        <g class="hs-home"><rect x="${cx-14}" y="${cy-14}" width="28" height="28" rx="8" fill="#157a49" stroke="#fff" stroke-width="3"/>
        <g transform="translate(${cx-9},${cy-9.5}) scale(0.79)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></g>
        <text x="${cx}" y="${cy+34}" font-size="11.5" fill="#16211c" stroke="#fff" stroke-width="4" paint-order="stroke" text-anchor="middle" font-weight="700" font-family="sans-serif">Your home</text>${homeAddr}</g>` : '';
      const pinSvg = pins.map(p => `<g><circle cx="${p.x}" cy="${p.y}" r="15" fill="${p.color}" stroke="#fff" stroke-width="3"/>
        <text x="${p.x}" y="${p.y+5}" font-size="13" fill="#fff" text-anchor="middle" font-weight="700" font-family="sans-serif">${p.letter}</text></g>`).join('');
      el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${bg}${radius}${pinSvg}${homeMark}</svg>`;
      return pins;
    }
  };
  HS.MapProvider = MapProvider;

  // ---- shared real-tile helpers ----
  HS._circle = function (lat, lng, rMi) {
    const pts = [], R = rMi / 69.0, cs = Math.cos(lat * Math.PI / 180);
    for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([lng + (R * Math.sin(a)) / cs, lat + R * Math.cos(a)]); }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } }] };
  };
  HS._glSources = function () {
    return {
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri, Maxar' },
      osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' }
    };
  };

  // Lazily load Leaflet from jsDelivr (the no-WebGL raster engine). Shared by
  // maps.html and buildLive; healthy-WebGL visitors never fetch it.
  HS.loadLeaflet = function (cb) {
    if (window.L && window.L.map) return cb(true);
    if (HS.loadLeaflet._q) { HS.loadLeaflet._q.push(cb); return; }
    const q = HS.loadLeaflet._q = [cb];
    const css = document.createElement('link'); css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    s.onload = function () { const ok = !!(window.L && window.L.map); HS.loadLeaflet._q = null; q.forEach(f => f(ok)); };
    s.onerror = function () { HS.loadLeaflet._q = null; q.forEach(f => f(false)); };
    document.head.appendChild(s);
  };

  // Compact guarded live map for previews (Dashboard). Full chain:
  // MapLibre GL (WebGL ok) -> Leaflet rasters (WebGL off / GL failed) -> schematic.
  // NEVER throws into the caller, and NEVER fabricates a home marker: the green
  // home dot renders only when o.home is a real resident home (caller-verified).
  HS.buildLive = function (el, o) {
    o = o || {};
    const items = (o.items || []).filter(it => it.lat != null && it.lng != null);
    const center = o.center
      || (o.home ? { lat: o.home.lat, lng: o.home.lng } : null)
      || (items[0] ? { lat: items[0].lat, lng: items[0].lng } : null);
    function schematic() {
      try {
        MapProvider.render(el, { home: center, items: items, radiusMi: o.radiusMi || 1.5,
          showRadius: o.radiusMi != null, showHome: !!o.home, w: o.w || 640, h: o.h || 300 });
      } catch (e) { /* a dead preview box is better than a dead page */ }
    }
    if (!center) { schematic(); return; }
    function leaflet() {
      HS.loadLeaflet(function (ok) {
        if (!ok) { schematic(); return; }
        try {
          el.innerHTML = '';
          const m = L.map(el, { zoomSnap: 0.2, zoomControl: o.interactive !== false,
            dragging: o.interactive !== false, scrollWheelZoom: false });
          if (m.attributionControl) m.attributionControl.setPrefix(
            '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>');
          const t = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri, Maxar', maxZoom: 19 });
          let okTiles = 0, errs = 0, dead = false;
          function toSchematic() { if (dead) return; dead = true; try { m.remove(); } catch (e) {} schematic(); }
          t.on('tileload', function () { okTiles++; });
          t.on('tileerror', function () { if (++errs >= 4 && okTiles === 0) toSchematic(); });
          setTimeout(function () { if (okTiles === 0) toSchematic(); }, 8000);
          t.addTo(m);
          m.setView([center.lat, center.lng], o.zoom || 12);
          if (o.radiusMi) L.circle([center.lat, center.lng], { radius: o.radiusMi * 1609.34,
            color: '#157a49', weight: 2, dashArray: '4 4', fillColor: '#157a49', fillOpacity: 0.08 }).addTo(m);
          const div = (html, size) => L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
          if (o.home) L.marker([o.home.lat, o.home.lng], { zIndexOffset: 1000, icon: div(HS.homeMarkerHTML(22), 22),
            title: 'Your home · ' + (HS.homeAddressLine ? HS.homeAddressLine(o.home) : o.home.address || '') }).addTo(m);
          items.forEach(function (it) {
            L.marker([it.lat, it.lng], { icon: div('<div style="width:20px;height:20px;border-radius:50%;background:' + statusTier(it).hex + ';border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>', 20) }).addTo(m);
          });
        } catch (e) { schematic(); }
      });
    }
    if (!window.maplibregl) { leaflet(); return; }
    let map = null, degraded = false, ready = false, tilesOK = 0, tileErrs = 0;
    function degrade() {
      if (degraded) return; degraded = true;
      try { if (map) map.remove(); } catch (e) {}
      map = null; leaflet();
    }
    try {
      map = new maplibregl.Map({
        container: el,
        style: { version: 8, sources: HS._glSources(), layers: [{ id: 'sat', type: 'raster', source: 'sat' }] },
        center: [center.lng, center.lat], zoom: o.zoom || 12,
        interactive: o.interactive !== false, attributionControl: false
      });
    } catch (e) { degrade(); return; }   // WebGL unavailable (hardened browsers)
    map.on('error', function (ev) {
      const msg = ev && ev.error && String(ev.error.message || ev.error);
      if (msg && /webgl/i.test(msg)) { degrade(); return; }   // async WebGL failure
      if ((ev && ev.sourceId === 'sat') || (msg && /429|rate|tile|failed to fetch|network/i.test(msg))) {
        if (++tileErrs >= 4) degrade();
      }
    });
    map.on('data', function (ev) { if (ev && ev.tile && ev.sourceId === 'sat') tilesOK++; });
    setTimeout(function () { if (!ready && !degraded) degrade(); }, 9000);   // stalled load
    map.on('load', function () {
      ready = true;
      setTimeout(function () { if (!degraded && tilesOK === 0) degrade(); }, 8000);   // silent blank
      try {
        if (o.radiusMi) {
          map.addSource('r', { type: 'geojson', data: HS._circle(center.lat, center.lng, o.radiusMi) });
          map.addLayer({ id: 'rf', type: 'fill', source: 'r', paint: { 'fill-color': '#157a49', 'fill-opacity': 0.08 } });
          map.addLayer({ id: 'rl', type: 'line', source: 'r', paint: { 'line-color': '#157a49', 'line-width': 2, 'line-opacity': 0.6, 'line-dasharray': [2, 2] } });
        }
        if (o.home) {   // ONLY a real resident home — never a centroid stand-in; on top of items
          const w = document.createElement('div');
          w.innerHTML = HS.homeMarkerHTML(22);
          const h = w.firstChild; h.style.zIndex = '5';
          h.title = 'Your home · ' + (HS.homeAddressLine ? HS.homeAddressLine(o.home) : o.home.address || '');
          new maplibregl.Marker({ element: h }).setLngLat([o.home.lng, o.home.lat]).addTo(map);
        }
        items.forEach(function (it) {
          const d = document.createElement('div');
          d.style.cssText = 'width:20px;height:20px;border-radius:50%;background:' + statusTier(it).hex + ';border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)';
          new maplibregl.Marker({ element: d }).setLngLat([it.lng, it.lat]).addTo(map);
        });
        if (o.onReady) o.onReady(map);
      } catch (e) { degrade(); }
    });
  };
})();
