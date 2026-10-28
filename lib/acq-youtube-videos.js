/* Jody Acquisition Dashboard: "YouTube Videos" tab.
   Review surface for the finished videos the JODY video pipeline (homesignal-ingest/video) produces.
   It lists each project, plays the main video and both Shorts inside the page, shows the thumbnail,
   the proposed titles, the description and the review ledger, and records the founder's decision
   (approve / reject, with a note) PER FILE through ONE gated RPC: the main video, each Short and the thumbnail
   are judged separately, so a fix to one Short never throws away the approval of the others.

   WHAT IT NEVER DOES: publish. There is no YouTube call, key or upload anywhere in this file. For the main video
   and the two Shorts, "Approve" records the decision AND (in the same database transaction) queues that one item for
   the server-side Bluesky publisher (docs/video-bluesky-queue.sql); this page still posts nothing and holds no
   credential. The founder uploads to YouTube by hand. The Bluesky caption of each item is editable here, and a
   changed caption sends an approved item back to "waiting" so it must be approved again.

   Data: public.hs_youtube_videos_list() (docs/youtube-video-review.sql) returns one row per project,
   including the title/description/ledger text. The big files (MP4s, thumbnail) live in the PRIVATE
   `jody-videos` bucket and are read only on request, through the signed-in session, as blobs
   (the page's CSP allows media from blob:). Every value is escaped before it reaches markup. */
