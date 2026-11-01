// The production-credential boundary: the line scanner its rule tests share (stdlib only; the repo
// carries no YAML dependency). Moved verbatim on 2026-10-25 from
// test/production-boundary-new-workflows.test.mjs so test/production-boundary.test.mjs reads workflows
// with the SAME code: two copies of a scanner can disagree about what a file says.
//
// Lives under test/, imported by tests only; it never reaches the Pages artifact.
import { isCommentLine } from './production-boundary.mjs';

export const indentOf = (l) => l.match(/^ */)[0].length;
export const blank = (l) => l.trim() === '';
export const skippable = (l) => blank(l) || isCommentLine(l);

// ── the scanner (stdlib line scanner; the repo carries no YAML dependency) ──────────────────────

/** A top-level key's inline value and its indented body. */
export function topBlock(lines, keyRe) {
  const i = lines.findIndex((l) => keyRe.test(l));
  if (i < 0) return null;
  const inline = lines[i].replace(keyRe, '').replace(/\s+#.*$/, '').trim();
  const body = [];
  for (let k = i + 1; k < lines.length; k++) {
    if (/^\S/.test(lines[k]) && !isCommentLine(lines[k])) break;
    body.push(lines[k]);
  }
  return { line: i, inline, body };
}

export function triggerNames(on) {
  if (on.inline) {
    const t = on.inline.replace(/^\[|\]$/g, '').replace(/^\{|\}$/g, '');
    return t.split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
  }
  const keyed = on.body.filter((l) => !skippable(l));
  if (!keyed.length) return [];
  const ind = Math.min(...keyed.map(indentOf));
  const names = [];
  for (const l of keyed) {
    if (indentOf(l) !== ind) continue;
    const m = l.match(/^\s*-\s+([A-Za-z_]+)\s*$/) || l.match(/^\s*([A-Za-z_]+)\s*:/);
    names.push(m ? m[1] : l.trim());
  }
  return names;
}

export function parseJobs(lines) {
  const j = lines.findIndex((l) => /^jobs\s*:\s*(#.*)?$/.test(l));
  if (j < 0) return null;
  const jobs = [];
  let cur = null;
  for (let k = j + 1; k < lines.length; k++) {
    const l = lines[k];
    if (/^\S/.test(l) && !isCommentLine(l)) break;
    const m = l.match(/^ {2}([A-Za-z0-9_-]+)\s*:\s*(#.*)?$/);
    if (m) { cur = { name: m[1], body: [] }; jobs.push(cur); continue; }
    if (cur) cur.body.push({ n: k, l });
  }
  return jobs;
}

/** The first step's text (lines from its `- ` to the next step), or an error string. */
export function firstStep(job) {
  const s = job.body.findIndex(({ l }) => /^ {4}steps\s*:\s*(#.*)?$/.test(l));
  if (s < 0) return { error: 'no steps: block at job indent' };
  let k = s + 1;
  while (k < job.body.length && skippable(job.body[k].l)) k++;
  if (k >= job.body.length || !/^ {6}- /.test(job.body[k].l)) return { error: 'first step not found at 6-space indent' };
  const start = k;
  for (k = start + 1; k < job.body.length; k++) {
    const l = job.body[k].l;
    if (/^ {6}- /.test(l)) break;
    if (!skippable(l) && indentOf(l) < 8) break;
  }
  return { text: job.body.slice(start, k).map((x) => x.l).join('\n') };
}

export function dedent(text, n) {
  const pad = ' '.repeat(n);
  const out = [];
  for (const l of text.split('\n')) {
    if (l === '') { out.push(l); continue; }
    if (!l.startsWith(pad)) return null;
    out.push(l.slice(n));
  }
  return out.join('\n');
}

/** Every value of a key (inline remainder plus its more-indented continuation lines). Lines inside
 *  a run: value are skipped, so script text such as Python's `with` is never read as a key. */
export function keyBlocks(lines, key, skip = new Set()) {
  const out = [];
  const re = new RegExp(`^(\\s*)(- )?${key}\\s*:(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isCommentLine(l) || skip.has(i)) continue;
    const m = l.match(re);
    if (!m) continue;
    const keyIndent = m[1].length + (m[2] ? 2 : 0);
    const text = [m[3]];
    let k = i + 1;
    for (; k < lines.length; k++) {
      if (blank(lines[k]) || indentOf(lines[k]) > keyIndent) text.push(lines[k]); else break;
    }
    out.push({ line: i + 1, start: i, end: k, text: text.join('\n') });
    i = k - 1;
  }
  return out;
}
export const runBlocks = (lines) => keyBlocks(lines, 'run');

/** The steps of a job: arrays of {n, l}, each from its `- ` line to the next step. */
export function stepsOf(job) {
  const s = job.body.findIndex(({ l }) => /^ {4}steps\s*:\s*(#.*)?$/.test(l));
  if (s < 0) return [];
  const steps = [];
  let cur = null;
  for (let k = s + 1; k < job.body.length; k++) {
    const { l } = job.body[k];
    if (/^ {6}- /.test(l)) { cur = [job.body[k]]; steps.push(cur); continue; }
    if (!skippable(l) && indentOf(l) < 6) break;
    if (cur) cur.push(job.body[k]);
  }
  return steps;
}

/** A step-level key's value (first line after the colon plus deeper continuation lines), or null. */
export function stepKey(step, key) {
  const re = new RegExp(`^(?: {6}- | {8})${key}\\s*:(.*)$`);
  for (let i = 0; i < step.length; i++) {
    const m = step[i].l.match(re);
    if (!m) continue;
    const parts = [m[1]];
    for (let k = i + 1; k < step.length && (blank(step[k].l) || indentOf(step[k].l) > 8); k++) {
      if (!isCommentLine(step[k].l)) parts.push(step[k].l);
    }
    return parts.join('\n');
  }
  return null;
}

/** An if: value as an expression: block-scalar indicator, quotes and a ${{ }} wrapper removed. */
export function ifExpression(value) {
  let e = value.trim().replace(/^[|>][+-]?\s*\n/, '').trim();
  if (e.length >= 2 && (e[0] === '"' || e[0] === "'") && e[e.length - 1] === e[0]) e = e.slice(1, -1).trim();
  const m = e.match(/^\$\{\{([\s\S]*)\}\}$/);
  return (m ? m[1] : e).trim();
}

/** Split an expression on && at parenthesis depth 0, outside '…' strings. */
export function topLevelAnd(e) {
  const out = [];
  let depth = 0, quoted = false, cur = '';
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (quoted) { cur += c; if (c === "'") quoted = false; continue; }
    if (c === "'") { quoted = true; cur += c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0 && e.startsWith('&&', i)) { out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

export const BOUNDARY_CONJUNCT = "steps.boundary.outcome != 'failure'";
// Env keys that change how bash starts or what its builtins do.
export const SHELL_ENV_KEY = /(^\s*|[{,]\s*)['"]?(BASH_ENV|ENV|BASH_FUNC_[^'"\s:]*|SHELLOPTS|BASHOPTS|PS4)['"]?\s*:/;

// A line that references secrets in any form: ${{ … secrets … }}, secrets.NAME, secrets[...].
// Since 2026-11-01 any case counts INSIDE ${{ }} (GitHub resolves `Secrets.X` like `secrets.X`); outside an
// expression only the lower-case form counts, so prose such as "repository Secrets. The" is not a reference.
// STEP_ENV_SECRET below stays lower-case, so a production job must write the canonical form.
const SECRET_IN_EXPR = /\$\{\{[^}]*\bsecrets\b/i;
const SECRET_BARE = /\bsecrets\s*(?:\.\s*[A-Za-z_]|\[)/;
export const SECRET_REF = { test: (l) => SECRET_IN_EXPR.test(l) || SECRET_BARE.test(l) };
// The only accepted form: the WHOLE value of a step-level env key.
export const STEP_ENV_SECRET = /^ {10}([A-Za-z_][A-Za-z0-9_]*): \$\{\{ secrets\.([A-Za-z0-9_]+) \}\}$/;

/** Apply one edit; throw if it does not apply exactly once (an edit that misses looks like a pass). */
export function mut(text, from, to) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`fixture edit applies ${n} times, expected 1: ${JSON.stringify(from)}`);
  const out = text.replace(from, to);
  if (out === text) throw new Error(`fixture edit changed nothing: ${JSON.stringify(from)}`);
  return out;
}
