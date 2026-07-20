// HomeSignal map-event identity + normalization backbone.
// ONE authoritative path from raw DB rows → stable map/change items.
// Pages consume HS.normalizeMapItem / HS.recentChanges — never infer identity from titles.
(function () {
  const HS = (window.HS = window.HS || {});

  function slug(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Strip a leading "Public meeting — " prefix for series labeling only.
  function seriesTitle(raw) {
    return slug(String(raw || '').replace(/^public meeting\s*[—–-]\s*/i, ''));
  }

  // Stable source-row identity — prefer explicit keys, then official URL.
  HS.sourceRecordId = function (row) {
    if (!row) return '';
    if (row.source_record_id) return String(row.source_record_id);
    if (row.source_ref) return String(row.source_ref);
    if (row.source_url) return String(row.source_url);
    if (row.id != null) return String(row.id);
    return '';
  };

  // One real-world occurrence (a specific meeting date or one notice document).
  HS.canonicalEventId = function (row) {
    if (!row) return '';
    if (row.canonical_event_id) return String(row.canonical_event_id);
    if (row.event_id) return String(row.event_id);
    if (row.dedupe_key) return 'dedupe:' + row.dedupe_key;
    const src = HS.sourceRecordId(row);
    if (src) return 'src:' + src;
    if (row.meeting_id) return 'mtg:' + row.meeting_id;
    if (row.id != null) return 'row:' + row.id;
    return '';
  };

  // Recurring series label (stats/grouping only — NEVER merges separate occurrences).
  HS.seriesId = function (row) {
    if (!row) return '';
    if (row.series_id) return String(row.series_id);
    const juris = row.community_id || row.jurisdiction_id || row.zip || '';
    const when = row.starts_at || row.meeting_date || row.window_closes_at || row.occurred_at || '';
    const day = when ? String(when).slice(0, 10) : '';
  // A series is the body name without the calendar day — occurrences differ by date/source.
    return String(juris) + '|' + seriesTitle(row.title || row.name) + '|' + (row.category || '');
  };

  function disambiguatedTitle(row) {
    const base = row.title || row.name || 'Record';
    const when = row.window_closes_at || row.starts_at || row.meeting_date || row.occurred_at;
    if (!when) return base;
    const day = HS.fmtDate ? HS.fmtDate(when, { month: 'short', day: 'numeric', year: 'numeric' }) : String(when).slice(0, 10);
    // Already carries a formatted date in the title? leave it.
    if (base.indexOf(day) !== -1 || /\b\d{4}\b/.test(base)) return base;
    return base + ' · ' + day;
  }

  HS.normalizeMapItem = function (row, kind) {
    kind = kind || (row && row.record_kind) || (row && row.type ? 'project' : 'change');
    const lat = row.lat != null ? row.lat : (row.latitude != null ? row.latitude : null);
    const lng = row.lng != null ? row.lng : (row.longitude != null ? row.longitude : null);
    const entityId = row.id != null ? String(row.id) : HS.canonicalEventId(row);
    return {
      id: entityId,
      entityId: entityId,
      eventId: HS.canonicalEventId(row),
      seriesId: HS.seriesId(row),
      type: kind,
      title: disambiguatedTitle(row),
      jurisdiction: row.county || row.jurisdiction || null,
      occurredAt: row.occurred_at || null,
      startsAt: row.starts_at || row.meeting_date || null,
      closesAt: row.window_closes_at || null,
      latitude: lat,
      longitude: lng,
      lat: lat,
      lng: lng,
      sourceUrl: row.source_ref || row.source_url || null,
      relatedProjectId: row.related_project_id || null,
      badges: [],
      changes: [],
      _raw: row
    };
  };

  function dedupeByEventId(entries) {
    const seen = {}, out = [];
    entries.forEach(function (e) {
      const k = e.eventId || e.id;
      if (!k) { out.push(e); return; }
      if (seen[k]) return;   // identical source record — idempotent ingest/materialize
      seen[k] = 1;
      out.push(e);
    });
    return out;
  }

  // "What's Changed" — evidence-gated, identity-aware. Separate meeting occurrences
  // with the same series title but different eventId/source_ref stay separate cards.
  HS.recentChanges = function (projects, changes, meetings, o) {
    o = o || {};
    const days = o.days != null ? o.days : 30;
    const now = o.now ? new Date(o.now) : new Date();
    const fmt = d => HS.fmtDate(d, { month: 'long', day: 'numeric' });
    function daysAgo(d) { const t = new Date(d); return isNaN(t) ? null : (now - t) / 86400000; }

    const out = [];
    let rawChangeRows = 0;

    (projects || []).forEach(function (p) {
      const badges = [], lines = [];
      let when = null;
      const ago = p.submitted_at != null ? daysAgo(p.submitted_at) : null;
      if (ago != null && ago >= 0 && ago <= days) {
        badges.push('NEW');
        lines.push('Filed with the county ' + fmt(p.submitted_at));
        when = p.submitted_at;
      }
      const mtg = (meetings || []).find(function (m) {
        return m.related_project_id === p.id && m.starts_at && new Date(m.starts_at) > now;
      });
      if (mtg) {
        badges.push('HEARING');
        lines.push('Public hearing ' + fmt(mtg.starts_at));
        if (!when) when = mtg.starts_at;
      }
      if (badges.length) {
        const norm = HS.normalizeMapItem(p, 'project');
        out.push({
          id: norm.entityId, eventId: norm.eventId, seriesId: norm.seriesId,
          kind: 'project', badges: badges, lines: lines, when: when,
          hearing: !!mtg, item: Object.assign({}, p, { title: norm.title })
        });
      }
    });

    (changes || []).forEach(function (c) {
      if (c.quiet) return;
      const ago = c.occurred_at != null ? daysAgo(c.occurred_at) : null;
      if (ago == null || ago < 0 || ago > days) return;
      rawChangeRows++;
      const norm = HS.normalizeMapItem(c, 'change');
      const lines = ['Recorded ' + fmt(c.occurred_at)];
      const closes = c.window_closes_at != null ? daysAgo(c.window_closes_at) : null;
      if (closes != null && closes <= 0) lines.push('Comment window closes ' + fmt(c.window_closes_at));
      out.push({
        id: norm.entityId, eventId: norm.eventId, seriesId: norm.seriesId,
        kind: 'change', badges: ['UPDATE'], lines: lines, when: c.occurred_at,
        hearing: false, item: Object.assign({}, c, { title: norm.title })
      });
    });

    // Fold a change into its related project (same story, different row type).
    const byProject = {};
    out.forEach(function (e) { if (e.kind === 'project') byProject[e.id] = e; });
    const folded = out.filter(function (e) {
      if (e.kind !== 'change') return true;
      const rid = e.item && e.item.related_project_id;
      const parent = rid && byProject[rid];
      if (!parent) return true;
      if (parent.badges.indexOf('UPDATE') === -1) parent.badges.push('UPDATE');
      e.lines.forEach(function (l) { if (parent.lines.indexOf(l) === -1) parent.lines.push(l); });
      if (!parent.when || String(e.when || '') > String(parent.when)) parent.when = e.when;
      return false;
    });

    const cards = dedupeByEventId(folded);
    const uniqueEvents = new Set(cards.map(e => e.eventId).filter(Boolean)).size;
    const uniqueSeries = new Set(cards.map(e => e.seriesId).filter(Boolean)).size;

    cards._counts = {
      rawChangeRecords: rawChangeRows,
      displayCards: cards.length,
      uniqueEvents: uniqueEvents,
      uniqueSeries: uniqueSeries
    };

    return cards.sort(function (a, b) {
      if (a.hearing !== b.hearing) return a.hearing ? -1 : 1;
      if (a.hearing && b.hearing) return String(a.when || '').localeCompare(String(b.when || ''));
      return String(b.when || '').localeCompare(String(a.when || ''));
    });
  };

  // Honest count line for the Recent Changes panel header.
  HS.recentChangesCountLine = function (entries, place, days) {
    entries = entries || [];
    const c = entries._counts || {};
    const n = c.displayCards != null ? c.displayCards : entries.length;
    const raw = c.rawChangeRecords;
    const series = c.uniqueSeries;
    if (!n) return 'Nothing has changed near ' + (place || 'your area') + ' in the last ' + days + ' days';
    let line = n + ' upcoming ' + (n === 1 ? 'item' : 'items') + ' near ' + (place || 'your area') + ' · last ' + days + ' days';
    if (raw != null && raw > n) line += ' (' + raw + ' recorded notices, ' + n + ' distinct)';
    else if (series != null && series < n) line += ' (' + series + ' meeting ' + (series === 1 ? 'series' : 'series') + ')';
    return line;
  };
})();
