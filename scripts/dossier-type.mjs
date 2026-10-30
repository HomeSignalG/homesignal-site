// Type and lifecycle for development dossiers, from the ONE authority (lib/project-type.js).
// stdin: { "<project_key>": { name, type, status } } — each dossier's defining record as its
// owning table states it. stdout: { "<project_key>": { type: {typeKey,label}, lifecycle: {key,label} } }.
// Called by scripts/development_pages.py::annotate; the dossier never classifies on its own.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: { HS: {} }, console };
ctx.HS = ctx.window.HS;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here, '..', 'lib', 'project-type.js'), 'utf8'), ctx);
const HS = ctx.window.HS;
if (typeof HS.canonicalProjectType !== 'function' || typeof HS.canonicalLifecycle !== 'function') {
  console.error('lib/project-type.js did not define the Type/lifecycle authority');
  process.exit(1);
}
const asks = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = {};
for (const [k, row] of Object.entries(asks)) {
  out[k] = { type: HS.canonicalProjectType(row), lifecycle: HS.canonicalLifecycle(row) };
}
process.stdout.write(JSON.stringify(out));
