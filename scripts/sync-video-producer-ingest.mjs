#!/usr/bin/env node
// Sync the authoritative Video Producer client asset to homesignal-ingest.
// Source of truth: assets/acquisition-video-producer.js (served by acquisition.html).
// Target: ../homesignal-ingest/dashboard/video_producer.js (+ compatibility shim).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const siteJs = path.join(root, 'assets/acquisition-video-producer.js');
const shimJs = path.join(root, 'scripts/video-producer-ingest-shim.js');
const ingestJs = path.resolve(root, '../homesignal-ingest/dashboard/video_producer.js');

if (!fs.existsSync(siteJs)) {
  console.error('Missing site asset:', siteJs);
  process.exit(1);
}
if (!fs.existsSync(shimJs)) {
  console.error('Missing shim:', shimJs);
  process.exit(1);
}
if (!fs.existsSync(path.dirname(ingestJs))) {
  console.error('Ingest repo not found at', ingestJs, '— set HOMESIGNAL_INGEST_ROOT or clone sibling repo.');
  process.exit(1);
}

const out = fs.readFileSync(siteJs, 'utf8').trimEnd() + '\n\n' + fs.readFileSync(shimJs, 'utf8').trimEnd() + '\n';
fs.writeFileSync(ingestJs, out);
console.log('Synced', ingestJs, '(' + out.length + ' bytes)');
