#!/usr/bin/env node
// esg-preview.mjs — render the ESG presentation for founder review, through the SHIPPED
// HS.esg helpers in lib/templates.js (not a mockup, not a redrawing of them).
//
// It renders three states side by side, because the review question is comparative:
//   A. Del Valle, ACTUAL — an operating facility with no confident company match
//      (the real pilot outcome: "ESG data unavailable").
//   B. Operating facility, POPULATED — real WikiRate/WBA answers for Republic Services.
//   C. Proposed development, POPULATED — the same data framed as a DEVELOPER TRACK RECORD.
//
// B and C are labelled PREVIEW ONLY on the page: the ESG values are real (read live from
// wikirate.org on 2026-08-09 and quoted verbatim below), but neither company is attached
// to a Del Valle record in production — BFI→Republic Services is an UNSOURCED corporate
// lineage and is held. Nothing here is written to the database.
//
// Usage: node test/esg-preview.mjs > /tmp/esg-preview.html
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal DOM shim so lib/templates.js can register itself.
globalThis.window = globalThis;
new Function(readFileSync(join(root, 'lib/templates.js'), 'utf8'))();
const HS = globalThis.HS;

// ── Real data, quoted verbatim from the live API ───────────────────────────────────────
// Republic Services, WikiRate card 48817. Answers via
// Answer.json?filter[company_id]=48817&limit=200 (2026-08-09). Values are the source's own
// Yes/No disclosures; the numeric WBA roll-ups are suppressed (no scale published).
const REPUBLIC = {
  company_name: 'Republic Services', source_company_name: 'Republic Services',
  match_confidence: 'exact', source_url: 'https://wikirate.org/Republic_Services',
  reporting_year: 2025,
  attribution: 'Benchmark data designed by the World Benchmarking Alliance, published on WikiRate (CC BY 4.0).',
  environmental: [
    { label: 'Waste Reduction Target', value: 'No', year: 2025, source: 'wba' },
    { label: 'Waste Recovery and Recycling Reporting', value: 'No', year: 2025, source: 'wba' },
    { label: 'Water Use Reporting', value: 'No', year: 2025, source: 'wba' },
    { label: 'Water Pollutant Reduction Target', value: 'No', year: 2025, source: 'wba' },
    { label: 'Societal Impact Water Pollution Risk Assessment', value: 'No', year: 2025, source: 'wba' },
  ],
  social: [],
  governance: [{ label: 'Governance Body Sustainability Responsibility', value: 'Yes', year: 2025, source: 'wba' }],
  unclassified: [{ label: 'Sustainability Strategy Disclosure', value: 'Yes', year: 2025, source: 'wba' }],
  scope_note: 'Company-level sustainability data; not a rating of this individual facility.',
};

const ROWS = [
  { key: 'A', caption: 'A · DEL VALLE, ACTUAL — operating facility, no confident company match',
    note: 'This is what ZIP 78617 renders today on all 537 mapped records.',
    row: { name: 'BFI WASTE SYSTEMS OF TEXAS LP', status: 'Operating', company_esg: null } },
  { key: 'B', caption: 'B · PREVIEW — operating facility WITH a confident match',
    note: 'Real Republic Services data. NOT attached in production: BFI→Republic Services is an unsourced lineage and is held.',
    row: { name: 'BFI WASTE SYSTEMS OF TEXAS LP', status: 'Operating',
           company_esg: { ...REPUBLIC, role: 'operator', record_status: 'Operating' } } },
  { key: 'C', caption: 'C · PREVIEW — PROPOSED development, same company data, developer framing',
    note: 'Identical data; only the lifecycle differs. Note the heading and the first sentence change.',
    row: { name: 'Proposed transfer station expansion', status: 'Proposed',
           company_esg: { ...REPUBLIC, role: 'developer', record_status: 'Proposed' } } },
];

