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
    onfile:    { hex: '#6b7f76', label: 'On file' }
  };
  function statusTier(item) {
    const s = String((item && item.status) || '').toLowerCase();
    const k = (s === 'proposed') ? 'proposed'
            : (s === 'approved') ? 'approved'
            : (s === 'operating' || s === 'active' || s === 'built') ? 'operating'
            : 'onfile';
    return Object.assign({ k: k, c: STATUS_TIERS[k].hex }, STATUS_TIERS[k]);
  }
  HS.mapStatus = statusTier;

  const MapProvider = {
    name: 'schematic',
    // render into `el`; returns [{letter,item,color}] in draw order for a synced pin list
    render(el, opts) {
      const { home, items = [], radiusMi = 1.5, showRadius = true, showHome = true, w = 780, h = 520 } = opts;
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
      const homeMark = showHome ? `
        <circle cx="${cx}" cy="${cy}" r="12" fill="#157a49" stroke="#fff" stroke-width="3"/>
        <text x="${cx}" y="${cy+31}" font-size="11" fill="#16211c" text-anchor="middle" font-weight="700" font-family="sans-serif">Your home</text>` : '';
      const pinSvg = pins.map(p => `<g><circle cx="${p.x}" cy="${p.y}" r="15" fill="${p.color}" stroke="#fff" stroke-width="3"/>
        <text x="${p.x}" y="${p.y+5}" font-size="13" fill="#fff" text-anchor="middle" font-weight="700" font-family="sans-serif">${p.letter}</text></g>`).join('');
      el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${bg}${radius}${homeMark}${pinSvg}</svg>`;
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
          if (o.home) L.marker([o.home.lat, o.home.lng], { icon: div('<div style="width:18px;height:18px;border-radius:50%;background:#157a49;border:3px solid #fff;box-shadow:0 0 0 5px rgba(21,122,73,.18)"></div>', 18) }).addTo(m);
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
        if (o.home) {   // ONLY a real resident home — never a centroid stand-in
          const h = document.createElement('div');
          h.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#157a49;border:3px solid #fff;box-shadow:0 0 0 5px rgba(21,122,73,.18)';
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
