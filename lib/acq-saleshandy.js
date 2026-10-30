/* Jody Acquisition Dashboard — Saleshandy tab (campaign performance beside website conversions).
   A version-controlled renderer for ONE gated answer: public.hs_saleshandy_metrics(p_days)
   (docs/saleshandy-attribution.sql). Aggregates only: campaign label, counts, rates. It never
   receives, and so can never show, a prospect name, e-mail address or ZIP. Every value goes
   through esc() before it is placed in markup. Opens and link clicks are NOT shown: Saleshandy
   open/click tracking is disabled on purpose (no tracking redirects), so a "visitors" figure is
   measured by our own first-party campaign_landing events instead. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function fmt(v) { return n(v).toLocaleString('en-US'); }
  // A rate is shown only when its denominator is real; otherwise a dash, never a made-up 0%.
  function pct(num, den) { return n(den) > 0 ? (Math.round(n(num) / n(den) * 1000) / 10).toFixed(1) + '%' : '—'; }
  function per100(num, den) { return n(den) > 0 ? (Math.round(n(num) / n(den) * 1000) / 10).toFixed(1) : '—'; }

  function tile(label, value, note) {
    return '<div class="tile s-real"><div class="tile-val">' + esc(value) + '</div><div class="tile-label">' + esc(label) +
           '</div>' + (note ? '<div class="tile-note">' + esc(note) + '</div>' : '') + '</div>';
  }

  HS.acqSaleshandy = {
    esc: esc, pct: pct,
    // m = the jsonb answer of hs_saleshandy_metrics. Returns an HTML string.
    render: function (m) {
      m = m || {};
      var all = Array.isArray(m.campaigns) ? m.campaigns : [];
      // The reader returns every campaign label it has seen: Saleshandy sequences AND labels that only
      // appear on our own site (Bluesky "maps"/"shorts", admin tests). Only a row that exists in
      // outreach.saleshandy_campaign carries a name or a status, so that is what makes it a Saleshandy
      // campaign. The tiles and the table count those rows only; the others are named below, never summed in.
      var isSh = function (r) { return r && (r.name != null || r.status != null); };
      var rows = all.filter(isSh);
      var others = all.filter(function (r) { return !isSh(r) && (n(r.registrations) || n(r.visitors) || n(r.reports) || n(r.paying)); });
      var cov = m.coverage || {};
      var tot = rows.reduce(function (a, r) {
        a.delivered += n(r.delivered); a.bounced += n(r.bounced); a.unsub += n(r.unsubscribed);
        a.visitors += n(r.visitors); a.reports += n(r.reports); a.regs += n(r.registrations); a.paying += n(r.paying);
        return a;
      }, { delivered: 0, bounced: 0, unsub: 0, visitors: 0, reports: 0, regs: 0, paying: 0 });
      var days = n(m.window_days) || 30;
      var sync = m.last_sync || null;
      var syncLine = sync
        ? 'Last Saleshandy sync: ' + esc(sync.status) + (sync.finished_at ? ' · ' + esc(String(sync.finished_at).slice(0, 16).replace('T', ' ')) + ' UTC' : '') + (sync.window_to ? ' · stats through ' + esc(sync.window_to) : '')
        : 'No Saleshandy sync has run yet, so the email columns are empty. Visits, registrations and reports below are our own first-party counts.';

      var body = rows.map(function (r) {
        return '<tr><td>' + esc(r.name || r.campaign) + '<div class="tile-note">' + esc(r.campaign) + (r.status ? ' · ' + esc(r.status) : '') + '</div></td>' +
          '<td style="text-align:right">' + fmt(r.delivered) + ' <span class="tile-note">+' + fmt(r.scheduled) + ' scheduled</span></td>' +
          '<td style="text-align:right">' + fmt(r.bounced) + ' <span class="tile-note">' + pct(r.bounced, n(r.delivered) + n(r.bounced)) + '</span></td>' +
          '<td style="text-align:right">' + fmt(r.unsubscribed) + ' <span class="tile-note">' + pct(r.unsubscribed, r.contacted) + '</span></td>' +
          '<td style="text-align:right">' + fmt(r.visitors) + ' <span class="tile-note">' + per100(r.visitors, r.delivered) + ' per 100 delivered</span></td>' +
          '<td style="text-align:right">' + fmt(r.registrations) + '</td>' +
          '<td style="text-align:right">' + fmt(r.reports) + '</td>' +
          '<td style="text-align:right">' + fmt(r.paying) + '</td></tr>';
      }).join('');

      var attributed = n(cov.registrations_campaign), total = n(cov.registrations_total);
      var started = cov.tracking_started_at ? String(cov.tracking_started_at).slice(0, 10) : null;

      return '' +
        '<div class="grid">' +
          tile('Emails delivered', fmt(tot.delivered), 'lifetime total from Saleshandy; scheduled emails are not counted') +
          tile('Bounced', fmt(tot.bounced), pct(tot.bounced, tot.delivered + tot.bounced) + ' of delivered + bounced') +
          tile('Unsubscribed', fmt(tot.unsub), 'lifetime total') +
          tile('Website visitors', fmt(tot.visitors), 'distinct browsers via a tagged link') +
          tile('Registrations', fmt(tot.regs), 'distinct people credited to a Saleshandy campaign') +
          tile('Reports created', fmt(tot.reports), 'Development Activity Reports') +
          tile('Paying customers', fmt(tot.paying), 'active or trialing') +
        '</div>' +
        '<div class="card"><h3>Campaigns</h3>' +
          '<p class="sub">Email figures come from Saleshandy; everything from “Visitors” on is measured on our own site from the UTM label on the link. ' +
          'Opens and link clicks are not tracked.</p>' +
          (rows.length
            ? '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Campaign</th><th style="text-align:right">Delivered</th><th style="text-align:right">Bounced</th>' +
              '<th style="text-align:right">Unsubscribed</th><th style="text-align:right">Visitors</th><th style="text-align:right">Registered</th>' +
              '<th style="text-align:right">Reports</th><th style="text-align:right">Paying</th></tr></thead><tbody>' + body + '</tbody></table></div>'
            : '<p class="sub">No campaign data yet.</p>') +
          '<p class="tile-note">' + syncLine + '</p>' +
          (others.length
            ? '<p class="tile-note">Not counted above (not Saleshandy): ' + others.map(function (r) {
                return esc(r.campaign) + ' — ' + fmt(r.visitors) + ' visitors, ' + fmt(r.registrations) + ' registered, ' + fmt(r.reports) + ' reports';
              }).join('; ') + '.</p>'
            : '') +
        '</div>' +
        '<div class="card"><h3>Attribution coverage</h3>' +
          '<p class="sub">' + fmt(attributed) + ' of ' + fmt(total) + ' registrations in the last ' + days + ' days carry any campaign label (Saleshandy, Bluesky or a test). ' +
          (started ? 'Campaign tracking on the site began ' + esc(started) + '; ' : 'No campaign-tagged visit has been recorded yet; ') +
          'anyone who arrived earlier, on another device, or without the tagged link cannot be credited to a campaign and is counted as unattributed, not as zero.</p>' +
        '</div>';
    },
    // Fetch and paint. `client` is the page's authenticated supabase client.
    load: function (client, container, days) {
      if (!client || !container) return Promise.resolve(false);
      container.innerHTML = '<div class="gate-loading">Loading Saleshandy metrics…</div>';
      return client.rpc('hs_saleshandy_metrics', { p_days: days || 30 }).then(function (r) {
        if (r && r.error) {
          container.innerHTML = '<div class="card"><h3>Couldn’t load</h3><p class="sub">The Saleshandy metrics could not be read (' + esc(r.error.code || 'error') + '). Try again.</p></div>';
          return false;
        }
        container.innerHTML = HS.acqSaleshandy.render(r && r.data);
        return true;
      }, function () {
        container.innerHTML = '<div class="card"><h3>Couldn’t load</h3><p class="sub">The Saleshandy metrics could not be reached. Try again.</p></div>';
        return false;
      });
    }
  };
})();
