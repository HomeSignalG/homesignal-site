// Prototype helper: asks the ONE Type/lifecycle authority (lib/project-type.js) about a
// defining record. The dossier never classifies on its own. Usage: node type.mjs '<json row>'
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', '..', '..', 'lib', 'project-type.js'), 'utf8');
const ctx = { window: { HS: {} }, console };
ctx.HS = ctx.window.HS;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const row = JSON.parse(process.argv[2]);
const t = ctx.window.HS.canonicalProjectType(row);
const l = ctx.window.HS.canonicalLifecycle(row);
process.stdout.write(JSON.stringify({ type: t, lifecycle: l }));