(function () {
  'use strict';
  var HS = (window.HS = window.HS || {});
  var BUCKET = 'jody-videos';
  var blobs = {}; // storage path -> object URL, so a video is downloaded once per visit

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  function mb(v) { var n = Number(v); return isFinite(n) && n > 0 ? (n / 1048576).toFixed(1) + ' MB' : ''; }

  var STATUS = {
    pending: { label: 'Waiting for your review', cls: 'pending' },
    approved: { label: 'Approved by you', cls: 'real' },
    rejected: { label: 'Rejected', cls: 'persist' }
  };

  var FILE_KEYS = ['final', 'short1', 'short2', 'thumbnail'];
  var ACTIVE = { queued: 1, running: 1, validating: 1 };
  var POLL_MS = 10000;

  // Everything the page needs to know about ONE file: the founder's decision, the version it is on, and the
  // newest revision job. The labels below are the seven states the founder named; there is no other state.
  function fileCtx(p, key) {
    var fd = (p.file_decisions && p.file_decisions[key]) || null;
    var f = (p.files && p.files[key]) || {};
    var ver = Number(f.version) || 1;
    var revs = (Array.isArray(p.revisions) ? p.revisions : []).filter(function (r) { return r.file_key === key; });
    var last = revs.length ? revs[revs.length - 1] : null;
    var vers = (Array.isArray(p.versions) ? p.versions : []).filter(function (v) { return v.file_key === key; });
    var dec = fd && Number(fd.version || 1) === ver ? fd : null; // a decision of an older version never counts for this one
    var state;
    if (last && ACTIVE[last.status]) state = last.status === 'validating' ? 'validating' : 'generating';
    else if (dec && dec.status === 'approved') state = 'approved';
    else if (dec && dec.status === 'rejected') {
      state = last && last.parent_version === ver && last.status === 'failed' ? 'failed' : 'rejected';
    } else if (ver > 1) state = 'revised';
    else state = 'pending';
    return { dec: dec, ver: ver, revs: revs, last: last, vers: vers, state: state };
  }

  var STATE = {
    pending: ['Awaiting Review', 'pending'],
    approved: ['Approved', 'real'],
    rejected: ['Rejected — Revision Needed', 'persist'],
    generating: ['Generating Revision', 'pending'],
    validating: ['Validating Revision', 'pending'],
    revised: ['Revised — Awaiting Review', 'pending'],
    failed: ['Generation Failed', 'persist']
  };

  function checksHtml(r) {
    var v = r && r.result && r.result.validation;
    if (!v || !Array.isArray(v.checks)) return '';
    return '<details class="yv-checks"><summary>Checks run on this version</summary><ul>' + v.checks.map(function (c) {
      var mark = !c.verified ? '👂 needs you' : c.ok ? '✓' : '✗';
      return '<li>' + mark + ' <b>' + esc(c.name) + '</b>: ' + esc(c.detail) + '</li>';
    }).join('') + '</ul></details>';
  }

  // One file's decision: its state, the saved note, the revision controls, and Approve / Reject / Undo.
  function decisionBox(ctx, key) {
    var d = ctx.dec || {}, st = ctx.state, last = ctx.last;
    var label = STATE[st][0];
    var isThumb = key === 'thumbnail';
    var gen = isThumb ? 'Generate Revised Thumbnail' : 'Generate Revised Video';
    var busy = st === 'generating' || st === 'validating';
    var h = '<div class="yv-fdec" data-state="' + st + '">' +
      '<span class="tile-tag t-' + STATE[st][1] + ' yv-fstate">' + esc(label) + '</span>';
    if (busy) {
      h += '<p class="sub yv-fprog">' + (st === 'validating' ? 'Checking the corrected version…' : 'Building a corrected version from your note. You can leave this page; it keeps going and will be here when you return.') + '</p>' +
        '<p class="sub yv-fnote">Your note: ' + esc(last.instruction) + '</p>' +
        '<button type="button" class="yv-rcancel" data-rev="' + esc(last.id) + '">Cancel</button>';
    } else {
      if (st === 'revised' && ctx.last && ctx.last.status === 'succeeded') {
        h += '<p class="sub yv-fnote">Corrected from your note: ' + esc(ctx.last.instruction) + '</p>' +
          (ctx.last.result && ctx.last.result.summary ? '<p class="sub">What changed: ' + esc(ctx.last.result.summary) + '</p>' : '') +
          (ctx.last.result && ctx.last.result.validation && ctx.last.result.validation.human_listening_required ? '<p class="sub"><b>Please listen:</b> a machine cannot confirm a pronunciation. Play it and decide.</p>' : '') +
          checksHtml(ctx.last);
      }
      if (st === 'failed') {
        h += '<p class="yv-ferr">' + esc(last.error || 'Generation failed. Your original video is safe.') + '</p>' +
          (last.attempts >= 3 ? '<p class="sub">Three attempts used. Change the note, then generate again.</p>' : '<button type="button" class="yv-rretry" data-rev="' + esc(last.id) + '">Retry Generation</button>');
      }
      if (last && last.status === 'unsupported' && st === 'rejected' && last.parent_version === ctx.ver) {
        h += '<p class="yv-ferr">' + esc(last.error || 'This note cannot be applied automatically.') + '</p>' +
          unsupportedHtml(last);
      }
      if (st === 'rejected' || st === 'failed') {
        h += '<input type="text" class="yv-fnote-in" maxlength="500" placeholder="What is wrong (plain English)" value="' + esc(d.note || '') + '">' +
          '<button type="button" class="yv-fsavenote">Save note</button> ' +
          '<button type="button" class="yv-revise yv-revise-now yv-primary">' + gen + '</button> ' +
          '<button type="button" class="yv-fclear">Undo</button>';
      } else {
        h += '<input type="text" class="yv-fnote-in" maxlength="500" placeholder="Note (what to change, or why)" value="">' +
          '<button type="button" class="yv-fapprove">Approve</button> <button type="button" class="yv-freject">Reject</button>' +
          ' <button type="button" class="yv-revise yv-revise-now yv-primary">' + gen + '</button>' +
          (st === 'approved' ? ' <button type="button" class="yv-fclear">Undo</button>' : '');
      }
    }
    h += '<span class="yv-fmsg sub" role="status"></span>' + historyHtml(ctx, key) + '</div>';
    return h;
  }

  function unsupportedHtml(r) {
    var u = r.plan && Array.isArray(r.plan.unsupported) ? r.plan.unsupported : (r.result && Array.isArray(r.result.unsupported) ? r.result.unsupported : []);
    if (!u.length) return '';
    return '<ul class="sub">' + u.map(function (x) { return '<li>' + esc(x.reason) + (x.suggestion ? ' <i>' + esc(x.suggestion) + '</i>' : '') + '</li>'; }).join('') + '</ul>';
  }

  // Every version stays playable; the earlier ones show what you decided about them.
  function historyHtml(ctx, key) {
    if (ctx.vers.length < 2) return '';
    return '<details class="yv-hist"><summary>Version history (' + ctx.vers.length + ')</summary><ul>' + ctx.vers.map(function (v) {
      var d = v.decision;
      var cur = v.version === ctx.ver;
      return '<li data-path="' + esc(v.path) + '" data-key="' + esc(key) + '"><b>Version ' + esc(v.version) + '</b>' + (cur ? ' (current)' : '') + ' · ' + esc(fmtDate(v.created_at)) +
        (d ? ' · you ' + esc(d.status) + (d.note ? ': “' + esc(d.note) + '”' : '') : (cur ? '' : ' · no decision')) +
        ' <button type="button" class="yv-vplay">▶ Play this version</button></li>';
    }).join('') + '</ul></details>';
  }

  // "3 Approved · 1 Needs Revision": one line over the whole package.
  function summaryLine(p) {
    var n = { approved: 0, rev: 0, gen: 0, wait: 0 };
    FILE_KEYS.forEach(function (k) {
      if (!(p.files && p.files[k] && p.files[k].path)) return;
      var st = fileCtx(p, k).state;
      if (st === 'approved') n.approved++;
      else if (st === 'rejected' || st === 'failed') n.rev++;
      else if (st === 'generating' || st === 'validating') n.gen++;
      else n.wait++;
    });
    var parts = [];
    if (n.approved) parts.push(n.approved + ' Approved');
    if (n.rev) parts.push(n.rev + ' Needs Revision');
    if (n.gen) parts.push(n.gen + ' Generating');
    if (n.wait) parts.push(n.wait + ' Awaiting Review');
    return parts.join(' · ') || 'Nothing uploaded';
  }

  // The full-quality main video, kept as a GitHub Release by the upload workflow (homesignal-ingest
  // scripts/video_archive_release.sh, recorded as meta.master). The review copy above may have been shrunk to fit
  // storage; this is the file to upload to YouTube. Only this repo's video releases are linked.
  var MASTER_URL = /^https:\/\/github\.com\/HomeSignalG\/homesignal-ingest\/releases\/tag\/video-[a-z0-9-]+-run[0-9]+$/;
  function masterLink(m, ctx) {
    if (!m || typeof m.url !== 'string' || !MASTER_URL.test(m.url)) return '';
    if (ctx.ver > 1) {
      return '<p class="sub yv-master">The full-quality file on GitHub is version 1. This main video has a corrected version, which exists only as this review copy.</p>';
    }
    return '<p class="yv-master"><a href="' + esc(m.url) + '" target="_blank" rel="noopener noreferrer">Full-quality file for YouTube</a>' +
      (mb(m.bytes) ? ' <span class="sub">' + esc(mb(m.bytes)) + ', final.mp4 on GitHub</span>' : '') + '</p>';
  }

  var VIDEO_KEYS = ['final', 'short1', 'short2'];
  function nchars(t) { return Array.from(String(t || '')).length; }
  var YT_LINK = /https:\/\/(youtu\.be|www\.youtube\.com)\//;
  // The Bluesky post of ONE item: the editable caption/tags/alt, the exact composed text (composed by the database,
  // never here) and where the item is in the queue. Hidden until the queue exists (columns absent).
  function bskyBox(slug, key, post, job, hasQueue) {
    if (!hasQueue) return '';
    post = post || {};
    var tags = Array.isArray(post.hashtags) ? post.hashtags.join(' ') : '';
    var text = job && job.text ? job.text : '';
    var BV = window.HS && window.HS.acqBlueskyVideos;
    var st = BV && job ? BV.stateOf(job) : null;
    var why = job && job.job_status === 'held' && job.hold_reason && BV ? BV.holdWords(job.hold_reason) : '';
    return '<div class="yv-bsky" data-slug="' + esc(slug) + '" data-key="' + esc(key) + '">' +
      '<div class="yv-file-t">Bluesky post' + (st ? ' <span class="tile-tag t-' + esc(st.cls) + '">' + esc(st.label) + '</span>' : '') + '</div>' +
      '<textarea class="yv-bcap" maxlength="280" rows="4" placeholder="Bluesky caption for this item">' + esc(post.caption || '') + '</textarea>' +
      '<input type="text" class="yv-btags" value="' + esc(tags) + '" placeholder="Hashtags, no # (e.g. Tacoma Dredging JodyTracks)">' +
      '<textarea class="yv-balt" maxlength="1000" rows="2" placeholder="Describe the video for people who cannot see it (alt text)">' + esc(post.alt || '') + '</textarea>' +
      // Whether the post carries the YouTube link is decided by the database (video_bsky_links_youtube): the generator's
      // flag, or a caption with the [YOUTUBE LINK] placeholder. The list row carries that answer; the stored flag is the fallback.
      ((job ? job.link_youtube : post.link_youtube) ? '<p class="sub">' + (YT_LINK.test(text)
        ? 'This post includes the full YouTube link.'
        : 'This post will include the full YouTube link once the main video is public on YouTube (found automatically, or enter it below).') + '</p>' : '') +
      (text ? '<p class="sub"><b>Exactly what will post</b> (' + nchars(text) + ' of 300 characters' + (nchars(text) > 300 ? ' — TOO LONG' : '') + '):</p><pre class="yv-pre">' + esc(text) + '</pre>' : '<p class="sub">Nothing to post yet: write a caption.</p>') +
      (why ? '<p class="sub"><b>Held:</b> ' + esc(why) + '</p>' : '') +
      '<button type="button" class="yv-bsave">Save Bluesky copy</button> <span class="yv-bmsg sub" role="status"></span>' +
      '<p class="sub">Saving changed copy on an approved item sends it back to “waiting”: you approve it again. The copy you approve is the copy that posts.</p>' +
      '</div>';
  }

  function fileTile(slug, key, title, f, portrait, ctx, master, bsky) {
    if (!f || !f.path) return '<div class="yv-file"><div class="yv-file-t">' + esc(title) + '</div><p class="sub">Not uploaded.</p></div>';
    return '<div class="yv-file' + (portrait ? ' yv-portrait' : '') + '" data-slug="' + esc(slug) + '" data-key="' + esc(key) + '" data-path="' + esc(f.path) + '">' +
      '<div class="yv-file-t">' + esc(title) + (mb(f.bytes) ? ' <span class="sub">' + esc(mb(f.bytes)) + '</span>' : '') + '</div>' +
      '<div class="yv-stage"><button type="button" class="yv-play">▶ Load and play</button></div>' +
      '<button type="button" class="yv-dl">Download</button>' +
      (key === 'final' ? masterLink(master, ctx) : '') +
      decisionBox(ctx, key) +
      (bsky || '') +
      '</div>';
  }

  // YouTube channel sync (docs/youtube-channel-sync.sql): what the hourly check found on the channel. Read-only words.
  var ITEM = { final: 'Main video', short1: 'Short 1', short2: 'Short 2' };
  var SHORT_MAX_S = 180;   // YouTube Shorts are at most 3 minutes (homesignal-ingest scripts/youtube_channel_sync.py)
  function ytState(v) {
    if (!v) return null;
    if (v.match_state === 'not_ours') return { label: 'Not a project video', cls: 'pending' };
    if (v.link_state === 'conflict') return { label: 'Needs attention', cls: 'persist', why: 'This project already has a different YouTube link. Clear or fix it below if this video is the right one.' };
    if (v.match_state === 'needs_review' || v.match_state === 'unmatched') return { label: 'Awaiting investigation match', cls: 'persist', why: v.match_note || '' };
    if (v.public_verified_at) return { label: 'Published on YouTube', cls: 'real' };
    if (v.publish_at) return { label: 'Scheduled for ' + fmtDate(v.publish_at), cls: 'pending' };
    if (v.privacy_status === 'unlisted') return { label: 'Unlisted (not public)', cls: 'pending' };
    return { label: 'Uploaded, not public yet', cls: 'pending' };
  }
  function ytLine(v) {
    var st = ytState(v);
    return '<li><a href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer">' + esc(v.title || v.video_id) + '</a> ' +
      '<span class="tile-tag t-' + esc(st.cls) + '">' + esc(st.label) + '</span>' +
      (v.file_key ? ' <span class="sub">' + esc(ITEM[v.file_key] || v.file_key) + '</span>' : '') +
      (v.historical ? ' <span class="sub">(was already on the channel when this started; not linked automatically)</span>' : '') +
      (st.why ? '<br><span class="sub">' + esc(st.why) + '</span>' : '') + '</li>';
  }
  function channelVideosFor(channel, slug) {
    return ((channel && channel.videos) || []).filter(function (v) { return v.slug === slug; })
      .sort(function (a, b) { return (a.file_key || '').localeCompare(b.file_key || ''); });
  }
  // The channel card: when the channel was last checked, and the few videos that need a person (no project match,
  // an uncertain match, or a link conflict). The only manual step, and only for those.
  function isShort(v) { return v && v.duration_s != null && Number(v.duration_s) <= SHORT_MAX_S; }

  function channelCard(channel, rows) {
    if (!channel) return '';
    var lr = channel.last_run || null;
    // Only main videos are linked (founder, 2026-10-28): a Short (3 minutes or less, the sync's SHORT_MAX_S) is never put
    // in front of the founder for a match, and the only choices are a project's main video or "not a project video".
    // The database refuses a Short saved as a main video (hs_youtube_channel_video_match).
    var att = (channel.videos || []).filter(function (v) {
      if (v.historical || isShort(v)) return false;
      return v.match_state === 'needs_review' || v.match_state === 'unmatched' || v.link_state === 'conflict';
    });
    var opts = '<option value="">Choose the project…</option>' + (rows || []).map(function (r) {
      return '<option value="' + esc(r.slug + '|final') + '">' + esc((r.title || r.slug) + ' · ' + ITEM.final) + '</option>';
    }).join('') + '<option value="|none">Not a project video</option>';
    return '<div class="card yv-chan"><h3>YouTube channel</h3>' +
      '<p class="sub">Checked automatically every hour. You do not paste YouTube links: a project\'s link is filled in once its main video is public, and its approved Bluesky posts then go out with it.' +
      (channel.last_ok ? ' Last successful check ' + esc(fmtDate(channel.last_ok)) + '.' : ' Not checked yet.') +
      (lr && !lr.ok ? ' <b>The last check failed:</b> ' + esc(((lr.detail || {}).error) || 'unknown error') + '.' : '') +
      (lr && lr.ok && lr.public_only ? ' (Public videos only: scheduled videos appear when they go public.)' : '') + '</p>' +
      (att.length ? '<p class="sub"><b>' + att.length + ' video' + (att.length === 1 ? '' : 's') + ' need a project match:</b></p><ul class="yv-att">' +
        att.map(function (v) {
          return ytLine(v).replace(/<\/li>$/, '') + '<br><select class="yv-msel" data-vid="' + esc(v.video_id) + '">' + opts + '</select> ' +
            '<button type="button" class="yv-msave" data-vid="' + esc(v.video_id) + '">Save match</button> <span class="yv-mmsg sub" role="status"></span></li>';
        }).join('') + '</ul>' : '<p class="sub">Nothing needs a match.</p>') + '</div>';
  }

  // Per project: the verified full YouTube link and, for the manually posted pilot, the one confirmation that releases
  // its items. With the channel sync the link is found automatically; typing it is only for an exception.
  function projectControls(p, hasQueue, channel) {
    if (!hasQueue) return '';
    var found = channelVideosFor(channel, p.slug);
    var manual = '<p class="sub"><b>Full YouTube link</b>' + (channel ? '' : ' (after you upload the main video; Shorts that point to it wait for it)') + ': ' +
      '<input type="text" class="yv-yturl" size="42" value="' + esc(p.youtube_url || '') + '" placeholder="https://youtu.be/…"> ' +
      '<button type="button" class="yv-ytsave">Save link</button> <span class="yv-pmsg sub" role="status"></span></p>';
    return '<div class="yv-proj" data-slug="' + esc(p.slug) + '">' +
      (channel ? '<p class="sub"><b>On YouTube</b> (found automatically): ' +
          (p.youtube_url ? '<a href="' + esc(p.youtube_url) + '" target="_blank" rel="noopener noreferrer">' + esc(p.youtube_url) + '</a>' : 'no public main video yet') + '</p>' +
          (found.length ? '<ul class="yv-found">' + found.map(ytLine).join('') + '</ul>' : '<p class="sub">No video on the channel matches this project yet.</p>') : '') +
      (p.reconcile_required
        ? '<p class="sub"><b>Check Bluesky first.</b> Some of this project was posted to Bluesky by hand. Nothing here will post until you confirm you have checked. ' +
          '<button type="button" class="yv-recon">I checked Bluesky — allow this project to post</button></p>' : '') +
      (channel ? '<details><summary class="sub">Fix the link by hand (only if the automatic match is wrong)</summary>' + manual + '</details>' : manual) + '</div>';
  }

  function card(p, jobs, hasQueue, channel) {
    p = p || {};
    var st = STATUS[p.status] || STATUS.pending;
    var files = p.files || {};
    var meta = p.meta || {};
    var titles = Array.isArray(meta.titles) ? meta.titles : [];
    var fd = p.file_decisions && typeof p.file_decisions === 'object' ? p.file_decisions : {};
    jobs = jobs || {};
    hasQueue = !!hasQueue;
    var bp = p.bsky_posts && typeof p.bsky_posts === 'object' ? p.bsky_posts : {};
    var present = FILE_KEYS.filter(function (k) { return files[k] && files[k].path; });
    var ctx = {}; FILE_KEYS.forEach(function (k) { ctx[k] = fileCtx(p, k); });
    return '<div class="card yv-card" data-slug="' + esc(p.slug) + '">' +
      '<h3>' + esc(p.title || p.slug) + ' <span class="tile-tag t-' + st.cls + '">' + esc(st.label) + '</span></h3>' +
      '<p class="sub">Project <code>' + esc(p.slug) + '</code> · built ' + esc(fmtDate(p.created_at)) +
      ' · <b class="yv-summary">' + esc(summaryLine(p)) + '</b>' +
      (p.decided_at ? ' · last decision ' + esc(fmtDate(p.decided_at)) + (p.decided_by ? ' by ' + esc(p.decided_by) : '') : '') + '</p>' +
      '<p class="sub">' + (hasQueue
        ? '<b>Approving the main video or a Short queues it for Bluesky</b> and it posts by itself at its scheduled time (see Bluesky Posts → VIDEOS). Approve or reject each file once. Nothing is ever posted to YouTube: you upload there yourself.'
        : '<b>Nothing here is published.</b> Approve or reject each file below; approving only records your decision. You upload to YouTube yourself.') + '</p>' +
      projectControls(p, hasQueue, channel) +
      '<div class="yv-files">' +
        fileTile(p.slug, 'final', 'Main video', files.final, false, ctx.final, meta.master, bskyBox(p.slug, 'final', bp.final, jobs[p.slug + '|final'], hasQueue)) +
        fileTile(p.slug, 'short1', 'Short 1', files.short1, true, ctx.short1, null, bskyBox(p.slug, 'short1', bp.short1, jobs[p.slug + '|short1'], hasQueue)) +
        fileTile(p.slug, 'short2', 'Short 2', files.short2, true, ctx.short2, null, bskyBox(p.slug, 'short2', bp.short2, jobs[p.slug + '|short2'], hasQueue)) +
        '<div class="yv-file yv-thumbwrap"' + (files.thumbnail && files.thumbnail.path ? ' data-slug="' + esc(p.slug) + '" data-key="thumbnail" data-path="' + esc(files.thumbnail.path) + '"' : '') + '>' +
          '<div class="yv-file-t">Thumbnail</div><div class="yv-stage yv-thumb">' + (files.thumbnail && files.thumbnail.path ? '<span class="sub">Loading…</span>' : '<span class="sub">Not uploaded.</span>') + '</div>' +
          (files.thumbnail && files.thumbnail.path ? '<button type="button" class="yv-dl">Download</button>' + decisionBox(ctx.thumbnail, 'thumbnail') : '') + '</div>' +
      '</div>' +
      '<details open><summary><b>Title options</b></summary>' +
        (titles.length ? '<ol>' + titles.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' : '<p class="sub">None.</p>') + '</details>' +
      '<details><summary><b>Description (with source links)</b></summary><pre class="yv-pre">' + esc(meta.description || '') + '</pre>' +
        (meta.tags ? '<p class="sub">Tags: ' + esc(meta.tags) + '</p>' : '') + '</details>' +
      '<details><summary><b>Review ledger</b> (every spoken sentence beside the record words behind it)</summary><pre class="yv-pre">' + esc(meta.ledger || '') + '</pre></details>' +
      (p.note && !present.some(function (k) { return fd[k]; }) ? '<p class="sub">Earlier note on the whole package: ' + esc(p.note) + '</p>' : '') +
    '</div>';
  }

  var CSS = '<style>.yv-files{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0}.yv-file{flex:1 1 320px;max-width:560px}' +
    '.yv-file.yv-portrait{flex:0 1 220px}.yv-file-t{font-weight:600;margin-bottom:4px}.yv-stage{background:#000;border-radius:8px;min-height:90px;display:flex;align-items:center;justify-content:center}' +
    '.yv-stage video,.yv-stage img{width:100%;border-radius:8px;display:block}.yv-pre{white-space:pre-wrap;max-height:340px;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:12px}' +
    '.yv-fdec{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.yv-fnote-in{flex:1 1 100%;padding:6px}.yv-fnote{flex:1 1 100%;margin:0}' +
    '.yv-play,.yv-dl,.yv-fapprove,.yv-freject,.yv-fclear,.yv-fsavenote,.yv-revise,.yv-rretry,.yv-rcancel,.yv-vplay,.yv-bsave,.yv-ytsave,.yv-recon,.yv-msave{padding:6px 10px;cursor:pointer}' +
    '.yv-primary{font-weight:700}.yv-ferr{flex:1 1 100%;margin:0;color:#8a2b24}.yv-fprog{flex:1 1 100%;margin:0}.yv-hist,.yv-checks{flex:1 1 100%}' +
    '.yv-vvideo{display:block;max-width:100%;max-height:300px;margin-top:6px}' +
    '.yv-bsky{margin-top:10px;border-top:1px solid var(--line);padding-top:8px;display:flex;flex-direction:column;gap:6px}.yv-bcap,.yv-balt,.yv-btags{width:100%;box-sizing:border-box;padding:6px;font:inherit}' +
    '</style>';

  function render(rows, jobs, hasQueue, channel) {
    rows = Array.isArray(rows) ? rows : [];
    return CSS + '<div class="card"><h3>YouTube Videos</h3>' +
      '<p class="sub">Finished videos from the JODY video pipeline, waiting for your approval. Play them here, read the review ledger, then approve or reject. ' +
      'The system never posts to YouTube: you upload an approved video yourself.</p></div>' +
      (hasQueue ? channelCard(channel, rows) : '') +
      (rows.length ? rows.map(function (r) { return card(r, jobs, hasQueue, channel); }).join('') : '<div class="card"><p class="sub">No videos have been uploaded for review yet.</p></div>');
  }

  function getBlob(client, path) {
    if (blobs[path]) return Promise.resolve(blobs[path]);
    return client.storage.from(BUCKET).download(path).then(function (r) {
      if (!r || r.error || !r.data) return null;
      blobs[path] = URL.createObjectURL(r.data);
      return blobs[path];
    }, function () { return null; });
  }

  // Server refusals are written for the founder; show them, not an error code.
  function friendlyRpc(e) {
    var m = e && e.message ? String(e.message) : '';
    if (e && e.code === '42501') return 'You are not signed in as an admin.';
    return m && m.length < 220 ? m : 'Could not complete that (' + ((e && e.code) || 'error') + ').';
  }

  function wire(client, root, reload) {
    root.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var tile = t.closest('.yv-file');
      var cardEl = t.closest('.yv-card');
      if (t.classList.contains('yv-play') && tile) {
        t.disabled = true; t.textContent = 'Loading…';
        getBlob(client, tile.getAttribute('data-path')).then(function (u) {
          var stage = tile.querySelector('.yv-stage');
          if (!u) { t.disabled = false; t.textContent = '▶ Load and play'; stage.insertAdjacentHTML('beforeend', '<span class="sub">Could not read the file. Try again.</span>'); return; }
          stage.innerHTML = '<video controls playsinline preload="metadata" src="' + esc(u) + '"></video>';
        });
      } else if (t.classList.contains('yv-dl') && tile) {
        var path = tile.getAttribute('data-path');
        t.disabled = true;
        getBlob(client, path).then(function (u) {
          t.disabled = false;
          if (!u) return;
          var a = document.createElement('a');
          a.href = u; a.download = tile.getAttribute('data-slug') + '-' + tile.getAttribute('data-key') + path.slice(path.lastIndexOf('.'));
          document.body.appendChild(a); a.click(); a.remove();
        });
      } else if (t.classList.contains('yv-vplay')) {
        var li = t.closest('li');
        t.disabled = true; t.textContent = 'Loading…';
        getBlob(client, li.getAttribute('data-path')).then(function (u) {
          t.disabled = false; t.textContent = '▶ Play this version';
          if (!u) { t.insertAdjacentHTML('afterend', ' <span class="sub">Could not read this version.</span>'); return; }
          var old = li.querySelector('video'); if (old) old.remove();
          li.insertAdjacentHTML('beforeend', '<video controls playsinline preload="metadata" class="yv-vvideo" src="' + esc(u) + '"></video>');
        });
      } else if (t.classList.contains('yv-revise') && tile) {
        // THE BUTTON: validates the rejection and the saved note on the server, creates a durable job, returns at once.
        var rmsg = tile.querySelector('.yv-fmsg');
        var rslug = tile.getAttribute('data-slug'), rkey = tile.getAttribute('data-key');
        var startRevision = function () {
          return client.rpc('hs_youtube_video_revise', { p_slug: rslug, p_key: rkey });
        };
        var fail = function () { t.disabled = false; rmsg.textContent = 'Could not reach the server. Nothing was started. Try again.'; };
        var done = function (r) {
          if (r && r.error) { t.disabled = false; rmsg.textContent = friendlyRpc(r.error); return; }
          reload();
        };
        if (t.classList.contains('yv-revise-now')) {
          // From "awaiting review": the typed note IS the rejection. Save it as the rejection, then start the revision.
          var rnote = (tile.querySelector('.yv-fnote-in') || {}).value || '';
          if (!rnote.trim()) { rmsg.textContent = 'Write what to change in the note box first, then click Generate.'; return; }
          var wasApproved = (t.closest('.yv-fdec') || {}).getAttribute && t.closest('.yv-fdec').getAttribute('data-state') === 'approved';
          if (wasApproved && !window.confirm('This file is approved. Generating a revised version replaces your approval, and the new version will need its own approval. The current version is kept. Continue?')) return;
          t.disabled = true; rmsg.textContent = 'Saving your note, then starting…';
          client.rpc('hs_youtube_video_file_decide', { p_slug: rslug, p_key: rkey, p_status: 'rejected', p_note: rnote }).then(function (d1) {
            if (d1 && d1.error) { t.disabled = false; rmsg.textContent = friendlyRpc(d1.error); return; }
            return startRevision().then(done, fail);
          }, fail);
          return;
        }
        t.disabled = true; rmsg.textContent = 'Starting…';
        startRevision().then(done, fail);
      } else if (t.classList.contains('yv-rretry') || t.classList.contains('yv-rcancel')) {
        var which = t.classList.contains('yv-rretry') ? 'hs_youtube_video_revision_retry' : 'hs_youtube_video_revision_cancel';
        var m2 = t.closest('.yv-fdec').querySelector('.yv-fmsg');
        t.disabled = true; m2.textContent = 'Working…';
        client.rpc(which, { p_revision_id: t.getAttribute('data-rev') }).then(function (r) {
          if (r && r.error) { t.disabled = false; m2.textContent = friendlyRpc(r.error); return; }
          reload();
        }, function () { t.disabled = false; m2.textContent = 'Could not reach the server. Try again.'; });
      } else if (t.classList.contains('yv-fsavenote') && tile) {
        var m3 = tile.querySelector('.yv-fmsg');
        var nv = tile.querySelector('.yv-fnote-in').value;
        if (!nv.trim()) { m3.textContent = 'Write what is wrong first.'; return; }
        m3.textContent = 'Saving…';
        client.rpc('hs_youtube_video_file_decide', { p_slug: tile.getAttribute('data-slug'), p_key: tile.getAttribute('data-key'), p_status: 'rejected', p_note: nv }).then(function (r) {
          if (r && r.error) { m3.textContent = friendlyRpc(r.error); return; }
          reload();
        }, function () { m3.textContent = 'Could not reach the server. Try again.'; });
      } else if ((t.classList.contains('yv-fapprove') || t.classList.contains('yv-freject') || t.classList.contains('yv-fclear')) && tile) {
        var status = t.classList.contains('yv-fapprove') ? 'approved' : t.classList.contains('yv-freject') ? 'rejected' : 'pending';
        var key = tile.getAttribute('data-key');
        var slug = tile.getAttribute('data-slug');
        var msg = tile.querySelector('.yv-fmsg');
        var noteIn = tile.querySelector('.yv-fnote-in');
        var note = noteIn ? noteIn.value : '';
        var queues = status === 'approved' && VIDEO_KEYS.indexOf(key) >= 0 && !!tile.querySelector('.yv-bsky');
        if (status !== 'pending' && !window.confirm((status === 'approved' ? 'Approve' : 'Reject') + ' this file (' + key + ')? ' +
          (queues ? 'It will be queued for Bluesky and post automatically at its scheduled time. Nothing is posted to YouTube.' : 'This only records your decision. Nothing is posted to YouTube.'))) return;
        msg.textContent = 'Saving…';
        client.rpc('hs_youtube_video_file_decide', { p_slug: slug, p_key: key, p_status: status, p_note: note || null }).then(function (r) {
          if (r && r.error) { msg.textContent = friendlyRpc(r.error); return; }
          reload();
        }, function () { msg.textContent = 'Could not reach the server. Try again.'; });
      } else if (t.classList.contains('yv-bsave')) {
        var box = t.closest('.yv-bsky');
        var bmsg = box.querySelector('.yv-bmsg');
        var tags = box.querySelector('.yv-btags').value.split(/[\s,#]+/).filter(Boolean);
        bmsg.textContent = 'Saving…';
        client.rpc('hs_video_bluesky_caption_set', {
          p_slug: box.getAttribute('data-slug'), p_key: box.getAttribute('data-key'),
          p_caption: box.querySelector('.yv-bcap').value, p_hashtags: tags, p_alt: box.querySelector('.yv-balt').value
        }).then(function (r) {
          if (r && r.error) { bmsg.textContent = 'Could not save (' + (r.error.message || r.error.code || 'error') + ').'; return; }
          reload();
        }, function () { bmsg.textContent = 'Could not reach the server. Try again.'; });
      } else if (t.classList.contains('yv-msave')) {
        var li = t.closest('li');
        var mmsg = li.querySelector('.yv-mmsg');
        var choice = (li.querySelector('.yv-msel') || {}).value || '';
        if (!choice) { mmsg.textContent = 'Choose a project item first.'; return; }
        var parts = choice.split('|');
        mmsg.textContent = 'Saving…';
        client.rpc('hs_youtube_channel_video_match', { p_video_id: t.getAttribute('data-vid'), p_slug: parts[0] || null, p_key: parts[1] === 'none' ? null : parts[1] })
          .then(function (r) {
            if (r && r.error) { mmsg.textContent = friendlyRpc(r.error); return; }
            reload();
          }, function () { mmsg.textContent = 'Could not reach the server. Try again.'; });
      } else if (t.classList.contains('yv-ytsave') || t.classList.contains('yv-recon')) {
        var pr = t.closest('.yv-proj');
        var pmsg = pr.querySelector('.yv-pmsg') || t;
        var call = t.classList.contains('yv-recon')
          ? client.rpc('hs_video_reconcile_done', { p_slug: pr.getAttribute('data-slug') })
          : client.rpc('hs_video_youtube_url_set', { p_slug: pr.getAttribute('data-slug'), p_url: pr.querySelector('.yv-yturl').value.trim() || null });
        if (pmsg.textContent !== undefined && pmsg !== t) pmsg.textContent = 'Saving…';
        call.then(function (r) {
          if (r && r.error) { if (pmsg !== t) pmsg.textContent = 'Could not save (' + (r.error.message || r.error.code || 'error') + ').'; return; }
          reload();
        }, function () { if (pmsg !== t) pmsg.textContent = 'Could not reach the server. Try again.'; });
      }
    });
  }

  function loadThumbs(client, root) {
    var els = root.querySelectorAll('.yv-thumbwrap[data-path]');
    Array.prototype.forEach.call(els, function (el) {
      getBlob(client, el.getAttribute('data-path')).then(function (u) {
        var st = el.querySelector('.yv-stage');
        st.innerHTML = u ? '<img alt="Proposed thumbnail" src="' + esc(u) + '">' : '<span class="sub">Could not read the thumbnail.</span>';
      });
    });
  }

  // While a revision is being generated the page asks again every few seconds, so the founder can leave and come
  // back to the result. It never reloads under a video that is playing.
  var pollTimer = null;
  function anyActive(rows) {
    return (rows || []).some(function (p) { return (p.revisions || []).some(function (r) { return ACTIVE[r.status]; }); });
  }
  function schedulePoll(container, rows, reload) {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (!anyActive(rows)) return;
    pollTimer = setTimeout(function () {
      pollTimer = null;
      if (!document.body.contains(container)) return;
      var playing = Array.prototype.some.call(container.querySelectorAll('video'), function (v) { return !v.paused && !v.ended; });
      if (playing) { schedulePoll(container, rows, reload); return; }
      reload();
    }, POLL_MS);
  }

  HS.acqYoutubeVideos = {
    esc: esc, render: render, card: card, masterLink: masterLink, fileCtx: fileCtx, summaryLine: summaryLine, ytState: ytState, channelCard: channelCard,
    load: function (client, container) {
      if (!client || !container) return Promise.resolve(false);
      var wired = container.getAttribute('data-yv-wired') === '1';
      container.innerHTML = '<div class="gate-loading">Loading videos…</div>';
      function reload() { return HS.acqYoutubeVideos.load(client, container); }
      return Promise.all([
        client.rpc('hs_youtube_videos_list'),
        // The Bluesky queue is optional: until docs/video-bluesky-queue.sql is applied this call fails and the tab is unchanged.
        client.rpc('hs_video_jobs_list').then(function (q) { return q && !q.error && Array.isArray(q.data) ? q.data : null; }, function () { return null; }),
        // The channel sync is optional too: until docs/youtube-channel-sync.sql is applied, the hand-typed link stays the only way.
        client.rpc('hs_youtube_channel_videos_list').then(function (c) { return c && !c.error && c.data && Array.isArray(c.data.videos) ? c.data : null; }, function () { return null; })
      ]).then(function (both) {
        var r = both[0], q = both[1], ch = both[2];
        if (r && r.error) {
          container.innerHTML = '<div class="card"><h3>Couldn’t load</h3><p class="sub">The video list could not be read (' + esc(r.error.code || 'error') + ').</p></div>';
          return false;
        }
        var jobs = {};
        (q || []).forEach(function (it) { jobs[it.slug + '|' + it.file_key] = it; });
        container.innerHTML = render(r && r.data, jobs, q !== null, ch);
        if (!wired) { wire(client, container, reload); container.setAttribute('data-yv-wired', '1'); }
        loadThumbs(client, container);
        schedulePoll(container, (r && r.data) || [], reload);
        return true;
      }, function () {
        container.innerHTML = '<div class="card"><h3>Couldn’t load</h3><p class="sub">The video list could not be reached. Try again.</p></div>';
        return false;
      });
    }
  };
})();
