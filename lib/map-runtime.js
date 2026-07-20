// HomeSignal map runtime — ONE lifecycle for every tile map surface.
// MapLibre GL → Leaflet raster → schematic fallback. Owns resize, markers,
// popups, selection sync. Pages configure; they do not reimplement lifecycle.
(function () {
  const HS = (window.HS = window.HS || {});

  function zoomFor(r) {
    return ({ '0.5': 14, '1': 13, '1.5': 12.4, '2': 12, '3': 11.4, '5': 10.7 })[String(r)] || 12;
  }

  function rafResize(fn) {
    try { fn(); } catch (e) {}
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  }

  HS.createMapController = function (opts) {
    opts = opts || {};
    const stageEl = opts.stageEl;
    const layers = opts.layers || {};
    const schEl = layers.schematic;
    const glEl = layers.gl;
    const lfEl = layers.lf;

    let center = opts.center || null;
    let home = opts.home || null;
    let hasRealHome = !!opts.hasRealHome;
    let radiusMi = opts.radiusMi != null ? opts.radiusMi : 1.5;
    let showRadius = opts.showRadius !== false;
    let mode = opts.mode || 'satellite';
    let selectedId = null;

    let glMap = null, glReady = false, glFailed = false, glMarkers = [], glMarkerById = {},
        glTilesOK = 0, glTileErrs = 0, glLastView = null;
    let lfMap = null, lfSat = null, lfOsm = null, lfBase = null, lfRadius = null,
        lfMarkers = [], lfMarkerById = {}, lfFailed = false, lfTilesOK = 0, lfTileErrs = 0,
        lfWatchdogArmed = false, lfLastView = null;
    let tilesDead = false, resizeObs = null, destroyed = false;
    let onSelect = opts.onSelect || function () {};
    let onRedraw = opts.onRedraw || function () {};
    let onDegrade = opts.onDegrade || function () {};
    let getItems = opts.getItems || function () { return []; };
    let getFacilities = opts.getFacilities || function () { return []; };
    let showFacilities = opts.showFacilities !== false;
    let renderPopup = opts.renderPopup || function (it) {
      return '<div style="font:600 13px/1.3 var(--font)">' + HS.esc(it.name || it.title || '') + '</div>';
    };
    let markerColor = opts.markerColor || function () { return '#6b7f76'; };
    let itemShape = opts.itemShape || function () { return 'circle'; };
    let drawSchematic = opts.drawSchematic || function () {};

    function circle(lat, lng, rMi) {
      return HS._circle ? HS._circle(lat, lng, rMi) : { type: 'FeatureCollection', features: [] };
    }

    function showLayer(which) {
      if (schEl) schEl.style.display = which === 'sch' ? 'block' : 'none';
      if (glEl) glEl.style.display = which === 'gl' ? 'block' : 'none';
      if (lfEl) lfEl.style.display = which === 'lf' ? 'block' : 'none';
    }

    function bumpResize() {
      if (destroyed) return;
      rafResize(function () {
        try { if (glMap) glMap.resize(); } catch (e) {}
        try { if (lfMap) lfMap.invalidateSize(); } catch (e) {}
      });
    }

    function sizeStage() {
      if (!stageEl || destroyed) return;
      if (opts.fillViewport !== false) {
        const top = stageEl.getBoundingClientRect().top;
        stageEl.style.height = Math.max(opts.minHeight || 420, window.innerHeight - top - (opts.viewportPad || 16)) + 'px';
      }
      bumpResize();
    }

    function bindResize() {
      if (!stageEl || destroyed) return;
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('resize', sizeStage);
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObs = new ResizeObserver(sizeStage);
        resizeObs.observe(stageEl);
      }
      sizeStage();
    }

    function clearGlMarkers() {
      glMarkers.forEach(function (m) { m.remove(); });
      glMarkers = [];
      glMarkerById = {};
    }

    function clearLfMarkers() {
      lfMarkers.forEach(function (m) { try { lfMap.removeLayer(m); } catch (e) {} });
      lfMarkers = [];
      lfMarkerById = {};
    }

    function pinEl(it, size) {
      const el = document.createElement('div');
      el.className = 'hspin';
      el.style.cssText = 'width:' + size + 'px;height:' + size + 'px;cursor:pointer;line-height:0';
      el.innerHTML = HS.markerSVG(itemShape(it), markerColor(it), it._letter || '', size);
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.setAttribute('aria-label', (it.name || it.title || 'Project'));
      const go = function (e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        controller.focusItem(it);
        onSelect(it);
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') go(e); });
      return el;
    }

    function addGlMarkers(items) {
      clearGlMarkers();
      if (!glMap) return;
      if (hasRealHome && home) {
        const hw = document.createElement('div');
        hw.innerHTML = HS.homeMarkerHTML(26);
        const h = hw.firstChild;
        h.style.zIndex = '5';
        h.title = 'Your home · ' + (HS.homeAddressLine ? HS.homeAddressLine(home) : home.address || '');
        glMarkers.push(new maplibregl.Marker({ element: h }).setLngLat([center.lng, center.lat])
          .setPopup(new maplibregl.Popup({ offset: 16, maxWidth: '260px' }).setHTML(HS.homePopupHTML(home))).addTo(glMap));
      }
      items.forEach(function (it) {
        const el = pinEl(it, 26);
        const mk = new maplibregl.Marker({ element: el }).setLngLat([it.lng, it.lat])
          .setPopup(new maplibregl.Popup({ offset: 16, maxWidth: '260px' }).setHTML(renderPopup(it))).addTo(glMap);
        glMarkers.push(mk);
        if (it.id != null) glMarkerById[it.id] = mk;
      });
      if (showFacilities) getFacilities().forEach(function (f) {
        const el = document.createElement('div');
        el.className = 'hspin';
        el.style.cssText = 'width:20px;height:20px;border-radius:3px;background:#6f42c1;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer';
        glMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([f.lng, f.lat])
          .setPopup(new maplibregl.Popup({ offset: 12, maxWidth: '260px' }).setHTML(renderPopup(f))).addTo(glMap));
      });
    }

    function lfDivIcon(html, size) {
      return L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    }

    function addLfMarkers(items) {
      clearLfMarkers();
      if (!lfMap) return;
      if (hasRealHome && home) {
        lfMarkers.push(L.marker([center.lat, center.lng], {
          zIndexOffset: 1000, icon: lfDivIcon(HS.homeMarkerHTML(26), 26),
          title: 'Your home · ' + (HS.homeAddressLine ? HS.homeAddressLine(home) : home.address || '')
        }).bindPopup(HS.homePopupHTML(home), { maxWidth: 260 }).addTo(lfMap));
      }
      items.forEach(function (it) {
        const m = L.marker([it.lat, it.lng], {
          icon: lfDivIcon('<div class="hspin" style="line-height:0">' + HS.markerSVG(itemShape(it), markerColor(it), it._letter || '', 26) + '</div>', 26)
        }).bindPopup(renderPopup(it), { maxWidth: 260 }).addTo(lfMap);
        const go = function () { controller.focusItem(it); onSelect(it); };
        m.on('click', go);
        lfMarkers.push(m);
        if (it.id != null) lfMarkerById[it.id] = m;
      });
      if (showFacilities) getFacilities().forEach(function (f) {
        lfMarkers.push(L.marker([f.lat, f.lng], {
          icon: lfDivIcon('<div style="width:20px;height:20px;border-radius:3px;background:#6f42c1;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer"></div>', 20)
        }).bindPopup(renderPopup(f), { maxWidth: 260 }).addTo(lfMap));
      });
    }

    function degradeToSchematic() {
      if (glFailed) return;
      glFailed = true;
      try { if (glMap) glMap.remove(); } catch (e) {}
      glMap = null;
      glReady = false;
      if (mode === 'impact') { controller.redraw(); return; }
      controller.redraw();
    }

    function schematicFinal() {
      if (!tilesDead) {
        tilesDead = true;
        onDegrade('tiles');
      }
      mode = 'impact';
      controller.redraw();
    }

    function lfFail() {
      if (lfFailed) { schematicFinal(); return; }
      lfFailed = true;
      try { if (lfMap) lfMap.remove(); } catch (e) {}
      lfMap = null;
      schematicFinal();
    }

    function ensureGL() {
      if (glMap || !glEl || !window.maplibregl) return;
      try {
        const sources = HS._glSources ? HS._glSources() : {};
        glMap = new maplibregl.Map({
          container: glEl,
          style: { version: 8, sources: sources, layers: [
            { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
            { id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } }
          ] },
          center: [center.lng, center.lat],
          zoom: zoomFor(radiusMi),
          interactive: opts.interactive !== false,
          attributionControl: opts.attributionControl !== false
        });
      } catch (e) {
        glMap = null;
        degradeToSchematic();
        return;
      }
      if (opts.navigationControl !== false) {
        glMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), opts.navControlPosition || 'top-right');
      }
      glMap.on('error', function (ev) {
        const msg = ev && ev.error && String(ev.error.message || ev.error);
        if (msg && /webgl/i.test(msg)) { degradeToSchematic(); return; }
        if ((ev && (ev.sourceId === 'sat' || ev.sourceId === 'osm')) || (msg && /429|rate|tile|failed to fetch|network/i.test(msg))) {
          if (++glTileErrs >= 4) degradeToSchematic();
        }
      });
      glMap.on('data', function (ev) {
        if (ev && ev.tile && (ev.sourceId === 'sat' || ev.sourceId === 'osm')) glTilesOK++;
      });
      setTimeout(function () { if (!glReady && !destroyed) degradeToSchematic(); }, opts.loadTimeout || 9000);
      glMap.on('load', function () {
        if (!center) return;
        glMap.addSource('radius', { type: 'geojson', data: circle(center.lat, center.lng, radiusMi) });
        glMap.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#157a49', 'fill-opacity': 0.08 } });
        glMap.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#157a49', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } });
        glReady = true;
        rafResize(function () { if (glMap) glMap.resize(); controller.redraw(); });
      });
    }

    function drawGL() {
      const items = getItems();
      showLayer('gl');
      bumpResize();
      ensureGL();
      if (glFailed || !glMap) return;
      if (!glReady) { onRedraw(items); return; }
      rafResize(function () {
        if (!glMap) return;
        glMap.resize();
        glMap.setLayoutProperty('sat', 'visibility', mode === 'satellite' ? 'visible' : 'none');
        glMap.setLayoutProperty('osm', 'visibility', mode === 'street' ? 'visible' : 'none');
        if (glMap.getSource('radius')) {
          glMap.getSource('radius').setData(showRadius ? circle(center.lat, center.lng, radiusMi) : { type: 'FeatureCollection', features: [] });
          glMap.setLayoutProperty('radius-fill', 'visibility', showRadius ? 'visible' : 'none');
          glMap.setLayoutProperty('radius-line', 'visibility', showRadius ? 'visible' : 'none');
        }
        const wantZoom = zoomFor(radiusMi);
        const viewKey = center.lat + ',' + center.lng + '@' + wantZoom;
        if (glLastView !== viewKey) {
          glLastView = viewKey;
          glMap.easeTo({ center: [center.lng, center.lat], zoom: wantZoom, duration: 300 });
        }
        addGlMarkers(items);
        onRedraw(items);
      });
    }

    function drawLF() {
      const items = getItems();
      showLayer('lf');
      if (!lfEl || !window.L) return;
      if (!lfMap) {
        lfMap = L.map(lfEl, { zoomSnap: 0.2, zoomControl: opts.interactive !== false, dragging: opts.interactive !== false, scrollWheelZoom: opts.scrollWheelZoom !== false });
        if (lfMap.attributionControl) lfMap.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
        lfSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri, Maxar', maxZoom: 19 });
        lfOsm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19, subdomains: 'abc' });
        [lfSat, lfOsm].forEach(function (t) {
          t.on('tileload', function () { lfTilesOK++; });
          t.on('tileerror', function () { if (++lfTileErrs >= 4 && lfTilesOK === 0) lfFail(); });
        });
      }
      if (!lfWatchdogArmed) {
        lfWatchdogArmed = true;
        setTimeout(function () {
          if (!lfFailed && lfMap && lfTilesOK === 0 && mode !== 'impact') lfFail();
        }, opts.loadTimeout || 8000);
      }
      const want = mode === 'street' ? lfOsm : lfSat;
      if (lfBase !== want) { if (lfBase) lfMap.removeLayer(lfBase); want.addTo(lfMap); lfBase = want; }
      const lfWantView = center.lat + ',' + center.lng + '@' + zoomFor(radiusMi);
      if (lfLastView !== lfWantView) { lfLastView = lfWantView; lfMap.setView([center.lat, center.lng], zoomFor(radiusMi)); }
      if (lfRadius) { lfMap.removeLayer(lfRadius); lfRadius = null; }
      if (showRadius) {
        lfRadius = L.circle([center.lat, center.lng], { radius: radiusMi * 1609.34, color: '#157a49', weight: 2, dashArray: '4 4', fillColor: '#157a49', fillOpacity: 0.08 }).addTo(lfMap);
      }
      addLfMarkers(items);
      bumpResize();
      onRedraw(items);
    }

    function drawTiles() {
      if (!center) { mode = 'impact'; controller.redraw(); return; }
      if (!glFailed && window.maplibregl && glEl) { drawGL(); return; }
      if (lfFailed || !lfEl) { schematicFinal(); return; }
      HS.loadLeaflet(function (ok) {
        if (mode === 'impact' || destroyed) return;
        if (ok && !lfFailed) drawLF(); else lfFail();
      });
    }

    const controller = {
      setMode: function (m) { mode = m; controller.redraw(); },
      getMode: function () { return mode; },
      setCenter: function (c) { center = c; glLastView = lfLastView = null; controller.redraw(); },
      setHome: function (h, real) { home = h; hasRealHome = !!real; controller.redraw(); },
      setRadius: function (r) { radiusMi = r; glLastView = lfLastView = null; controller.redraw(); },
      setShowRadius: function (v) { showRadius = !!v; controller.redraw(); },
      setShowFacilities: function (v) { showFacilities = !!v; controller.redraw(); },
      highlightId: function (id) { selectedId = id || null; if (opts.onHighlight) opts.onHighlight(selectedId); },
      getSelectedId: function () { return selectedId; },
      focusItem: function (it) {
        if (!it) return;
        controller.highlightId(it.id);
        if (mode !== 'impact' && it.lat != null && it.lng != null) {
          try {
            if (glMap && glReady && !glFailed) glMap.easeTo({ center: [it.lng, it.lat], duration: 400 });
            else if (lfMap && !lfFailed) lfMap.panTo([it.lat, it.lng]);
          } catch (e) {}
        }
        const mk = glMarkerById[it.id] || lfMarkerById[it.id];
        try {
          if (mk && mk.togglePopup) mk.togglePopup();
          else if (mk && mk.openPopup) mk.openPopup();
        } catch (e) {}
      },
      redraw: function () {
        if (destroyed) return;
        const items = getItems();
        if (mode === 'impact') {
          showLayer('sch');
          drawSchematic(schEl, items);
          onRedraw(items);
          return;
        }
        drawTiles();
      },
      sizeStage: sizeStage,
      destroy: function () {
        destroyed = true;
        if (typeof window !== 'undefined' && window.removeEventListener) {
          window.removeEventListener('resize', sizeStage);
        }
        if (resizeObs) { try { resizeObs.disconnect(); } catch (e) {} resizeObs = null; }
        clearGlMarkers();
        clearLfMarkers();
        try { if (glMap) glMap.remove(); } catch (e) {}
        try { if (lfMap) lfMap.remove(); } catch (e) {}
        glMap = lfMap = null;
      },
      getState: function () {
        return { mode: mode, glReady: glReady, glFailed: glFailed, lfFailed: lfFailed, tilesOK: glTilesOK, selectedId: selectedId };
      }
    };

    bindResize();
    return controller;
  };

  // Compact preview entry — delegates to createMapController (dashboard, etc.).
  HS.buildLive = function (el, o) {
    o = o || {};
    const items = (o.items || []).filter(function (it) { return it.lat != null && it.lng != null; });
    const center = o.center || (o.home ? { lat: o.home.lat, lng: o.home.lng } : null) || (items[0] ? { lat: items[0].lat, lng: items[0].lng } : null);
    if (!center) {
      try {
        HS.MapProvider.render(el, {
          home: null, items: items, radiusMi: o.radiusMi || 1.5, showRadius: o.radiusMi != null,
          showHome: !!o.home, homeLabel: o.home ? (o.home.address || '') : '',
          w: o.w || 640, h: o.h || 300, itemClick: o.itemClick
        });
      } catch (e) {}
      return null;
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:100%;height:100%';
    const sch = document.createElement('div');
    sch.style.cssText = 'position:absolute;inset:0;display:none';
    const gl = document.createElement('div');
    gl.style.cssText = 'position:absolute;inset:0;display:none';
    const lf = document.createElement('div');
    lf.style.cssText = 'position:absolute;inset:0;display:none';
    el.innerHTML = '';
    wrap.appendChild(sch);
    wrap.appendChild(gl);
    wrap.appendChild(lf);
    el.appendChild(wrap);
    if (o.h) el.style.height = o.h + 'px';
    const ctrl = HS.createMapController({
      stageEl: wrap,
      layers: { schematic: sch, gl: gl, lf: lf },
      center: center,
      home: o.home,
      hasRealHome: !!o.home,
      radiusMi: o.radiusMi || 1.5,
      showRadius: o.radiusMi != null,
      mode: 'satellite',
      fillViewport: false,
      minHeight: o.h || 300,
      interactive: o.interactive !== false,
      scrollWheelZoom: false,
      navigationControl: false,
      getItems: function () { return items; },
      getFacilities: function () { return []; },
      onSelect: o.itemClick || function () {},
      onRedraw: function () { if (o.onReady) o.onReady(ctrl._glMap); },
      drawSchematic: function (schEl, its) {
        try {
          HS.MapProvider.render(schEl, {
            home: center, items: its, radiusMi: o.radiusMi || 1.5, showRadius: o.radiusMi != null,
            showHome: !!o.home, homeLabel: o.home ? (o.home.address || '') : '',
            w: o.w || el.clientWidth || 640, h: o.h || el.clientHeight || 300, itemClick: o.itemClick
          });
        } catch (e) {}
      }
    });
    ctrl.redraw();
    return ctrl;
  };
})();
