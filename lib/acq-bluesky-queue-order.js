// acq-bluesky-queue-order.js — the ORDER of Tab 12's post queue (2026-11-11).
//
// Founder: "i do not want the approved posts at the top anymore. i want the new subscriber
// zip code posts always at top." Three groups, in this order:
//   1. subscriber — posts about a ZIP with a real Development-alert subscriber
//                   (drafts to review first, newest first; then that ZIP's approved posts)
//   2. review     — every other draft, newest first
//   3. approved   — every other approved post, by posting time (soonest first)
//
// A VIEW ONLY. It reads rows and returns them regrouped; it changes no post. Which ZIPs
// count as subscriber ZIPs is NOT decided here: the caller passes the list it got from
// public.hs_bsky_subscriber_zips() (docs/bluesky-subscriber-zips.sql).
(function () {
  var HS = (typeof window !== 'undefined')
    ? (window.HS = window.HS || {})
    : (globalThis.HS = globalThis.HS || {});

  function t(v) { var n = v ? Date.parse(v) : NaN; return isNaN(n) ? null : n; }
  function newestFirst(a, b) { return (t(b.created_at) || 0) - (t(a.created_at) || 0); }
  function bySlot(a, b) {
    var x = t(a.scheduled_slot), y = t(b.scheduled_slot);
    if (x === null && y === null) return (t(a.created_at) || 0) - (t(b.created_at) || 0);
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  }
  function draftsThenApproved(rows) {
    var d = rows.filter(function (p) { return p.status !== 'approved'; }).sort(newestFirst);
    var a = rows.filter(function (p) { return p.status === 'approved'; }).sort(bySlot);
    return d.concat(a);
  }

  /**
   * @param rows      social_posts rows (draft + approved)
   * @param subZips   array of 5-digit ZIP strings with a real subscriber
   * @returns {subscriber, review, approved} — every input row is in exactly one group
   */
  HS.bskyQueueGroups = function (rows, subZips) {
    var set = {};
    (subZips || []).forEach(function (z) { set[String(z)] = true; });
    var sub = [], review = [], approved = [];
    (rows || []).forEach(function (p) {
      if (p && p.content_family === 'MAPS' && p.zip && set[String(p.zip)]) sub.push(p);
      else if (p && p.status === 'approved') approved.push(p);
      else review.push(p);
    });
    return { subscriber: draftsThenApproved(sub), review: review.sort(newestFirst), approved: approved.sort(bySlot) };
  };

  /**
   * One status line per subscriber ZIP, so a ZIP with nothing waiting is still shown.
   * @param zips   [{zip, subscribers, last_published_at}] from hs_bsky_subscriber_zips()
   * @param rows   ALL queue rows (not the filtered view)
   */
  HS.bskySubscriberZipStatus = function (zips, rows) {
    return (zips || []).map(function (z) {
      var mine = (rows || []).filter(function (p) {
        return p && p.content_family === 'MAPS' && String(p.zip) === String(z.zip);
      });
      var approved = mine.filter(function (p) { return p.status === 'approved'; }).sort(bySlot);
      return {
        zip: String(z.zip),
        subscribers: z.subscribers || 0,
        drafts: mine.length - approved.length,
        approved: approved.length,
        next_slot: approved.length ? (approved[0].scheduled_slot || null) : null,
        last_published_at: z.last_published_at || null
      };
    });
  };
})();