// The two render paths under review, reproduced exactly as maps.html composes them.
function chipHTML(row) {
  const c = HS.esg.chip(row);
  return `<div class="chip ${c.available ? 'on' : 'off'}">${c.available ? '🏢 ' : ''}${HS.esc(c.text)}</div>`;
}
function detailHTML(row) {
  const e = HS.esg.of(row);
  if (!e) {
    return `<div class="isec"><h4>Company ESG / Sustainability</h4>
      <p class="hint">${HS.esc(HS.esg.UNAVAILABLE)} — we could not confidently identify the company behind this
      record in an open sustainability dataset. HomeSignal shows nothing rather than risk attaching the wrong
      company's record.</p></div>`;
  }
  const prov = HS.esg.provenance(row);
  const score = HS.esg.scoreLine(row);
  const roleWord = { developer: 'Developer', operator: 'Site operator', owner: 'Owner', parent: 'Parent company' }[e.role] || 'Associated company';
  const rows = [
    ['Company', e.company_name],
    e.match_confidence === 'parent' && e.parent_company_name ? ['Reported under', `${e.parent_company_name} (parent company)`] : null,
    ['Role on this record', roleWord],
    prov.reporting_year ? ['Most recent reporting year', String(prov.reporting_year)] : null,
    score ? ['Overall score', score] : null,
  ].filter(Boolean);
  return `<div class="isec"><h4>${HS.esc(HS.esg.heading(row))}</h4>
    <div class="specs">${rows.map(([k, v]) => `<div class="row"><span>${HS.esc(k)}</span><b>${HS.esc(v)}</b></div>`).join('')}</div>
    <p class="hint">${HS.esc(HS.esg.framing(row))}</p>
    ${HS.esg.sections(row).map((s) => `<div class="pillar"><div class="plabel">${HS.esc(s.label)}</div>
      ${s.rows.map((m) => `<div class="row"><span>${HS.esc(m.label)}</span><b>${HS.esc(m.value)}</b></div>`).join('')}</div>`).join('')}
    <p class="hint scope"><strong>${HS.esc(HS.esg.SCOPE_NOTE)}</strong></p>
    <p class="hint">Source: ${HS.esc(prov.sources.join(', '))}${prov.matched_name ? ` · matched as “${HS.esc(prov.matched_name)}”` : ''}.
      ${HS.esc(prov.attribution)} <a href="${HS.esc(prov.url)}">View the company record ▸</a></p>
  </div>`;
}

const css = `
 body{font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f6f6;color:#16302b;margin:0;padding:24px}
 h1{font-size:19px;margin:0 0 4px} .sub{color:#5d6f72;font-size:13px;margin:0 0 20px;max-width:860px}
 .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}
 .col{background:#fff;border:1px solid #dbe4e3;border-radius:14px;padding:14px}
 .cap{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#16302b;margin-bottom:4px}
 .cnote{font-size:11.5px;color:#5d6f72;margin-bottom:12px}
 .mapcard{border:1px solid #dbe4e3;border-radius:10px;padding:11px;background:#fbfdfd;margin-bottom:14px}
 .mapcard .t{font-weight:700;font-size:13.5px} .mapcard .s{font-size:11.5px;color:#5d6f72;margin-top:2px}
 .chip{margin-top:8px;font-size:12px} .chip.on{color:#16302b} .chip.off{color:#8b9a99}
 .stage{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#8b9a99;margin:14px 0 6px}
 .isec{background:#fff;border:1px solid #dbe4e3;border-radius:12px;padding:14px}
 .isec h4{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5d6f72;margin:0 0 10px}
 .specs{border-top:1px solid #eef2f2}
 .row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #eef2f2;font-size:12.5px}
 .row span{color:#5d6f72} .row b{text-align:right;font-weight:600}
 .pillar{margin-top:12px} .plabel{font-size:11.5px;font-weight:700;color:#16302b;margin-bottom:2px}
 .hint{font-size:11.5px;color:#5d6f72;line-height:1.5;margin:10px 0 0} .hint.scope{color:#16302b}
 a{color:#1f7a4d}
`;

const html = `<!doctype html><meta charset="utf-8"><title>HomeSignal — ESG presentation review (Del Valle pilot)</title>
<style>${css}</style>
<h1>Company ESG / Sustainability — presentation review</h1>
<p class="sub">Del Valle (78617) pilot. Rendered through the shipped <code>HS.esg</code> helpers in
<code>lib/templates.js</code>. Column A is the real current state of every Del Valle record. Columns B and C are
<strong>previews</strong>: the ESG values are real (Republic Services, read from wikirate.org 2026-08-09) but are
not attached to any production record — the BFI→Republic Services lineage is unsourced and held.</p>
<div class="grid">
${ROWS.map(({ caption, note, row }) => `<div class="col">
  <div class="cap">${HS.esc(caption)}</div><div class="cnote">${HS.esc(note)}</div>
  <div class="stage">1 · Map popup / card</div>
  <div class="mapcard"><div class="t">${HS.esc(row.name)}</div><div class="s">${HS.esc(row.status)}</div>${chipHTML(row)}</div>
  <div class="stage">2 · After “View details”</div>
  ${detailHTML(row)}
</div>`).join('')}
</div>`;

process.stdout.write(html);
