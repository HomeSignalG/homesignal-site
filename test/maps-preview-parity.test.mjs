// MAPS founder-review / publisher PARITY.
//
// The preview is an approval gate, so the properties below are asserted against the
// SHIPPED publisher source (homesignal-ingest/bluesky/publish-worker.mjs) and the
// SHIPPED dashboard (acquisition.html) rather than against a description of them.
// If either side drifts, this fails.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DASH = readFileSync(join(HERE, '..', 'acquisition.html'), 'utf8');
const WORKER_PATH = join(HERE, '..', '..', 'homesignal-ingest', 'bluesky', 'publish-worker.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

console.log('MAPS preview/publisher parity');

// ---------------------------------------------------------------- root cause is fixed
ok('CSP allows blob: as an image source',
  /img-src 'self' data: blob:;/.test(DASH));
ok('CSP still does NOT list the Supabase host as an image source (narrower fix held)',
  !/img-src[^;]*supabase\.co/.test(DASH));
ok('CSP still allows the Supabase host for connect-src (the download path)',
  /connect-src[^;]*https:\/\/[a-z0-9]+\.supabase\.co/.test(DASH));

// ------------------------------------------------------- one image path, both surfaces
ok('images are fetched with storage.download(), not a signed URL',
  /storage\.from\('social-images'\)\.download\(/.test(DASH));
ok('no createSignedUrl call survives in the page',
  !/hsClient\.storage[\s\S]{0,80}createSignedUrl\(/.test(DASH));
ok('the bucket is never made public from the page',
  !/getPublicUrl/.test(DASH));
ok('no service-role key is present in the page',
  !/service_role|SUPABASE_SERVICE|SUPABASE_WRITE_KEY/.test(DASH));

// --------------------------------------------------- rendered, not merely resolved
ok('_bskyImgOk is set only inside an img.onload handler',
  /img\.onload\s*=\s*function\(\)\{\s*_bskyImgOk\[p\.id\]\s*=\s*true/.test(DASH));
ok('an image error path clears nothing and reports the failure',
  /img\.onerror/.test(DASH) && /failed to render/.test(DASH));
ok('object URLs are revoked before each re-render',
  /revokeObjectURL/.test(DASH) && /bskyReleaseBlobs\(\);\s*\/\//.test(DASH));

// ------------------------------------------------------------- CASE B isolation
// Each post's blob is keyed by its own id, so one draft can never show another's image.
ok('blob cache is keyed per post id', /_bskyBlobUrl\[p\.id\]/.test(DASH));
ok('the modal drops a late callback that belongs to a different post',
  /if\(bskyEditId!==pid\) return;/.test(DASH));

// ------------------------------------------------------------- CASE C honesty
ok('a no-image draft states the absence instead of showing a placeholder',
  /NO IMAGE — this post publishes as text \+ a bare/.test(DASH));
ok('no placeholder/stand-in image is ever substituted',
  !/placeholder\.(png|svg|jpg)/i.test(DASH));

// ------------------------------------------------------------- STEP 6 fail-closed
ok('the Approve button renders LOCKED for an image-bearing MAPS draft',
  /data-gate="image" disabled/.test(DASH));
ok('the click handler re-checks the gate (button state alone is not the control)',
  /if\(mapsImageRequired\(gr\) && !_bskyImgOk\[id\]\)\{[\s\S]{0,400}?return;/.test(DASH));
ok('the gate is scoped to MAPS and does not touch ALERTS',
  /content_family === 'MAPS' && p\.image_bucket_path/.test(DASH));

// ------------------------------------------------- payload parity vs the REAL publisher
if (!existsSync(WORKER_PATH)) {
  console.log('  skip publisher-source assertions — homesignal-ingest not in this checkout');
} else {
  const W = readFileSync(WORKER_PATH, 'utf8');
  const bodyOf = (re) => (W.match(re) || [''])[0];

  ok('publisher builds an app.bsky.embed.external record',
    /\$type:\s*'app\.bsky\.embed\.external'/.test(W));
  ok('preview names that same embed type',
    /app\.bsky\.embed\.external/.test(DASH));

  ok('publisher uses the screenshot as the card THUMB, not a separate image embed',
    /thumb\s*\?\s*\{\s*thumb\s*\}/.test(W) && !/app\.bsky\.embed\.images/.test(W));
  ok('preview says thumb, and denies a separate image embed',
    /rides as its[\s\S]{0,40}<code>thumb<\/code>[\s\S]{0,80}no separate image embed/.test(DASH));

  ok('publisher reads the image from social-images/<image_bucket_path>',
    /object\/social-images\/\$\{encodeURIComponent\(p\.image_bucket_path\)\}/.test(W));
  ok('preview reads the same bucket and the same column',
    /from\('social-images'\)\.download\(p\.image_bucket_path\)/.test(DASH));

  ok('publisher text is post_text verbatim through RichText',
    /new RichText\(\{\s*text:\s*p\.post_text\s*\}\)/.test(W));
  ok('preview states the text is verbatim and facets are auto-detected',
    /verbatim[\s\S]{0,120}auto-detects link\/tag facets/.test(DASH));

  ok('publisher takes uri/title/description from p.embed',
    /uri:\s*p\.embed\.uri/.test(W) && /title:\s*p\.embed\.title/.test(W)
      && /description:\s*p\.embed\.description/.test(W));

  // THE TWO GAPS. These assert an ABSENCE in the publisher, so they are also the alarm
  // if someone later adds hashtag or alt support and forgets the preview.
  ok('publisher never reads the hashtags column (0 occurrences)',
    !/hashtags/.test(W));
  ok('preview warns that stored hashtags are NOT published',
    /STORED BUT NOT PUBLISHED/.test(DASH));

  ok('publisher never sends alt text (0 occurrences)',
    !/\balt\b/.test(W));
  ok('preview states no alt text is sent',
    /alt text[\s\S]{0,200}none is sent/.test(DASH));

  ok('publisher only ever selects APPROVED rows whose slot has arrived',
    /status=eq\.approved&scheduled_slot=lte\./.test(bodyOf(/async function due\(\)[\s\S]*?\n\}/)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
