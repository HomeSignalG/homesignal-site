// HomeSignal schematic map — the mockup's vector map, but data-driven and behind a
// swappable MapProvider seam (a real tile provider — Mapbox/Google — can replace
// `render` later without changing callers). No paid provider is hardcoded.
(function () {
  const HS = (window.HS = window.HS || {});

  // impact tier -> pin color (matches the mockup legend)
  function tier(item) {
    const s = item.impact_score != null ? item.impact_score
      : (item.confidence === 'High' ? 80 : item.confidence === 'Medium' ? 55 : 40);
    if (item.status === 'Approved') return { c: 'var(--blue)', k: 'watch' };
    if (item.impacts && item.impacts.length && item.impacts.every(i => !i.bad) && (item.distance_mi || 0) > 3)
      return { c: 'var(--green-2)', k: 'positive' };
    if (s >= 75) return { c: 'var(--red)', k: 'high' };
    if (s >= 45) return { c: 'var(--amber)', k: 'moderate' };
    return { c: 'var(--blue)', k: 'watch' };
  }
  HS.mapTier = tier;

  const MapProvider = {
    name: 'schematic',
    // render into `el`; returns [{letter,item,color}] in draw order for a synced pin list
    render(el, opts) {
      const { home, items = [], radiusMi = 1.5, showRadius = true, w = 780, h = 520 } = opts;
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
        const p = place(it.lat, it.lng), t = tier(it);
        return { letter: letters[i], item: it, color: t.c, x: p.x, y: p.y };
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
        <text x="${cx}" y="${cy-radiusPx-6}" font-size="11" fill="#157a49" text-anchor="middle" font-family="sans-serif" opacity="0.8">${radiusMi} mi impact radius</text>` : '';
      const homeMark = `
        <circle cx="${cx}" cy="${cy}" r="12" fill="#157a49" stroke="#fff" stroke-width="3"/>
        <text x="${cx}" y="${cy+31}" font-size="11" fill="#16211c" text-anchor="middle" font-weight="700" font-family="sans-serif">Your home</text>`;
      const pinSvg = pins.map(p => `<g><circle cx="${p.x}" cy="${p.y}" r="15" fill="${p.color}" stroke="#fff" stroke-width="3"/>
        <text x="${p.x}" y="${p.y+5}" font-size="13" fill="#fff" text-anchor="middle" font-weight="700" font-family="sans-serif">${p.letter}</text></g>`).join('');
      el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${bg}${radius}${homeMark}${pinSvg}</svg>`;
      return pins;
    }
  };
  HS.MapProvider = MapProvider;
})();
