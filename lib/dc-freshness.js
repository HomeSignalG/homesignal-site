// DATA-CENTRE LAYER FRESHNESS (founder, 2026-11-12). Map 1's data-centre pins come from sources we
// read on a schedule (Compute Atlas, Epoch AI) and one we loaded once (OpenStreetMap). This says,
// per source that has a pin on the page:
//   1. when we last read it successfully (the read whose records are on the map) and how long ago,
//   2. the publisher's own date for that edition, when it states one,
//   3. when we last TRIED to read it, said separately, when that try did not refresh it.
// It never says a facility was checked on a date: a refresh date is when we read the source's
// list. Data: public.map1_datacentre_freshness() (docs/map1-datacentre-freshness.sql). A missing
// reader or a failed read renders nothing, never a guessed date.
(function () {
  const HS = (window.HS = window.HS || {});
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

  function day(v) {
    const d = new Date(v);
    if (v == null || isNaN(d.getTime())) return '';
    return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }
  function age(from, asOf) {
    const a = new Date(from).getTime(), b = new Date(asOf).getTime();
    if (isNaN(a) || isNaN(b)) return '';
    const n = Math.max(0, Math.floor((b - a) / 86400000));
    return n === 0 ? 'today' : n === 1 ? '1 day ago' : n + ' days ago';
  }

  // rows: map1_datacentre_freshness() output. names: the source_name values of the data-centre
  // pins on the page (a source with no pin is not mentioned). Pure, so it is tested in Node.
  HS.dcFreshnessLines = function (rows, names) {
    const want = {};
    (names || []).forEach(function (n) { if (n) want[n] = 1; });
    return (rows || []).filter(function (r) { return r && r.publisher && want[r.publisher]; })
      .sort(function (a, b) { return a.publisher < b.publisher ? -1 : a.publisher > b.publisher ? 1 : 0; })
      .map(function (r) {
        const ok = day(r.last_success_at);
        let s;
        if (r.scheduled === false) {
          s = r.publisher + ': loaded once, ' + (ok ? ok + ' (' + age(r.last_success_at, r.as_of) + ')' : 'date not recorded')
            + '; not refreshed since.';
          return s;
        }
        s = r.publisher + ': last successful refresh ' + (ok ? ok + ' (' + age(r.last_success_at, r.as_of) + ')' : 'not recorded') + '.';
        const ed = day(r.publisher_edition_at);
        if (ed) s += ' Publisher\'s edition dated ' + ed + '.';
        if (r.last_attempt_refreshed === false && r.last_attempt_at) {
          s += ' Our last attempt to refresh it, ' + day(r.last_attempt_at)
            + ', did not complete; the pins show the earlier read.';
        }
        return s;
      });
  };

  HS.dcFreshnessHTML = function (lines) {
    if (!lines || !lines.length) return '';
    const esc = HS.esc || function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    return '<div class="dcfresh" data-dc-freshness="1" style="margin:10px 0;font-size:12.5px;line-height:1.5;color:var(--ink-2,#444)">'
      + '<div style="font-weight:700">Data-centre sources</div>'
      + lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('')
      + '<div style="color:var(--ink-3,#666)">A refresh date is when we read the source\'s list. It does not mean each facility was checked on that date.</div>'
      + '</div>';
  };

  let cache = null;   // one read per page load; the answer is the same for every ZIP
  HS.mountDcFreshness = async function (el, names, sb) {
    if (!el) return;
    const token = (el.__dcFreshToken = (el.__dcFreshToken || 0) + 1);
    if (!names || !names.length || !sb) { el.innerHTML = ''; return; }
    try {
      if (!cache) {
        cache = sb().rpc('map1_datacentre_freshness').then(function (r) {
          return r && !r.error && Array.isArray(r.data) ? r.data : null;
        }, function () { return null; });
      }
      const rows = await cache;
      if (token !== el.__dcFreshToken) return;
      el.innerHTML = rows ? HS.dcFreshnessHTML(HS.dcFreshnessLines(rows, names)) : '';
      if (!rows) cache = null;   // a failed read is retried on the next render
    } catch (e) {
      if (token === el.__dcFreshToken) el.innerHTML = '';
      cache = null;
    }
  };
})();
